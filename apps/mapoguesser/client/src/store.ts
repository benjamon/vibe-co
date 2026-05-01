import { create } from 'zustand'

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

interface GameState {
  heading: number
  setHeading: (heading: number) => void

  // Available country names, populated by WorldViewer once Natural Earth
  // GeoJSON has loaded. The Start button stays disabled until non-empty.
  countries: string[]
  setCountries: (countries: string[]) => void

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
  handleGlobeClick: (clicked: string | null) => void
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

  handleGlobeClick: (clicked) => {
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

    const correct = clicked === s.target
    const next = [...s.attempts]
    next[idx] = correct ? 'correct' : 'wrong'

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
