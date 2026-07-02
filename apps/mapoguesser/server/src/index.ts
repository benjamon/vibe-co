/**
 * SpacetimeDB module for mapoguesser stats.
 *
 * Stores every guess plus two aggregate rollups:
 *   - country_stat:      global per-country totals across all users
 *   - user_country_stat: per-user per-country totals (looked up by the random
 *                        client-side user id)
 *
 * The raw `guess` table is capped at GUESS_CAP_PER_TARGET rows per target
 * country. SpacetimeDB's subscription SQL has no ORDER BY, so we can't ask for
 * "the latest 200" at query time — instead we bound the stored set to the most
 * recent 200 (evicting the oldest, which are the smallest auto-inc ids) so a
 * plain `SELECT * FROM guess WHERE target = '…'` returns exactly that window.
 */
import { schema, t, table } from 'spacetimedb/server'

// Map display shows up to the most-recent 200 guesses for a country, so we keep
// at most that many per target globally.
const GUESS_CAP_PER_TARGET = 200

// Reject absurdly long strings before they hit the datastore. Natural Earth
// country names and uuids are both comfortably under this.
const MAX_NAME_LEN = 96
const MAX_USER_ID_LEN = 64

// One row per guess. `target` is the country the player was asked to find;
// `guess` is the country they clicked. `lat`/`lon` are the click location used
// to paint the dot on the globe.
const guess = table(
  {
    name: 'guess',
    public: true,
    indexes: [
      { accessor: 'byTarget', algorithm: 'btree', columns: ['target'] as const },
      { accessor: 'byUser', algorithm: 'btree', columns: ['user_id'] as const },
    ] as const,
  },
  {
    id: t.u64().primaryKey().autoInc(),
    user_id: t.string(),
    target: t.string(),
    guess: t.string(),
    correct: t.bool(),
    lat: t.f64(),
    lon: t.f64(),
    timestamp: t.u64(),
  },
)

// One row per capitals-mode guess (golf scoring). `country` is the country whose
// capital the player was asked to find. `guess_lat`/`guess_lon` are where they
// dropped the pin; `target_lat`/`target_lon` are the true capital; `distance_mi`
// is the great-circle miles between them (the round's golf score — lower better).
const capital_guess = table(
  {
    name: 'capital_guess',
    public: true,
    indexes: [
      { accessor: 'byCountry', algorithm: 'btree', columns: ['country'] as const },
      { accessor: 'byUser', algorithm: 'btree', columns: ['user_id'] as const },
    ] as const,
  },
  {
    id: t.u64().primaryKey().autoInc(),
    user_id: t.string(),
    country: t.string(),
    guess_lat: t.f64(),
    guess_lon: t.f64(),
    target_lat: t.f64(),
    target_lon: t.f64(),
    distance_mi: t.f64(),
    timestamp: t.u64(),
  },
)

// Global per-country aggregate across every user. `correct` counts guesses that
// matched the target; `total` counts all guesses. score = 2*correct - total.
const country_stat = table(
  { name: 'country_stat', public: true },
  {
    country: t.string().primaryKey(),
    correct: t.i32(),
    total: t.i32(),
  },
)

// Per-user mirror of country_stat. Primary key is `${user_id}-${country}` so we
// can upsert without a composite-key index, mirroring the sky-strike pattern.
const user_country_stat = table(
  {
    name: 'user_country_stat',
    public: true,
    indexes: [
      { accessor: 'byUser', algorithm: 'btree', columns: ['user_id'] as const },
    ] as const,
  },
  {
    key: t.string().primaryKey(),
    user_id: t.string(),
    country: t.string(),
    correct: t.i32(),
    total: t.i32(),
  },
)

// ---------------------------------------------------------------------------
// Multiplayer "Play With Friends" party mode.
//
// A party is a short-lived room identified by a 4-char code. Players join the
// lobby, ready up, and then race through the same ROUNDS-question match. The
// match draw is deterministic from `seed` (the client runs the identical
// mulberry32 shuffle), so the server never needs to know the countries — it
// only owns the room lifecycle: who's in it, whose turn it is to answer, and
// the per-question deadline.
//
// Round advancement is client-driven but idempotent: any client whose 30s
// timer expires (or the reducer that records the final outstanding guess) calls
// advance_question, which is guarded by `current_question` so duplicate/raced
// calls are no-ops. No scheduled reducers needed.
// ---------------------------------------------------------------------------

