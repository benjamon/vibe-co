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

const spacetimedb = schema({ guess, country_stat, user_country_stat })

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

export default spacetimedb
