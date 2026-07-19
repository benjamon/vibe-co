import { create } from 'zustand'
import { sfxCorrect, sfxWrong } from './sfx'
import {
  recordGuess,
  recordCapitalGuess,
  selectGlobalCountryGuesses,
  ALL_GUESSES,
  type CountryAgg,
  type GuessDot,
} from './stats'
import {
  submitGuess as submitPartyGuess,
  sendLifeline as sendPartyLifeline,
  type PartyPhase,
} from './party'
import { resolveSubMode, behavioralModeOf, type SubMode } from './gameModes'

// Which dataset the stats sidebar shows. 'mine' = this player's local history
// (also mirrored to the server); 'global' = aggregate totals across all users
// pulled from SpacetimeDB.
export type StatsMode = 'mine' | 'global'

export type AttemptResult = 'pending' | 'correct' | 'wrong'
export type GamePhase = 'idle' | 'playing' | 'finished'
// Which country pool the match draws from. 'classic' = every playable country
// in the dataset; 'worldcup' = only the 48 World Cup qualifiers (collapsed to
// the unique map countries they belong to; URL `wc=1`); 'capitals' = guess the
// capital city of a country, scored golf-style by distance (URL `cap=1`).
export type GameMode = 'classic' | 'worldcup' | 'capitals'

// A city and its coordinates. Populated by WorldViewer from the Natural Earth
// populated-places dataset (50m ≈ 1250 cities with population). Drives the
// 'capitals' (cities) mode draw pool and its distance scoring. Keyed in the
// store by the city's Natural Earth ne_id, so multiple cities per country and
// duplicate names across countries all stay distinct.
export interface CityInfo {
  city: string
  // The Natural Earth country NAME this city sits in, for the reveal flag +
  // label and for the region filters in the city sub-modes.
  country: string
  // Admin-1 name (US state / province), when the dataset carries one. Shown in
  // place of the country when revealing US cities in a state-lines mode.
  region?: string
  lat: number
  lon: number
  // Max metro population (Natural Earth pop_max). Drives the "largest cities"
  // ordering for the regional city sub-modes.
  pop: number
  // Whether this is the country's national capital (Natural Earth adm0cap).
  // The "World Capitals" sub-mode draws only from these.
  capital: boolean
  // Whether this is an admin-1 (US state / province) capital — Natural Earth's
  // 'Admin-1 capital' featurecla. Lets a region mode fold in every state capital
  // regardless of population (Montpelier, Pierre, Juneau, …).
  stateCapital: boolean
}
// Sprite kind drawn at the marker location: green pin for a correct guess,
// grey pin for the wrong country the player clicked, red X for the centroid
// reveal of a missed target. City modes drop small dots for their guesses
// instead of flag pins: 'guess' is a grey dot, 'guess-best' the yellow dot for
// the guess that actually scored (the closer of the two).
export type MarkerKind =
  | 'correct'
  | 'wrong'
  | 'reveal'
  | 'guess'
  | 'guess-best'
export interface Marker {
  lat: number
  lon: number
  kind: MarkerKind
  label: string
  // Optional explicit ISO 3166-1 alpha-2 flag code. When absent the renderer
  // derives the code from `label` (a country name). Capitals-mode reveal markers
  // set this so the pin shows the country's flag while `label` reads
  // "City,\nCountry" (which isn't a country name and wouldn't resolve on its own).
  code?: string
}

export const ROUNDS = 9
export const WRONG_GUESSES_BEFORE_REVEAL = 2
// Capitals mode is shorter and scored golf-style: 5 capitals, two guesses each
// (the closer guess scores). Kept separate from ROUNDS, which is the guess
// budget for classic/worldcup.
export const CAPITAL_ROUNDS = 5
export const CAPITAL_GUESSES_PER_ROUND = 2
// A city-mode guess scores its great-circle miss in miles (lower is better), but
// capped here: any guess this far off (or worse) scores the same, and a round a
// player never answers is charged exactly this — so a no-guess costs the same as
// the worst possible guess, no more.
export const MAX_CAPITAL_MILES = 1000
// A city guess within this many miles counts as a "near" hit (green sfx).
const CAPITAL_NEAR_MI = 50

// After the target changes, guess input is ignored for this long so a click
// queued/double-fired for the previous target doesn't land on the new one.
export const GUESS_LOCK_MS = 2000
const lockUntil = (): number => Date.now() + GUESS_LOCK_MS

// How many rounds a given mode runs for. Must match the server's roundsForMode
// so single-player and party matches agree on when the match ends.
export const roundsForMode = (mode: GameMode): number =>
  mode === 'capitals' ? CAPITAL_ROUNDS : ROUNDS

// Single-slot save: a returning player can resume one in-progress match.
// Starting a different seed overwrites it.
const SAVE_KEY = 'mapoguesser:save'
// Persistent across matches: stable integer ID per country (grow-only) and
// the guess history / rolling score keyed by those IDs.
const IDS_KEY = 'mapoguesser:countryIds'
const STATS_KEY = 'mapoguesser:stats'
// Count of consecutive perfect (9/9) games. Persisted so the streak survives
// reloads; reset to 0 the moment a match ends with any miss.
const PERFECT_STREAK_KEY = 'mapoguesser:perfectStreak'

// One guess on a target. `id` is the country the player actually clicked.
// `lat`/`lon` are the exact click position on the globe — optional only
// because guesses persisted before this field was added don't carry them
// (they still count toward score, they just don't draw dots).
export interface GuessRecord {
  id: number
  lat?: number
  lon?: number
}

export interface CountryStats {
  guesses: GuessRecord[]
  // Running total over every guess at this country: +1 when the guess matches
  // the target ID, −1 otherwise. Cached so the stats view doesn't recompute it
  // for every row on every render.
  score: number
}

interface SavedMatch {
  seed: string
  // Which pool the saved draw came from. A seed alone isn't enough to resume —
  // the same seed yields a different draw per mode — so the resume check below
  // requires both to match. Optional for legacy saves (default 'classic').
  mode?: GameMode
  // Which sub-mode (region) the draw came from. Like `mode`, the same seed draws
  // a different sequence per sub-mode, so resume requires it to match. Optional
  // for legacy saves (default resolves from `mode`).
  subMode?: string
  // Per-guess log (one entry per click), NOT one per country. See GameState.
  attempts: AttemptResult[]
  // How far through the 9-country sequence we are (advances on a correct guess
  // or the second consecutive miss). Drives which country is served.
  targetIndex: number
  consecutiveWrong: number
  markers: Marker[]
  // Capitals mode only: the great-circle miles for each completed round, in
  // order. Absent for classic/worldcup saves (which score by `attempts`).
  distances?: number[]
  // Capitals mode only: the in-progress first guess of the current capital (the
  // player has one guess left), or null/absent when between rounds.
  roundGuess?: RoundGuess | null
}

