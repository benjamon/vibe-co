import { create } from 'zustand'
import { sfxCorrect, sfxWrong } from './sfx'
import {
  recordGuess,
  selectGlobalCountryGuesses,
  ALL_GUESSES,
  type CountryAgg,
  type GuessDot,
} from './stats'

// Which dataset the stats sidebar shows. 'mine' = this player's local history
// (also mirrored to the server); 'global' = aggregate totals across all users
// pulled from SpacetimeDB.
export type StatsMode = 'mine' | 'global'

export type AttemptResult = 'pending' | 'correct' | 'wrong'
export type GamePhase = 'idle' | 'playing' | 'finished'
// Sprite kind drawn at the marker location: green pin for a correct guess,
// grey pin for the wrong country the player clicked, red X for the centroid
// reveal of a missed target.
export type MarkerKind = 'correct' | 'wrong' | 'reveal'
export interface Marker {
  lat: number
  lon: number
  kind: MarkerKind
  label: string
}

export const ROUNDS = 9
export const WRONG_GUESSES_BEFORE_REVEAL = 2

// Single-slot save: a returning player can resume one in-progress match.
// Starting a different seed overwrites it.
const SAVE_KEY = 'mapoguesser:save'
// Persistent across matches: stable integer ID per country (grow-only) and
// the guess history / rolling score keyed by those IDs.
const IDS_KEY = 'mapoguesser:countryIds'
const STATS_KEY = 'mapoguesser:stats'

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
  attempts: AttemptResult[]
  consecutiveWrong: number
  markers: Marker[]
}