// Match length and per-question time budget. ROUNDS MUST match the client's
// store.ROUNDS so both sides agree on when the match ends.
const PARTY_ROUNDS = 9
// Capitals mode is a shorter, golf-scored match (mirrors client CAPITAL_ROUNDS).
const CAPITAL_PARTY_ROUNDS = 5
const QUESTION_MS = 30_000
// Once every player has answered, the question's deadline is pulled in to this
// many ms from now — a brief window to see the result before advancing.
const ALL_ANSWERED_GRACE_MS = 3_000
const MAX_PLAYER_NAME_LEN = 10
const PARTY_CODE_LEN = 4

// The sub-modes a party can play. The lobby offers two of these to vote on;
// extend this list to add more (voting + round-count logic pick them up
// automatically). Keep the ids in lockstep with the client's gameModes.ts.
const PARTY_MODES = [
  'all',
  'worldcup',
  'americas',
  'europe',
  'africa',
  'asia',
  'world-capitals',
  'cities-north-america',
  'cities-latin-america',
  'cities-europe',
] as const

// The golf-scored city sub-modes (5 rounds, distance scoring). Everything else
// is a 9-round country mode. Mirrors the 'cities' family in gameModes.ts.
const CITY_MODES = new Set<string>([
  'world-capitals',
  'cities-north-america',
  'cities-latin-america',
  'cities-europe',
])
const isCityMode = (mode: string): boolean => CITY_MODES.has(mode)

// How many questions a given mode runs for. City modes are the short golf match.
const roundsForMode = (mode: string): number =>
  isCityMode(mode) ? CAPITAL_PARTY_ROUNDS : PARTY_ROUNDS

// Pick two distinct modes for a lobby to vote on. Derived from the wall clock
// (reducers already use Date.now); good enough spread for a mode shuffle.
const pickTwoModes = (): [string, string] => {
  const n = PARTY_MODES.length
  const t = Date.now()
  const i = t % n
  // i+1 .. i+n-1 (mod n) never lands on i, so the two picks are always distinct.
  const j = (i + 1 + (Math.floor(t / n) % (n - 1))) % n
  return [PARTY_MODES[i], PARTY_MODES[j]]
}

// Phases: 'lobby' (gathering + readying), 'playing' (answering questions),
// 'finished' (results). Stored as a string so the bindings stay simple.
const party = table(
  { name: 'party', public: true },
  {
    code: t.string().primaryKey(),
    host_id: t.string(),
    seed: t.string(),
    phase: t.string(),
    current_question: t.i32(),
    // Epoch ms when the current question stops accepting guesses. 0 in lobby.
    question_deadline: t.u64(),
    created_at: t.u64(),
  },
)

// One row per player per party. Primary key is `${code}-${user_id}` so a player
// can rejoin idempotently. `score` is the running count of correct guesses.
const party_player = table(
  {
    name: 'party_player',
    public: true,
    indexes: [
      { accessor: 'byCode', algorithm: 'btree', columns: ['code'] as const },
    ] as const,
  },
  {
    key: t.string().primaryKey(),
    code: t.string(),
    user_id: t.string(),
    name: t.string(),
    ready: t.bool(),
    score: t.i32(),
    joined_at: t.u64(),
  },
)

// One row per (party, question, player) guess. Drives both the live "username
// ✓/✗" toast feed (clients subscribe and render new rows) and the all-guessed
// early-advance check. Primary key enforces one guess per question per player.
const party_guess = table(
  {
    name: 'party_guess',
    public: true,
    indexes: [
      { accessor: 'byCode', algorithm: 'btree', columns: ['code'] as const },
    ] as const,
  },
  {
    key: t.string().primaryKey(),
    code: t.string(),
    question: t.i32(),
    user_id: t.string(),
    name: t.string(),
    correct: t.bool(),
    timestamp: t.u64(),
  },
)