const isSavedMatch = (v: unknown): v is SavedMatch => {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.seed === 'string' &&
    Array.isArray(o.attempts) &&
    typeof o.targetIndex === 'number' &&
    typeof o.consecutiveWrong === 'number' &&
    Array.isArray(o.markers)
  )
}

const loadSave = (): SavedMatch | null => {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isSavedMatch(parsed) ? parsed : null
  } catch {
    return null
  }
}

const writeSave = (data: SavedMatch): void => {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data))
  } catch {
    // quota exceeded / private browsing — silent skip
  }
}

const loadCountryIds = (): Record<string, number> => {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(IDS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

// Accept both the legacy plain-number form ("guesses: [3, 7, 7]") and the
// new {id, lat, lon} form. Legacy entries survive with no position and just
// don't render dots on the map.
const parseGuessRecord = (v: unknown): GuessRecord | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) {
    return { id: v }
  }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'number' || !Number.isInteger(o.id) || o.id < 0) return null
  const rec: GuessRecord = { id: o.id }
  if (typeof o.lat === 'number' && Number.isFinite(o.lat)) rec.lat = o.lat
  if (typeof o.lon === 'number' && Number.isFinite(o.lon)) rec.lon = o.lon
  return rec
}

const loadStats = (): Record<number, CountryStats> => {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STATS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<number, CountryStats> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const id = Number(k)
      if (!Number.isInteger(id) || id < 0) continue
      if (!v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      if (!Array.isArray(o.guesses)) continue
      const guesses: GuessRecord[] = []
      for (const raw of o.guesses as unknown[]) {
        const rec = parseGuessRecord(raw)
        if (rec) guesses.push(rec)
      }
      // Recompute from the full history rather than trusting the stored value —
      // older saves cached only a last-5 rolling score under `recentScore`.
      out[id] = { guesses, score: computeScore(guesses, id) }
    }
    return out
  } catch {
    return {}
  }
}

const writeJSON = (key: string, data: unknown): void => {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // quota exceeded / private browsing — silent skip
  }
}

const computeScore = (guesses: GuessRecord[], targetId: number): number => {
  let sum = 0
  for (const g of guesses) sum += g.id === targetId ? 1 : -1
  return sum
}

// Record one guess (target vs clicked) into the server stats and return the
// updated local per-country stats map — or null if the names lack IDs yet.
// Shared by the single-player and multiplayer guess paths so both feed stats.
const applyGuessStats = (
  s: GameState,
  target: string,
  clicked: string,
  lat?: number,
  lon?: number,
): Record<number, CountryStats> | null => {
  recordGuess(target, clicked, lat as number, lon as number)
  const targetId = s.countryIds[target]
  const guessId = s.countryIds[clicked]
  if (targetId === undefined || guessId === undefined) return null
  const existing = s.stats[targetId] ?? { guesses: [], score: 0 }
  const record: GuessRecord = { id: guessId }
  if (typeof lat === 'number' && Number.isFinite(lat)) record.lat = lat
  if (typeof lon === 'number' && Number.isFinite(lon)) record.lon = lon
  const guesses = [...existing.guesses, record]
  return {
    ...s.stats,
    [targetId]: { guesses, score: computeScore(guesses, targetId) },
  }
}