const isSavedMatch = (v: unknown): v is SavedMatch => {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.seed === 'string' &&
    Array.isArray(o.attempts) &&
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

interface GameState {
  heading: number
  setHeading: (heading: number) => void

  // Available country names, populated by WorldViewer once Natural Earth
  // GeoJSON has loaded. The Start button stays disabled until non-empty.
  countries: string[]
  setCountries: (countries: string[]) => void

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

  // Game flow.
  phase: GamePhase
  // Match seed (base36, 6 chars). Drives the deterministic target draw and is
  // mirrored to the URL so a link reproduces the same match.
  seed: string | null
  // The full draw of ROUNDS unique countries for this match, in order.
  targets: string[]
  target: string | null
  attempts: AttemptResult[]
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

  startGame: (seed?: string) => void
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

const emptyAttempts = (): AttemptResult[] =>
  Array.from({ length: ROUNDS }, () => 'pending')

// Index into the precomputed targets list based on how many attempts have
// resolved. Returns null past the end (final round has no follow-up).
const targetAfter = (
  targets: string[],
  attempts: AttemptResult[],
): string | null => {
  const resolved = attempts.filter((a) => a !== 'pending').length
  return targets[resolved] ?? null
}

export const useGameStore = create<GameState>((set, get) => ({
  heading: 0,
  setHeading: (heading) => set({ heading }),

  countries: [],
  setCountries: (countries) => set({ countries }),

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

  phase: 'idle',
  seed: null,
  targets: [],
  target: null,
  attempts: [],
  markers: [],
  consecutiveWrong: 0,
  revealTarget: null,
  endingTarget: null,

  startGame: (seed) => {
    const pool = get().countries
    if (pool.length === 0) return
    const matchSeed = seed ?? generateSeed()
    const targets = drawUniqueTargets(pool, matchSeed, ROUNDS)
    if (targets.length === 0) return

    // Resume only if the requested seed matches the saved match. A different
    // seed (Play Again, or a friend's URL) starts fresh — the persistence
    // subscriber will overwrite the save below.
    const saved = loadSave()
    const restore =
      saved && saved.seed === matchSeed && saved.attempts.length === ROUNDS
        ? saved
        : null
    const attempts = restore?.attempts ?? emptyAttempts()
    const markers = restore?.markers ?? []
    const consecutiveWrong = restore?.consecutiveWrong ?? 0
    const finished = attempts.every((a) => a !== 'pending')

    set({
      phase: finished ? 'finished' : 'playing',
      seed: matchSeed,
      targets,
      target: finished ? null : targetAfter(targets, attempts),
      attempts,
      markers,
      country: null,
      consecutiveWrong,
      revealTarget: null,
      endingTarget: null,
    })
  },

  resetGame: () =>
    set({
      phase: 'idle',
      seed: null,
      targets: [],
      target: null,
      attempts: [],
      markers: [],
      country: null,
      consecutiveWrong: 0,
      revealTarget: null,
      endingTarget: null,
    }),

  clearReveal: () =>
    set((state) => ({
      revealTarget: null,
      phase: state.attempts.every((a) => a !== 'pending')
        ? 'finished'
        : state.phase,
    })),

  finishGame: () => set({ phase: 'finished', endingTarget: null }),

  handleGlobeClick: (clicked, lat, lon) => {
    set({ country: clicked })

    const s = get()
    // Ignore clicks during reveal/ending animations; the viewer is repositioning.
    if (
      s.phase !== 'playing' ||
      clicked === null ||
      s.revealTarget !== null ||
      s.endingTarget !== null
    )
      return

    const idx = s.attempts.findIndex((a) => a === 'pending')
    if (idx === -1) return

    // Record this guess against the active target in the persistent stats
    // before we mutate any game state. Skipped if either name lacks an ID
    // (registerCountries hasn't run yet — shouldn't happen in practice).
    if (s.target) {
      // Mirror the guess to the server, keyed by country NAME (stable across
      // clients) and the player's random user id. lat/lon may be undefined for
      // guesses made outside the globe viewer (e.g. unit tests); recordGuess
      // guards on finite coordinates and no-ops in that case.
      recordGuess(s.target, clicked, lat as number, lon as number)

      const targetId = s.countryIds[s.target]
      const guessId = s.countryIds[clicked]
      if (targetId !== undefined && guessId !== undefined) {
        const existing = s.stats[targetId] ?? { guesses: [], score: 0 }
        const record: GuessRecord = { id: guessId }
        if (typeof lat === 'number' && Number.isFinite(lat)) record.lat = lat
        if (typeof lon === 'number' && Number.isFinite(lon)) record.lon = lon
        const guesses = [...existing.guesses, record]
        set({
          stats: {
            ...s.stats,
            [targetId]: {
              guesses,
              score: computeScore(guesses, targetId),
            },
          },
        })
      }
    }

    const correct = clicked === s.target
    const next = [...s.attempts]
    next[idx] = correct ? 'correct' : 'wrong'

    // Audible feedback for the placement, before any state transition.
    if (correct) sfxCorrect()
    else sfxWrong()

    const finished = next.every((a) => a !== 'pending')

    if (correct) {
      // On the final round, hand the camera to the viewer for a celebratory
      // pan. Phase stays 'playing' until finishGame() fires after the hold.
      set({
        attempts: next,
        consecutiveWrong: 0,
        target: finished ? null : targetAfter(s.targets, next),
        endingTarget: finished ? clicked : null,
      })
      return
    }

    const newWrong = s.consecutiveWrong + 1
    // Always reveal on the final round so the player sees where they missed,
    // not just the score screen. Phase stays 'playing' through the reveal hold;
    // clearReveal flips to 'finished' once attempts are full.
    if (newWrong >= WRONG_GUESSES_BEFORE_REVEAL || finished) {
      set({
        attempts: next,
        consecutiveWrong: 0,
        revealTarget: s.target,
        target: finished ? null : targetAfter(s.targets, next),
        phase: 'playing',
      })
      return
    }

    set({
      attempts: next,
      consecutiveWrong: newWrong,
      target: s.target,
    })
  },

  addMarker: (marker) =>
    set((state) => ({ markers: [...state.markers, marker] })),
}))

// Persist the in-progress match to localStorage on every relevant change.
// Only a single match is stored — starting a different seed overwrites it,
// satisfying the "clear data when a new seed is started" requirement.
useGameStore.subscribe((state, prev) => {
  if (!state.seed) return
  if (
    state.seed === prev.seed &&
    state.attempts === prev.attempts &&
    state.markers === prev.markers &&
    state.consecutiveWrong === prev.consecutiveWrong
  )
    return
  writeSave({
    seed: state.seed,
    attempts: state.attempts,
    consecutiveWrong: state.consecutiveWrong,
    markers: state.markers,
  })
})

// Persist long-lived state (IDs and stats) independently of the match save —
// it survives across matches and is never wiped by a "new game".
useGameStore.subscribe((state, prev) => {
  if (state.countryIds !== prev.countryIds) writeJSON(IDS_KEY, state.countryIds)
  if (state.stats !== prev.stats) writeJSON(STATS_KEY, state.stats)
})