// Per-room mode voting config. `mode_a`/`mode_b` are the two candidates offered
// in the lobby; `mode` is the winner, set when the match starts ('' in lobby).
// Kept in its own table (rather than columns on `party`) so it's an additive
// schema change.
const party_config = table(
  { name: 'party_config', public: true },
  {
    code: t.string().primaryKey(),
    mode_a: t.string(),
    mode_b: t.string(),
    mode: t.string(),
  },
)

// One row per player's lobby vote. Primary key `${code}-${user_id}` → one vote
// per player, re-votable.
const party_vote = table(
  {
    name: 'party_vote',
    public: true,
    indexes: [
      { accessor: 'byCode', algorithm: 'btree', columns: ['code'] as const },
    ] as const,
  },
  {
    key: t.string().primaryKey(),
    code: t.string(),
    user_id: t.string(),
    mode: t.string(),
  },
)

// Broadcast feed of in-match events (currently capitals lifeline usage). Clients
// subscribe and render a toast per new row. `kind` + `detail` keep it generic so
// new event types don't need a schema change.
const party_event = table(
  {
    name: 'party_event',
    public: true,
    indexes: [
      { accessor: 'byCode', algorithm: 'btree', columns: ['code'] as const },
    ] as const,
  },
  {
    key: t.string().primaryKey(),
    code: t.string(),
    user_id: t.string(),
    name: t.string(),
    kind: t.string(),
    detail: t.string(),
    timestamp: t.u64(),
  },
)

// One row per (party, question, player) capitals guess, carrying the golf
// distance. Separate from party_guess (which stays a simple correct/wrong feed)
// so the classic path is untouched; clients sum these for the capitals
// scoreboard (lowest total distance wins).
const party_capital = table(
  {
    name: 'party_capital',
    public: true,
    indexes: [
      { accessor: 'byCode', algorithm: 'btree', columns: ['code'] as const },
    ] as const,
  },
  {
    key: t.string().primaryKey(),
    code: t.string(),
    user_id: t.string(),
    question: t.i32(),
    distance_mi: t.f64(),
    timestamp: t.u64(),
  },
)

const spacetimedb = schema({
  guess,
  capital_guess,
  country_stat,
  user_country_stat,
  party,
  party_player,
  party_guess,
  party_config,
  party_vote,
  party_event,
  party_capital,
})

export const record_guess = spacetimedb.reducer(
  {
    user_id: t.string(),
    target: t.string(),
    guess: t.string(),
    lat: t.f64(),
    lon: t.f64(),
  },
  (ctx, { user_id, target, guess: guessName, lat, lon }) => {
    // Defensive validation — a misbehaving client shouldn't be able to bloat
    // the datastore or write garbage rows.
    if (!user_id || user_id.length > MAX_USER_ID_LEN) return
    if (!target || target.length > MAX_NAME_LEN) return
    if (!guessName || guessName.length > MAX_NAME_LEN) return
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return

    const correct = target === guessName

    // 1. Append the raw guess.
    ctx.db.guess.insert({
      id: 0n, // ignored — autoInc fills it
      user_id,
      target,
      guess: guessName,
      correct,
      lat,
      lon,
      timestamp: BigInt(Date.now()),
    })

    // Enforce the per-target cap: auto-inc ids are monotonic, so the smallest
    // ids are the oldest. Delete just enough of them to stay at the cap. The
    // scan is bounded to one target's rows (<= cap + 1), so it stays cheap.
    const rows = Array.from(ctx.db.guess.byTarget.filter(target))
    if (rows.length > GUESS_CAP_PER_TARGET) {
      rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      const excess = rows.length - GUESS_CAP_PER_TARGET
      for (let i = 0; i < excess; i++) {
        ctx.db.guess.id.delete(rows[i].id)
      }
    }

    // 2. Global aggregate (upsert).
    const globalExisting = ctx.db.country_stat.country.find(target)
    if (globalExisting) {
      ctx.db.country_stat.country.update({
        country: target,
        correct: globalExisting.correct + (correct ? 1 : 0),
        total: globalExisting.total + 1,
      })
    } else {
      ctx.db.country_stat.insert({
        country: target,
        correct: correct ? 1 : 0,
        total: 1,
      })
    }

    // 3. Per-user aggregate (upsert).
    const key = `${user_id}-${target}`
    const userExisting = ctx.db.user_country_stat.key.find(key)
    if (userExisting) {
      ctx.db.user_country_stat.key.update({
        key,
        user_id,
        country: target,
        correct: userExisting.correct + (correct ? 1 : 0),
        total: userExisting.total + 1,
      })
    } else {
      ctx.db.user_country_stat.insert({
        key,
        user_id,
        country: target,
        correct: correct ? 1 : 0,
        total: 1,
      })
    }
  },
)