const loadPerfectStreak = (): number => {
  if (typeof localStorage === 'undefined') return 0
  try {
    const raw = localStorage.getItem(PERFECT_STREAK_KEY)
    if (!raw) return 0
    const n = Number(JSON.parse(raw))
    return Number.isInteger(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

// Given a finished match's per-guess log, return the next perfect-game streak:
// +1 on a flawless run, reset to 0 otherwise. A perfect run is exactly ROUNDS
// guesses that are all correct — any miss adds an extra 'wrong' entry, pushing
// the length past ROUNDS, so the equality check rules it out.
const nextPerfectStreak = (
  attempts: AttemptResult[],
  current: number,
): number => {
  const correct = attempts.filter((a) => a === 'correct').length
  return correct === ROUNDS && attempts.length === ROUNDS ? current + 1 : 0
}

interface GameState {
  heading: number
  setHeading: (heading: number) => void

  // Available country names, populated by WorldViewer once Natural Earth
  // GeoJSON has loaded. The Start button stays disabled until non-empty.
  countries: string[]
  setCountries: (countries: string[]) => void

  // The subset of `countries` that are World Cup qualifier nations (the unique
  // map countries the 48 teams belong to). Populated by WorldViewer once the
  // GeoJSON loads; drives the 'worldcup' draw pool.
  worldCupCountries: string[]
  setWorldCupCountries: (countries: string[]) => void

  // ne_id → city. Populated by WorldViewer once the populated-places GeoJSON
  // loads. Drives the cities-mode ('capitals' behaviour) draw pool + scoring:
  // World Capitals draws the `capital` ones, regional modes the largest by
  // `pop` within a set of countries.
  cities: Record<string, CityInfo>
  setCities: (cities: Record<string, CityInfo>) => void

  // Name → ISO 3166-1 alpha-2 code (lowercase). Populated alongside countries.
  // Drives the flag icons in the HUD. Countries without a valid ISO_A2 in the
  // Natural Earth dataset are simply absent (the HUD then omits the flag).
  countryCodes: Record<string, string>
  setCountryCodes: (codes: Record<string, string>) => void

  // Name → stable integer ID. Grow-only across reloads so stats keyed by ID
  // stay valid as new countries appear in the dataset. WorldViewer calls
  // registerCountries(names) after the GeoJSON loads.
  countryIds: Record<string, number>
  registerCountries: (names: string[]) => void

  // Per-target guess history. Keyed by the target country's ID. Persisted to
  // localStorage independently of the in-progress match save.
  stats: Record<number, CountryStats>

  // Which row in the stats sidebar is currently selected. Drives the dots the
  // WorldViewer paints at the player's past guess locations for that country.
  // null = no row selected; the dot layer is empty. 'all' = the synthetic top
  // row, which paints every guess ever made across all countries.
  selectedStatsCountryId: number | 'all' | null
  selectStatsCountry: (id: number | 'all' | null) => void

  // 'mine' vs 'global' toggle for the stats sidebar.
  statsMode: StatsMode
  setStatsMode: (mode: StatsMode) => void

  // Server-fed aggregate snapshots, keyed by country NAME (stable across
  // clients). `globalStats` spans all users; `myStats` is this user's totals
  // retrieved from the server by the locally-stored random id. Populated by the
  // stats subscription wired up in App.
  globalStats: Record<string, CountryAgg>
  myStats: Record<string, CountryAgg>
  setServerStats: (
    global: Record<string, CountryAgg>,
    mine: Record<string, CountryAgg>,
  ) => void

  // Up to the most-recent 200 guesses for the currently-selected global
  // country, loaded on demand for painting on the globe. `country` is the name
  // those dots belong to (so a stale update for a different country is ignored).
  globalGuesses: { country: string | null; dots: GuessDot[] }
  setGlobalGuesses: (country: string | null, dots: GuessDot[]) => void

  // Last country clicked on the globe (whichever phase we're in).
  country: string | null
  setCountry: (country: string | null) => void

  // Consecutive perfect (9/9) games, persisted. Incremented when a match ends
  // flawless, reset to 0 on any miss. Drives the win-screen streak banner.
  perfectStreak: number

  // Game flow.
  phase: GamePhase
  // The behavioural mode of the active match: 'classic'/'worldcup' guess the
  // country, 'capitals' guesses the city. Derived from the sub-mode; drives
  // round count, scoring, HUD, and the map-corner label.
  mode: GameMode
  // The selected sub-mode id (region). This is the real selector — it fixes both
  // the behaviour (`mode`) and the draw pool. Mirrored to the URL as `sm=<id>`
  // so a shared link reproduces the same match.
  subMode: string
  // Match seed (base36, 6 chars). Drives the deterministic target draw and is
  // mirrored to the URL so a link reproduces the same match.
  seed: string | null
  // The full draw of ROUNDS unique countries for this match, in order. This is
  // the source of truth for what's served next — independent of the guess log.
  targets: string[]
  // Pointer into `targets`: the index of the country currently being asked.
  // Advances by one on a correct guess or the second consecutive miss, so each
  // country is served at most once, in order. Because the match is capped at
  // ROUNDS *guesses* (not countries), a miss spends a guess without reaching a
  // later country — so targetIndex can finish below ROUNDS.
  targetIndex: number
  target: string | null
  // Per-GUESS result log (one entry per click, in order) — the player's fixed
  // budget is ROUNDS guesses total, so this never exceeds ROUNDS and the match
  // ends when it fills. A country missed twice contributes two 'wrong' entries;
  // a country guessed right first try contributes one 'correct'. Drives the HUD
  // flag boxes (which pad to ROUNDS with pending boxes for unused guesses); it
  // never contains 'pending'.
  attempts: AttemptResult[]
  // Capitals mode only: the great-circle miles for each completed round, in
  // order. The golf scorecard — the total (sum) is the match score, lower is
  // better. Empty in classic/worldcup (which score by `attempts`).
  distances: number[]

  // Capitals lifelines. `lifelinesUsed` tracks the three once-per-game helpers
  // (reset each match). `revealName`/`revealFlag` show the hidden country
  // name/flag for the *current* round; `hintCircle` is the drawn circle. All
  // three per-round reveals reset when the round advances.
  lifelinesUsed: Record<Lifeline, boolean>
  revealName: boolean
  revealFlag: boolean
  hintCircle: HintCircle | null
  // Line from the player's last dropped pin to the true capital. Cleared when
  // the next guess is made (only the current round's line is ever shown).
  guessLine: GuessLine | null
  // Capitals mode: the first of the round's two guesses, or null before the
  // player has guessed this capital. On the second guess the closer of the two
  // scores and the answer is revealed; null again once the round advances.
  roundGuess: RoundGuess | null
  // Bumped whenever the game markers are fully replaced (rather than appended),
  // so the viewer knows to wipe + redraw instead of appending. Capitals mode
  // replaces its two markers each guess; classic/worldcup only ever appends.
  markerEpoch: number

  // Markers placed on the globe. Owned by the store (rather than the viewer's
  // Cesium data source) so we can persist them and replay them on resume.
  markers: Marker[]
  // Wrong guesses on the *current* target. Resets on correct guess or reveal.
  consecutiveWrong: number
  // When non-null, the WorldViewer is expected to fly the camera to this
  // country and drop an X marker, then call clearReveal().
  revealTarget: string | null
  // When non-null, the player just got the *final* round correct. The viewer
  // pans to this country, holds 2 s, then calls finishGame() to transition to
  // the 'finished' phase. Keeps the score-screen handoff cinematic.
  endingTarget: string | null

  // True while a "Play With Friends" party match is driving the globe. In this
  // mode handleGlobeClick submits one server guess per question (no local
  // budget/reveal logic) and the question pointer is driven by the server via
  // syncPartyMatch rather than by local guesses.
  multiplayer: boolean
  // Whether the local player has already guessed the *current* party question.
  // Locks the globe until the server advances to the next question.
  partyAnswered: boolean
  // Epoch-ms until which guess input is ignored. Bumped GUESS_LOCK_MS ahead
  // whenever the target changes, so a click queued for the previous target
  // doesn't accidentally register against the new one. Enforced at the input
  // layer (WorldViewer), not in the guess handlers, so direct-call tests are
  // unaffected.
  inputLockUntil: number

  // Drive the local match from a party snapshot. Draws the deterministic
  // targets from the room seed, serves the server's current question, and
  // resets the answered-lock whenever the question changes. Called by the App's
  // party→store bridge on every snapshot.
  syncPartyMatch: (opts: {
    seed: string
    phase: PartyPhase
    currentQuestion: number
    // The room's selected game mode (server-resolved from the lobby vote).
    mode: string
  }) => void
  // Tear down the multiplayer match (leave / back to menu) and return to idle.
  endPartyMatch: () => void

  // Start a match. `sel` is a sub-mode id (see gameModes.ts); legacy GameMode
  // strings ('classic'/'worldcup'/'capitals') are also accepted for old callers.
  startGame: (seed?: string, sel?: string) => void
  resetGame: () => void
  clearReveal: () => void
  finishGame: () => void
  // Routes a globe click through the game logic when in 'playing' phase.
  // lat/lon are the exact click location on the ellipsoid; they're recorded
  // into the per-country guess history so the stats view can pin them later.
  handleGlobeClick: (
    clicked: string | null,
    lat?: number,
    lon?: number,
  ) => void
  // Capitals mode guess: the player dropped a pin at (lat, lon). Scores it by
  // distance from the current target's capital, drops the guess + answer
  // markers, records it to the server, and advances (or finishes) the match.
  handleCapitalGuess: (lat: number, lon: number) => void
  // Multiplayer city modes: lock in the current round's single pending guess as
  // the final answer (called when the round is about to end so a player who only
  // dropped one pin still gets that score, instead of it being thrown out).
  commitPartyCapitalGuess: () => void
  // Spend a once-per-game capitals lifeline on the current round.
  useLifeline: (which: Lifeline) => void
  // Records a marker drop. The viewer also handles the Cesium-side render via
  // a subscription to `markers`.
  addMarker: (marker: Marker) => void
}

// FNV-1a 32-bit hash; folds an arbitrary seed string down to a u32 to seed
// mulberry32. Avalanches well enough that visually-similar seeds give very
// different draws.
const hashSeed = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Mulberry32 — small, fast, deterministic PRNG. Good enough for a 9-country
// shuffle and reproducible across browsers.
const mulberry32 = (a: number): (() => number) => {
  let s = a >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Partial Fisher-Yates: shuffles only the first n positions, costing O(n)
// rather than O(pool.length). The pool is large (~200 countries) so the saving
// matters.
const drawUniqueTargets = (
  pool: string[],
  seed: string,
  n: number,
): string[] => {
  const arr = pool.slice()
  const limit = Math.min(n, arr.length)
  const rng = mulberry32(hashSeed(seed))
  for (let i = 0; i < limit; i++) {
    const j = i + Math.floor(rng() * (arr.length - i))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr.slice(0, limit)
}

// 6 char base36 → 36⁶ ≈ 2.2 billion possible seeds. Plenty for sharing.
export const generateSeed = (): string =>
  Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0')

// Build the draw pool for a sub-mode from the currently-loaded datasets. For
// the country family the pool is country NAMEs; for the city family it's the
// country NAMEs that have a matched capital (the capitals map keys). Explicit
// name lists are intersected with what actually loaded, so an entry missing
// from the dataset is silently dropped rather than breaking the draw.
const poolForSubMode = (s: GameState, sub: SubMode): string[] => {
  if (sub.family === 'cities') {
    const spec = sub.cities ?? {}
    let entries = Object.entries(s.cities)
    if (spec.capitalsOnly) entries = entries.filter(([, c]) => c.capital)
    if (spec.countries) {
      const set = new Set(spec.countries)
      entries = entries.filter(([, c]) => set.has(c.country))
    }
    // The "all state capitals" set, folded back in below regardless of the
    // population floor/limit so tiny capitals (Montpelier, Pierre, …) survive.
    const stateCapitalKeys = spec.includeStateCapitals
      ? entries.filter(([, c]) => c.stateCapital || c.capital).map(([k]) => k)
      : []
    if (typeof spec.minPopulation === 'number') {
      entries = entries.filter(([, c]) => c.pop >= spec.minPopulation!)
    }
    // Largest-first, with the ne_id key as a deterministic tiebreak so the pool
    // (and therefore the seeded draw) is identical across clients.
    entries.sort((a, b) => b[1].pop - a[1].pop || (a[0] < b[0] ? -1 : 1))
    if (typeof spec.limit === 'number') entries = entries.slice(0, spec.limit)
    // Union the top-N-by-population list with every state capital, deduped by
    // ne_id — a capital already in the top N isn't listed twice. Sorted so the
    // seeded draw stays identical across clients.
    const keys = new Set(entries.map(([k]) => k))
    for (const k of stateCapitalKeys) keys.add(k)
    return [...keys].sort((a, b) => s.cities[b].pop - s.cities[a].pop || (a < b ? -1 : 1))
  }
  if (sub.pool === 'all') return s.countries
  if (sub.pool === 'worldcup') return s.worldCupCountries
  const playable = new Set(s.countries)
  return (sub.pool as string[]).filter((n) => playable.has(n))
}

const US_NAME = 'United States of America'

// The place name to show when a city is revealed. In sub-modes that draw US
// state lines (North America cities), US cities are identified by their state so
// it matches the on-globe boundaries; every other city shows its country.
export const cityRevealName = (city: CityInfo, subMode: string): string => {
  const byState = resolveSubMode(subMode).cities?.usStateLines === true
  if (byState && city.country === US_NAME && city.region) return city.region
  return city.country
}

// A city's rank by population among every loaded US city (not just the mode's
// draw pool) — "the Nth most populous city in the US". Ranked against the full
// populated-places dataset for the country, so a state capital that misses the
// mode's top-100 pool (Montpelier, Pierre, …) still gets an honest, much lower
// rank rather than being compared only within the pool.
export const usPopulationRank = (
  cities: Record<string, CityInfo>,
  key: string,
): number | null => {
  const city = cities[key]
  if (!city) return null
  const pops = Object.values(cities)
    .filter((c) => c.country === US_NAME)
    .map((c) => c.pop)
    .sort((a, b) => b - a)
  const rank = pops.indexOf(city.pop)
  return rank === -1 ? null : rank + 1
}

// The country served for a given position in the pre-drawn sequence, or null
// once the sequence is exhausted (game over).
const targetAt = (targets: string[], index: number): string | null =>
  targets[index] ?? null

// Great-circle distance in miles between two lat/lon points (haversine). Used by
// capitals mode to score a dropped pin against the true capital location.
const EARTH_RADIUS_MI = 3958.8
const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI
export const haversineMiles = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)))
}

// The point reached by travelling `distanceMi` from (lat, lon) along `bearingDeg`
// (0 = north, 90 = east). Used to offset the "draw circle" hint away from the
// true capital so the circle brackets the answer without centring on it.
export const destinationPoint = (
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceMi: number,
): { lat: number; lon: number } => {
  const ang = distanceMi / EARTH_RADIUS_MI
  const brng = toRad(bearingDeg)
  const lat1 = toRad(lat)
  const lon1 = toRad(lon)
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) +
      Math.cos(lat1) * Math.sin(ang) * Math.cos(brng),
  )
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    )
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 }
}

// Capitals-mode "draw circle" lifeline: a 750 mi circle whose centre is nudged
// 600 mi off the true capital (so the answer sits inside it, but off-centre).
export const CIRCLE_RADIUS_MI = 750
export const CIRCLE_OFFSET_MI = 600

// The three once-per-game capitals-mode lifelines.
export type Lifeline = 'name' | 'flag' | 'circle'

// A hint circle to draw on the globe (centre + radius in miles).
export interface HintCircle {
  lat: number
  lon: number
  radiusMi: number
}

// The line drawn from the player's dropped pin to the true capital after a guess.
export interface GuessLine {
  fromLat: number
  fromLon: number
  toLat: number
  toLon: number
}

// Capitals mode: the player's first of two guesses on the current capital.
// Held so the second guess can pick the closer of the two for scoring, and so a
// mid-round refresh resumes with the first guess intact.
export interface RoundGuess {
  lat: number
  lon: number
  distance: number
}

export const useGameStore = create<GameState>((set, get) => ({
  heading: 0,
  setHeading: (heading) => set({ heading }),

  countries: [],
  setCountries: (countries) => set({ countries }),

  worldCupCountries: [],
  setWorldCupCountries: (worldCupCountries) => set({ worldCupCountries }),

  cities: {},
  setCities: (cities) => set({ cities }),

  countryCodes: {},
  setCountryCodes: (countryCodes) => set({ countryCodes }),

  countryIds: loadCountryIds(),
  registerCountries: (names) => {
    set((state) => {
      const ids = { ...state.countryIds }
      // maxId starts at -1 so the first ever country becomes id 0.
      let maxId = -1
      for (const v of Object.values(ids)) if (v > maxId) maxId = v
      let changed = false
      for (const name of names) {
        if (ids[name] === undefined) {
          maxId++
          ids[name] = maxId
          changed = true
        }
      }
      return changed ? { countryIds: ids } : state
    })
  },

  stats: loadStats(),

  selectedStatsCountryId: null,
  selectStatsCountry: (id) => {
    set({ selectedStatsCountryId: id })
    // In global mode, picking a country opens a server subscription for its
    // most-recent guesses; 'all' opens one for the latest guesses across every
    // country. Either way the globe paints what loads. 'mine' mode paints from
    // local history instead, so the server subscription is cleared.
    const { statsMode, countryIds } = get()
    if (statsMode === 'global' && id === 'all') {
      selectGlobalCountryGuesses(ALL_GUESSES)
    } else if (statsMode === 'global' && typeof id === 'number') {
      let name: string | null = null
      for (const k in countryIds) {
        if (countryIds[k] === id) {
          name = k
          break
        }
      }
      selectGlobalCountryGuesses(name)
    } else {
      selectGlobalCountryGuesses(null)
    }
  },

  statsMode: 'mine',
  setStatsMode: (mode) => {
    // Switching mode clears the current selection so we don't carry a 'mine'
    // highlight into the 'global' dataset (or vice versa).
    selectGlobalCountryGuesses(null)
    set({ statsMode: mode, selectedStatsCountryId: null })
  },

  globalStats: {},
  myStats: {},
  setServerStats: (global, mine) =>
    set({ globalStats: global, myStats: mine }),

  globalGuesses: { country: null, dots: [] },
  setGlobalGuesses: (country, dots) =>
    set({ globalGuesses: { country, dots } }),

  country: null,
  setCountry: (country) => set({ country }),

  perfectStreak: loadPerfectStreak(),

  phase: 'idle',
  mode: 'classic',
  subMode: 'all',
  seed: null,
  targets: [],
  targetIndex: 0,
  target: null,
  attempts: [],
  distances: [],
  lifelinesUsed: { name: false, flag: false, circle: false },
  revealName: false,
  revealFlag: false,
  hintCircle: null,
  guessLine: null,
  roundGuess: null,
  markerEpoch: 0,
  markers: [],
  consecutiveWrong: 0,
  revealTarget: null,
  endingTarget: null,
  multiplayer: false,
  partyAnswered: false,
  inputLockUntil: 0,

  syncPartyMatch: ({ seed, phase, currentQuestion, mode }) => {
    const s = get()
    // The room's mode is a sub-mode id (see gameModes.ts). Resolve it to the
    // behavioural mode + id, exactly like single-player, so party matches get
    // the regional pools + city modes for free (defaults to All if unknown).
    const sub = resolveSubMode(mode)
    const gameMode = behavioralModeOf(sub)
    const subMode = sub.id

    if (phase === 'finished') {
      set({
        multiplayer: true,
        mode: gameMode,
        subMode,
        phase: 'finished',
        target: null,
      })
      return
    }
    if (phase !== 'playing') return

    // Draw the deterministic sequence the first time (or if the seed/mode
    // changed). The pool + length follow the room's chosen sub-mode, so all
    // clients serve identical questions from the room seed.
    const pool = poolForSubMode(get(), sub)
    const rounds = roundsForMode(gameMode)
    const needDraw =
      !s.multiplayer ||
      s.seed !== seed ||
      s.mode !== gameMode ||
      s.targets.length === 0
    const targets = needDraw ? drawUniqueTargets(pool, seed, rounds) : s.targets
    if (targets.length === 0) return

    const idx = Math.min(currentQuestion, targets.length)
    const questionChanged = needDraw || idx !== s.targetIndex
    // Capitals shows one guess + answer per round, so wipe the board when the
    // question changes; classic/worldcup accumulate their guess pins.
    const isCapitals = gameMode === 'capitals'
    const wipeMarkers = needDraw || (isCapitals && questionChanged)
    set({
      multiplayer: true,
      mode: gameMode,
      subMode,
      phase: 'playing',
      seed,
      targets,
      targetIndex: idx,
      target: targetAt(targets, idx),
      // New question (or fresh match) clears the answered-lock and last guess.
      partyAnswered: questionChanged ? false : s.partyAnswered,
      // Brief input lock so a click meant for the previous capital/country
      // doesn't register against the freshly-served one.
      inputLockUntil: questionChanged ? lockUntil() : s.inputLockUntil,
      country: questionChanged ? null : s.country,
      markers: wipeMarkers ? [] : s.markers,
      markerEpoch: wipeMarkers ? s.markerEpoch + 1 : s.markerEpoch,
      attempts: needDraw ? [] : s.attempts,
      distances: needDraw ? [] : s.distances,
      // Lifelines are once-per-match; the per-round reveals reset each question.
      lifelinesUsed: needDraw
        ? { name: false, flag: false, circle: false }
        : s.lifelinesUsed,
      revealName: questionChanged ? false : s.revealName,
      revealFlag: questionChanged ? false : s.revealFlag,
      hintCircle: questionChanged ? null : s.hintCircle,
      guessLine: questionChanged ? null : s.guessLine,
      // Preserve an in-progress first guess (capitals gets two tries per round);
      // only a new question clears it, so a mid-round snapshot update from another
      // player doesn't reset our pending guess.
      roundGuess: questionChanged ? null : s.roundGuess,
      revealTarget: null,
      endingTarget: null,
    })
  },

  endPartyMatch: () => {
    set({
      multiplayer: false,
      partyAnswered: false,
      phase: 'idle',
      mode: 'classic',
      subMode: 'all',
      seed: null,
      targets: [],
      targetIndex: 0,
      target: null,
      attempts: [],
      distances: [],
      lifelinesUsed: { name: false, flag: false, circle: false },
      revealName: false,
      revealFlag: false,
      hintCircle: null,
      guessLine: null,
      roundGuess: null,
      markers: [],
      country: null,
      consecutiveWrong: 0,
      revealTarget: null,
      endingTarget: null,
    })
  },

  startGame: (seed, sel) => {
    // Resolve the selection (sub-mode id or legacy mode string) to a sub-mode,
    // then derive the behaviour and the filtered draw pool from it.
    const sub = resolveSubMode(sel)
    const mode = behavioralModeOf(sub)
    const pool = poolForSubMode(get(), sub)
    if (pool.length === 0) return
    const matchSeed = seed ?? generateSeed()
    // Capitals mode is a shorter, 5-capital match; classic/worldcup use ROUNDS.
    const roundCount = mode === 'capitals' ? CAPITAL_ROUNDS : ROUNDS
    const targets = drawUniqueTargets(pool, matchSeed, roundCount)
    if (targets.length === 0) return

    // Resume only if the seed AND the sub-mode match the saved match — the same
    // seed draws a different sequence per sub-mode. A different seed/sub-mode
    // (Play Again, switching regions, or a friend's URL) starts fresh; the
    // persistence subscriber will overwrite the save below. Legacy saves without
    // a `subMode` fall back to the one implied by their `mode`.
    const saved = loadSave()
    const savedSub = saved?.subMode ?? resolveSubMode(saved?.mode).id
    const restore =
      saved && saved.seed === matchSeed && savedSub === sub.id ? saved : null
    const attempts = restore?.attempts ?? []
    const distances = restore?.distances ?? []
    const markers = restore?.markers ?? []
    const consecutiveWrong = restore?.consecutiveWrong ?? 0
    const targetIndex = restore?.targetIndex ?? 0
    const roundGuess = restore?.roundGuess ?? null
    // Capitals mode records one distance per completed capital, so it finishes
    // once every capital has a recorded distance; classic/worldcup finish on the
    // guess budget.
    const finished =
      mode === 'capitals'
        ? distances.length >= CAPITAL_ROUNDS
        : targetIndex >= ROUNDS

    set({
      phase: finished ? 'finished' : 'playing',
      mode,
      subMode: sub.id,
      seed: matchSeed,
      targets,
      targetIndex,
      target: finished ? null : targetAt(targets, targetIndex),
      attempts,
      distances,
      lifelinesUsed: { name: false, flag: false, circle: false },
      revealName: false,
      revealFlag: false,
      hintCircle: null,
      guessLine: null,
      roundGuess,
      markers,
      country: null,
      consecutiveWrong,
      revealTarget: null,
      endingTarget: null,
      multiplayer: false,
      partyAnswered: false,
      // Settle the intro camera before the first click can land.
      inputLockUntil: finished ? 0 : lockUntil(),
    })
  },

  resetGame: () =>
    set({
      phase: 'idle',
      mode: 'classic',
      subMode: 'all',
      seed: null,
      targets: [],
      targetIndex: 0,
      target: null,
      attempts: [],
      distances: [],
      lifelinesUsed: { name: false, flag: false, circle: false },
      revealName: false,
      revealFlag: false,
      hintCircle: null,
      guessLine: null,
      roundGuess: null,
      markers: [],
      country: null,
      consecutiveWrong: 0,
      revealTarget: null,
      endingTarget: null,
      multiplayer: false,
      partyAnswered: false,
    }),

  clearReveal: () =>
    set((state) => {
      // A reveal that spends the last guess ends the match (with a miss, so the
      // streak resets). Mid-game reveals leave phase/streak untouched.
      const finished = state.attempts.length >= ROUNDS
      return {
        revealTarget: null,
        // Guessing was blocked through the reveal; now the next target is live,
        // so hold input briefly to avoid a click meant for the revealed answer.
        inputLockUntil: finished ? state.inputLockUntil : lockUntil(),
        phase: finished ? 'finished' : state.phase,
        perfectStreak: finished
          ? nextPerfectStreak(state.attempts, state.perfectStreak)
          : state.perfectStreak,
      }
    }),

  // Reached only after the final correct guess's celebratory pan. The match is
  // perfect iff every round was correct.
  finishGame: () =>
    set((s) => ({
      phase: 'finished',
      endingTarget: null,
      perfectStreak: nextPerfectStreak(s.attempts, s.perfectStreak),
    })),

  handleGlobeClick: (clicked, lat, lon) => {
    set({ country: clicked })

    const s = get()

    // ---- Multiplayer party path ----
    // One server guess per question, no local budget/reveal logic. The question
    // pointer advances only when the server does (via syncPartyMatch), so a
    // second click is ignored until then.
    if (s.multiplayer) {
      if (s.phase !== 'playing' || clicked === null || s.target === null) return
      if (s.partyAnswered) return
      const correct = clicked === s.target
      if (correct) sfxCorrect()
      else sfxWrong()
      const nextStats = applyGuessStats(s, s.target, clicked, lat, lon)
      submitPartyGuess(s.targetIndex, correct)
      set({
        partyAnswered: true,
        ...(nextStats ? { stats: nextStats } : {}),
      })
      return
    }

    // Ignore clicks during reveal/ending animations; the viewer is repositioning.
    if (
      s.phase !== 'playing' ||
      clicked === null ||
      s.revealTarget !== null ||
      s.endingTarget !== null
    )
      return

    // No active country (sequence exhausted) → nothing to guess against.
    if (s.target === null || s.targetIndex >= ROUNDS) return

    // Record this guess against the active target in the persistent stats
    // before we mutate any game state. Skipped if either name lacks an ID
    // (registerCountries hasn't run yet — shouldn't happen in practice).
    if (s.target) {
      const nextStats = applyGuessStats(s, s.target, clicked, lat, lon)
      if (nextStats) set({ stats: nextStats })
    }

    const correct = clicked === s.target

    // Audible feedback for the placement, before any state transition.
    if (correct) sfxCorrect()
    else sfxWrong()

    // The player has a fixed budget of ROUNDS guesses for the whole match. Each
    // click consumes one (logged here), and the match ends once all are spent —
    // so a miss costs a guess that would otherwise have reached a later country.
    // The country pointer is separate: it only advances on a correct guess or
    // the second consecutive miss, and a miss never adds a guess to the budget.
    const attempts: AttemptResult[] = [
      ...s.attempts,
      correct ? 'correct' : 'wrong',
    ]
    const finished = attempts.length >= ROUNDS

    if (correct) {
      const targetIndex = s.targetIndex + 1
      // On the final guess, hand the camera to the viewer for a celebratory pan.
      // Phase stays 'playing' until finishGame() fires after the hold.
      set({
        attempts,
        targetIndex,
        consecutiveWrong: 0,
        target: finished ? null : targetAt(s.targets, targetIndex),
        endingTarget: finished ? clicked : null,
        // New target next — brief lock so a double-click doesn't burn a guess.
        inputLockUntil: finished ? s.inputLockUntil : lockUntil(),
      })
      return
    }

    const newWrong = s.consecutiveWrong + 1
    if (newWrong < WRONG_GUESSES_BEFORE_REVEAL && !finished) {
      // Still have a guess left on this country (and in the match) — log the
      // miss but keep the same target so the next click retries it.
      set({ attempts, consecutiveWrong: newWrong, target: s.target })
      return
    }

    // Reveal the answer: either this is the second miss on the country, or the
    // guess budget just ran out mid-country. Advance the pointer only on a true
    // second miss. Phase stays 'playing' through the reveal hold; clearReveal
    // flips to 'finished' once the guess budget is spent.
    const doubleMiss = newWrong >= WRONG_GUESSES_BEFORE_REVEAL
    const targetIndex = doubleMiss ? s.targetIndex + 1 : s.targetIndex
    set({
      attempts,
      targetIndex,
      consecutiveWrong: 0,
      revealTarget: s.target,
      target: finished ? null : targetAt(s.targets, targetIndex),
      phase: 'playing',
    })
  },

  handleCapitalGuess: (lat, lon) => {
    const s = get()
    if (s.mode !== 'capitals') return
    if (s.phase !== 'playing' || s.target === null) return
    // The target is a city key (ne_id); look up the city being asked for.
    const cap = s.cities[s.target]
    if (!cap) return
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return

    const NEAR_MI = CAPITAL_NEAR_MI
    // Cap the scored miss: anything past MAX_CAPITAL_MILES scores the same, so a
    // wild guess costs no more than a no-guess timeout (also charged the cap).
    const distance = Math.min(
      haversineMiles(lat, lon, cap.lat, cap.lon),
      MAX_CAPITAL_MILES,
    )
    const near = distance <= NEAR_MI

    // A guess dot labelled with its own (capped) miss distance. Grey by default;
    // the closer of the two guesses — the one that actually scores — is drawn
    // yellow. Shared by the multiplayer and single-player paths.
    const pinFor = (
      gLat: number,
      gLon: number,
      dist: number,
      used = false,
    ): Marker => ({
      lat: gLat,
      lon: gLon,
      kind: used ? 'guess-best' : 'guess',
      label: `${Math.round(dist).toLocaleString()} mi`,
    })

    // ---- Multiplayer party path: two guesses per capital, closer one counts. ----
    // Like single-player, the first drop only shows a pin + distance (no reveal,
    // nothing scored). The second drop submits the best distance to the server
    // (golf-scored) and reveals the answer, locking the round.
    if (s.multiplayer) {
      if (s.partyAnswered) return
      if (near) sfxCorrect()
      else sfxWrong()

      // First of two guesses: show the pin + distance only, no answer, no submit.
      if (s.roundGuess === null) {
        set({
          roundGuess: { lat, lon, distance },
          markers: [pinFor(lat, lon, distance)],
          markerEpoch: s.markerEpoch + 1,
          guessLine: null,
        })
        return
      }

      // Second guess: score the closer of the two, submit once, reveal, lock.
      const first = s.roundGuess
      const best = Math.min(first.distance, distance)
      // The current (second) guess scores when it's at least as close as the first.
      const currentBest = distance <= first.distance
      const scoring = currentBest
        ? { lat, lon }
        : { lat: first.lat, lon: first.lon }
      submitPartyGuess(s.targetIndex, best <= NEAR_MI, best)
      set({
        partyAnswered: true,
        roundGuess: null,
        markers: [
          pinFor(first.lat, first.lon, first.distance, !currentBest),
          pinFor(lat, lon, distance, currentBest),
          {
            lat: cap.lat,
            lon: cap.lon,
            kind: 'reveal',
            label: `${cap.city},\n${cityRevealName(cap, s.subMode)}`,
            code: s.countryCodes[cap.country],
          },
        ],
        markerEpoch: s.markerEpoch + 1,
        guessLine: {
          fromLat: scoring.lat,
          fromLon: scoring.lon,
          toLat: cap.lat,
          toLon: cap.lon,
        },
        hintCircle: null,
      })
      return
    }

    // ---- Single-player path ----
    if (s.distances.length >= CAPITAL_ROUNDS) return

    if (near) sfxCorrect()
    else sfxWrong()

    // ---- First of two guesses: show the pin + distance, hide the answer. ----
    // The round doesn't advance and nothing is scored yet — the player gets a
    // second attempt, and only the closer of the two counts.
    if (s.roundGuess === null) {
      set({
        roundGuess: { lat, lon, distance },
        // Replace the previous round's markers with just this guess pin. The
        // hint circle / name / flag reveals persist into the second guess.
        markers: [pinFor(lat, lon, distance)],
        markerEpoch: s.markerEpoch + 1,
        // No line yet — that would reveal where the answer is.
        guessLine: null,
      })
      return
    }

    // ---- Second guess: score the closer of the two, reveal, advance. ----
    const first = s.roundGuess
    const best = Math.min(first.distance, distance)
    // The current (second) guess scores when it's at least as close as the first;
    // its pin is the one the answer line connects to and is drawn yellow.
    const currentBest = distance <= first.distance
    const scoring = currentBest
      ? { lat, lon }
      : { lat: first.lat, lon: first.lon }

    // Persist the scoring guess + the answer + the (best) distance to SpacetimeDB.
    recordCapitalGuess({
      country: cap.country,
      guessLat: scoring.lat,
      guessLon: scoring.lon,
      targetLat: cap.lat,
      targetLon: cap.lon,
      distanceMi: best,
    })

    const distances = [...s.distances, best]
    const targetIndex = s.targetIndex + 1
    const finished = distances.length >= CAPITAL_ROUNDS
    set({
      distances,
      // Both guess dots (the closer one yellow) plus the reveal pin: the
      // country's flag with a two-line "City,\nCountry" label above it (flag from
      // the explicit `code`, since the label text isn't a plain country name).
      markers: [
        pinFor(first.lat, first.lon, first.distance, !currentBest),
        pinFor(lat, lon, distance, currentBest),
        {
          lat: cap.lat,
          lon: cap.lon,
          kind: 'reveal',
          label: `${cap.city},\n${cityRevealName(cap, s.subMode)}`,
          code: s.countryCodes[cap.country],
        },
      ],
      markerEpoch: s.markerEpoch + 1,
      // Line from the scoring (closer) guess to the answer.
      guessLine: {
        fromLat: scoring.lat,
        fromLon: scoring.lon,
        toLat: cap.lat,
        toLon: cap.lon,
      },
      hintCircle: null,
      revealName: false,
      revealFlag: false,
      roundGuess: null,
      targetIndex,
      target: finished ? null : targetAt(s.targets, targetIndex),
      phase: finished ? 'finished' : 'playing',
      // Next capital served — hold input so a stray click doesn't guess it.
      inputLockUntil: finished ? s.inputLockUntil : lockUntil(),
    })
  },

  commitPartyCapitalGuess: () => {
    const s = get()
    if (!s.multiplayer || s.mode !== 'capitals' || s.phase !== 'playing') return
    if (s.partyAnswered || s.roundGuess === null || s.target === null) return
    const cap = s.cities[s.target]
    if (!cap) return
    // The one pin the player did drop becomes the scoring guess (drawn yellow).
    const g = s.roundGuess
    submitPartyGuess(s.targetIndex, g.distance <= CAPITAL_NEAR_MI, g.distance)
    set({
      partyAnswered: true,
      roundGuess: null,
      markers: [
        {
          lat: g.lat,
          lon: g.lon,
          kind: 'guess-best',
          label: `${Math.round(g.distance).toLocaleString()} mi`,
        },
        {
          lat: cap.lat,
          lon: cap.lon,
          kind: 'reveal',
          label: `${cap.city},\n${cityRevealName(cap, s.subMode)}`,
          code: s.countryCodes[cap.country],
        },
      ],
      markerEpoch: s.markerEpoch + 1,
      guessLine: {
        fromLat: g.lat,
        fromLon: g.lon,
        toLat: cap.lat,
        toLon: cap.lon,
      },
      hintCircle: null,
    })
  },

  useLifeline: (which) => {
    const s = get()
    if (s.mode !== 'capitals' || s.phase !== 'playing' || s.target === null)
      return
    if (s.lifelinesUsed[which]) return
    const lifelinesUsed = { ...s.lifelinesUsed, [which]: true }
    // In a party match, broadcast the lifeline so every client toasts it.
    if (s.multiplayer) sendPartyLifeline(which)
    if (which === 'name') {
      set({ lifelinesUsed, revealName: true })
    } else if (which === 'flag') {
      set({ lifelinesUsed, revealFlag: true })
    } else {
      const cap = s.cities[s.target]
      if (!cap) return
      // Offset the circle centre a fixed distance in a random direction so the
      // true capital lands inside the circle but not at its centre.
      const bearing = Math.random() * 360
      const c = destinationPoint(cap.lat, cap.lon, bearing, CIRCLE_OFFSET_MI)
      set({
        lifelinesUsed,
        hintCircle: { lat: c.lat, lon: c.lon, radiusMi: CIRCLE_RADIUS_MI },
      })
    }
  },

  addMarker: (marker) =>
    set((state) => ({ markers: [...state.markers, marker] })),
}))