// Record one capitals-mode guess (golf). Stores both the dropped pin and the
// true capital plus the great-circle distance. Kept in its own table so it never
// pollutes the classic country_stat / user_country_stat aggregates.
export const record_capital_guess = spacetimedb.reducer(
  {
    user_id: t.string(),
    country: t.string(),
    guess_lat: t.f64(),
    guess_lon: t.f64(),
    target_lat: t.f64(),
    target_lon: t.f64(),
    distance_mi: t.f64(),
  },
  (
    ctx,
    { user_id, country, guess_lat, guess_lon, target_lat, target_lon, distance_mi },
  ) => {
    if (!user_id || user_id.length > MAX_USER_ID_LEN) return
    if (!country || country.length > MAX_NAME_LEN) return
    const nums = [guess_lat, guess_lon, target_lat, target_lon, distance_mi]
    if (nums.some((n) => !Number.isFinite(n))) return
    if (guess_lat < -90 || guess_lat > 90 || guess_lon < -180 || guess_lon > 180)
      return
    if (target_lat < -90 || target_lat > 90 || target_lon < -180 || target_lon > 180)
      return
    if (distance_mi < 0) return

    ctx.db.capital_guess.insert({
      id: 0n, // ignored — autoInc fills it
      user_id,
      country,
      guess_lat,
      guess_lon,
      target_lat,
      target_lon,
      distance_mi,
      timestamp: BigInt(Date.now()),
    })

    // Same per-country cap as `guess`: keep at most the most-recent rows.
    const rows = Array.from(ctx.db.capital_guess.byCountry.filter(country))
    if (rows.length > GUESS_CAP_PER_TARGET) {
      rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      const excess = rows.length - GUESS_CAP_PER_TARGET
      for (let i = 0; i < excess; i++) {
        ctx.db.capital_guess.id.delete(rows[i].id)
      }
    }
  },
)

// ---------------------------------------------------------------------------
// Party reducers
// ---------------------------------------------------------------------------

const playerKey = (code: string, userId: string): string => `${code}-${userId}`
const guessKey = (code: string, question: number, userId: string): string =>
  `${code}-${question}-${userId}`

// A trimmed, length-bounded display name. Empty/oversized names are rejected by
// the callers; this just normalises whitespace.
const cleanName = (name: string): string =>
  name.trim().slice(0, MAX_PLAYER_NAME_LEN)

const isValidCode = (code: string): boolean =>
  typeof code === 'string' && code.length === PARTY_CODE_LEN

// Advance the room past `fromQuestion`. Guarded by current_question so racing
// callers (multiple expired timers, or a timer racing the last guess) collapse
// to a single advance. Past the final question the room flips to 'finished'.
const advanceParty = (
  ctx: Parameters<Parameters<typeof spacetimedb.reducer>[1]>[0],
  code: string,
  fromQuestion: number,
): void => {
  const room = ctx.db.party.code.find(code)
  if (!room || room.phase !== 'playing') return
  if (room.current_question !== fromQuestion) return // already advanced

  const cfg = ctx.db.party_config.code.find(code)
  const rounds = roundsForMode(cfg?.mode ?? '')
  const next = room.current_question + 1
  if (next >= rounds) {
    ctx.db.party.code.update({ ...room, phase: 'finished', question_deadline: 0n })
    return
  }
  ctx.db.party.code.update({
    ...room,
    current_question: next,
    question_deadline: BigInt(Date.now() + QUESTION_MS),
  })
}

// Create a room. The client generates the 4-char code and retries on collision
// (this no-ops if the code is taken, so two creators never clobber each other).
export const create_party = spacetimedb.reducer(
  {
    user_id: t.string(),
    name: t.string(),
    code: t.string(),
    seed: t.string(),
  },
  (ctx, { user_id, name, code, seed }) => {
    if (!user_id || user_id.length > MAX_USER_ID_LEN) return
    if (!isValidCode(code)) return
    if (ctx.db.party.code.find(code)) return // collision — client retries
    const display = cleanName(name)
    if (!display) return

    const now = BigInt(Date.now())
    ctx.db.party.insert({
      code,
      host_id: user_id,
      seed: seed.slice(0, 32),
      phase: 'lobby',
      current_question: 0,
      question_deadline: 0n,
      created_at: now,
    })
    ctx.db.party_player.insert({
      key: playerKey(code, user_id),
      code,
      user_id,
      name: display,
      ready: false,
      score: 0,
      joined_at: now,
    })
    const [modeA, modeB] = pickTwoModes()
    ctx.db.party_config.insert({
      code,
      mode_a: modeA,
      mode_b: modeB,
      mode: '',
    })
  },
)

// Cast (or change) a lobby vote for one of the room's two candidate modes.
export const set_vote = spacetimedb.reducer(
  { user_id: t.string(), code: t.string(), mode: t.string() },
  (ctx, { user_id, code, mode }) => {
    const room = ctx.db.party.code.find(code)
    if (!room || room.phase !== 'lobby') return
    const cfg = ctx.db.party_config.code.find(code)
    if (!cfg) return
    if (mode !== cfg.mode_a && mode !== cfg.mode_b) return
    const key = playerKey(code, user_id)
    if (!ctx.db.party_player.key.find(key)) return
    const existing = ctx.db.party_vote.key.find(key)
    if (existing) ctx.db.party_vote.key.update({ ...existing, mode })
    else ctx.db.party_vote.insert({ key, code, user_id, mode })
  },
)

// Join an existing lobby. Idempotent: rejoining updates the stored name. Only
// allowed while the room is still gathering (phase 'lobby').
export const join_party = spacetimedb.reducer(
  { user_id: t.string(), name: t.string(), code: t.string() },
  (ctx, { user_id, name, code }) => {
    if (!user_id || user_id.length > MAX_USER_ID_LEN) return
    if (!isValidCode(code)) return
    const room = ctx.db.party.code.find(code)
    if (!room || room.phase !== 'lobby') return
    const display = cleanName(name)
    if (!display) return

    const key = playerKey(code, user_id)
    const existing = ctx.db.party_player.key.find(key)
    if (existing) {
      ctx.db.party_player.key.update({ ...existing, name: display })
      return
    }
    ctx.db.party_player.insert({
      key,
      code,
      user_id,
      name: display,
      ready: false,
      score: 0,
      joined_at: BigInt(Date.now()),
    })
  },
)

// Toggle a player's ready flag. When every player is ready and there are at
// least two of them, the match auto-starts on question 0.
export const set_ready = spacetimedb.reducer(
  { user_id: t.string(), code: t.string(), ready: t.bool() },
  (ctx, { user_id, code, ready }) => {
    const room = ctx.db.party.code.find(code)
    if (!room || room.phase !== 'lobby') return
    const key = playerKey(code, user_id)
    const player = ctx.db.party_player.key.find(key)
    if (!player) return
    ctx.db.party_player.key.update({ ...player, ready })

    const players = Array.from(ctx.db.party_player.byCode.filter(code))
    if (players.length >= 2 && players.every((p) => (p.key === key ? ready : p.ready))) {
      // Resolve the mode vote: whichever candidate has more votes wins; a tie
      // (or no votes at all) is broken by a coin flip on the wall clock.
      const cfg = ctx.db.party_config.code.find(code)
      if (cfg) {
        let a = 0
        let b = 0
        for (const v of ctx.db.party_vote.byCode.filter(code)) {
          if (v.mode === cfg.mode_a) a++
          else if (v.mode === cfg.mode_b) b++
        }
        const winner =
          a > b
            ? cfg.mode_a
            : b > a
              ? cfg.mode_b
              : Date.now() % 2 === 0
                ? cfg.mode_a
                : cfg.mode_b
        ctx.db.party_config.code.update({ ...cfg, mode: winner })
      }
      ctx.db.party.code.update({
        ...room,
        phase: 'playing',
        current_question: 0,
        question_deadline: BigInt(Date.now() + QUESTION_MS),
      })
    }
  },
)