// Persist the in-progress match to localStorage on every relevant change.
// Only a single match is stored — starting a different seed overwrites it,
// satisfying the "clear data when a new seed is started" requirement.
useGameStore.subscribe((state, prev) => {
  if (!state.seed) return
  // Party matches are server-authoritative and never resumed from localStorage.
  if (state.multiplayer) return
  if (
    state.seed === prev.seed &&
    state.attempts === prev.attempts &&
    state.distances === prev.distances &&
    state.targetIndex === prev.targetIndex &&
    state.markers === prev.markers &&
    state.consecutiveWrong === prev.consecutiveWrong &&
    state.roundGuess === prev.roundGuess
  )
    return
  writeSave({
    seed: state.seed,
    mode: state.mode,
    subMode: state.subMode,
    attempts: state.attempts,
    distances: state.distances,
    targetIndex: state.targetIndex,
    consecutiveWrong: state.consecutiveWrong,
    markers: state.markers,
    roundGuess: state.roundGuess,
  })
})

// Persist long-lived state (IDs and stats) independently of the match save —
// it survives across matches and is never wiped by a "new game".
useGameStore.subscribe((state, prev) => {
  if (state.countryIds !== prev.countryIds) writeJSON(IDS_KEY, state.countryIds)
  if (state.stats !== prev.stats) writeJSON(STATS_KEY, state.stats)
  if (state.perfectStreak !== prev.perfectStreak)
    writeJSON(PERFECT_STREAK_KEY, state.perfectStreak)
})