// Broadcast that a player spent a capitals lifeline, so every client can toast
// it. Once per (player, lifeline) per match — the primary key blocks repeats.
export const use_party_lifeline = spacetimedb.reducer(
  { user_id: t.string(), code: t.string(), lifeline: t.string() },
  (ctx, { user_id, code, lifeline }) => {
    const room = ctx.db.party.code.find(code)
    if (!room || room.phase !== 'playing') return
    if (lifeline !== 'name' && lifeline !== 'flag' && lifeline !== 'circle') return
    const player = ctx.db.party_player.key.find(playerKey(code, user_id))
    if (!player) return
    const key = `${code}-${user_id}-lifeline-${lifeline}`
    if (ctx.db.party_event.key.find(key)) return
    ctx.db.party_event.insert({
      key,
      code,
      user_id,
      name: player.name,
      kind: 'lifeline',
      detail: lifeline,
      timestamp: BigInt(Date.now()),
    })
  },
)

// Leave a room. Removes the player; if the room empties it's deleted, and if the
// host leaves the earliest remaining player inherits the host role.
export const leave_party = spacetimedb.reducer(
  { user_id: t.string(), code: t.string() },
  (ctx, { user_id, code }) => {
    const key = playerKey(code, user_id)
    if (ctx.db.party_player.key.find(key)) ctx.db.party_player.key.delete(key)
    // Drop this player's vote too (their slot is gone).
    if (ctx.db.party_vote.key.find(key)) ctx.db.party_vote.key.delete(key)

    const remaining = Array.from(ctx.db.party_player.byCode.filter(code))
    const room = ctx.db.party.code.find(code)
    if (!room) return
    if (remaining.length === 0) {
      ctx.db.party.code.delete(code)
      // Tear down the room's side tables so nothing leaks after it empties.
      if (ctx.db.party_config.code.find(code)) ctx.db.party_config.code.delete(code)
      for (const v of Array.from(ctx.db.party_vote.byCode.filter(code)))
        ctx.db.party_vote.key.delete(v.key)
      for (const e of Array.from(ctx.db.party_event.byCode.filter(code)))
        ctx.db.party_event.key.delete(e.key)
      for (const c of Array.from(ctx.db.party_capital.byCode.filter(code)))
        ctx.db.party_capital.key.delete(c.key)
      return
    }
    if (room.host_id === user_id) {
      remaining.sort((a, b) => (a.joined_at < b.joined_at ? -1 : 1))
      ctx.db.party.code.update({ ...room, host_id: remaining[0].user_id })
    }
  },
)

// Record one guess for the current question. Rejected if the player already
// answered this question or the deadline passed. When the final outstanding
// player answers, the question advances immediately (no need to wait out the
// clock).
export const submit_party_guess = spacetimedb.reducer(
  {
    user_id: t.string(),
    code: t.string(),
    question: t.i32(),
    correct: t.bool(),
    // Capitals mode only: great-circle miles from the dropped pin to the true
    // capital (the golf score). 0 / ignored for classic + worldcup.
    distance_mi: t.f64(),
  },
  (ctx, { user_id, code, question, correct, distance_mi }) => {
    const room = ctx.db.party.code.find(code)
    if (!room || room.phase !== 'playing') return
    if (room.current_question !== question) return // stale round
    if (Date.now() > Number(room.question_deadline)) return // too late

    const player = ctx.db.party_player.key.find(playerKey(code, user_id))
    if (!player) return
    const gKey = guessKey(code, question, user_id)
    if (ctx.db.party_guess.key.find(gKey)) return // one guess per question

    ctx.db.party_guess.insert({
      key: gKey,
      code,
      question,
      user_id,
      name: player.name,
      correct,
      timestamp: BigInt(Date.now()),
    })

    const cfg = ctx.db.party_config.code.find(code)
    if (isCityMode(cfg?.mode ?? '')) {
      // Golf scoring: record the distance; the correct-count score is unused for
      // city modes (the scoreboard sums these distances, lowest wins).
      const dist = Number.isFinite(distance_mi) && distance_mi >= 0 ? distance_mi : 0
      ctx.db.party_capital.insert({
        key: gKey,
        code,
        user_id,
        question,
        distance_mi: dist,
        timestamp: BigInt(Date.now()),
      })
    } else if (correct) {
      ctx.db.party_player.key.update({ ...player, score: player.score + 1 })
    }

    // Once everyone has answered, don't jump straight to the next question —
    // shorten the deadline to a short grace window so players can see the
    // result (the reveal / everyone's guesses), then the normal deadline-driven
    // advance takes over.
    const players = Array.from(ctx.db.party_player.byCode.filter(code))
    let answered = 0
    for (const g of ctx.db.party_guess.byCode.filter(code)) {
      if (g.question === question) answered++
    }
    if (answered >= players.length) {
      const grace = BigInt(Date.now() + ALL_ANSWERED_GRACE_MS)
      const current = ctx.db.party.code.find(code)
      if (
        current &&
        current.phase === 'playing' &&
        current.current_question === question &&
        grace < current.question_deadline
      ) {
        ctx.db.party.code.update({ ...current, question_deadline: grace })
      }
    }
  },
)

// "Play again": send a finished room back to the lobby with a fresh seed,
// reset scores/ready, and clear the old guesses. Guarded on phase 'finished'
// so racing clicks collapse — the first caller's seed wins, the rest no-op.
export const restart_party = spacetimedb.reducer(
  { user_id: t.string(), code: t.string(), seed: t.string() },
  (ctx, { code, seed }) => {
    const room = ctx.db.party.code.find(code)
    const allCodes = Array.from(ctx.db.party.iter()).map((r) => r.code)
    console.log(
      `restart_party code=[${code}] len=${code.length} seed=${seed} found=${!!room} phase=${room?.phase} allCodes=${JSON.stringify(allCodes)}`,
    )
    if (!room || room.phase !== 'finished') return

    ctx.db.party.code.update({
      ...room,
      seed: seed.slice(0, 32),
      phase: 'lobby',
      current_question: 0,
      question_deadline: 0n,
    })
    for (const p of Array.from(ctx.db.party_player.byCode.filter(code))) {
      ctx.db.party_player.key.update({ ...p, score: 0, ready: false })
    }
    for (const g of Array.from(ctx.db.party_guess.byCode.filter(code))) {
      ctx.db.party_guess.key.delete(g.key)
    }
    // Fresh mode vote for the next match: new candidates, cleared votes, and a
    // clean event/capital feed.
    const [modeA, modeB] = pickTwoModes()
    const cfg = ctx.db.party_config.code.find(code)
    if (cfg) {
      ctx.db.party_config.code.update({ ...cfg, mode_a: modeA, mode_b: modeB, mode: '' })
    } else {
      ctx.db.party_config.insert({ code, mode_a: modeA, mode_b: modeB, mode: '' })
    }
    for (const v of Array.from(ctx.db.party_vote.byCode.filter(code))) {
      ctx.db.party_vote.key.delete(v.key)
    }
    for (const e of Array.from(ctx.db.party_event.byCode.filter(code))) {
      ctx.db.party_event.key.delete(e.key)
    }
    for (const c of Array.from(ctx.db.party_capital.byCode.filter(code))) {
      ctx.db.party_capital.key.delete(c.key)
    }
  },
)

// Called by any client whose local 30s timer has expired. The deadline guard
// plus advanceParty's current_question guard make duplicate calls harmless.
export const advance_question = spacetimedb.reducer(
  { code: t.string(), question: t.i32() },
  (ctx, { code, question }) => {
    const room = ctx.db.party.code.find(code)
    if (!room || room.phase !== 'playing') return
    if (room.current_question !== question) return
    if (Date.now() < Number(room.question_deadline)) return // not expired yet
    advanceParty(ctx, code, question)
  },
)

export default spacetimedb
