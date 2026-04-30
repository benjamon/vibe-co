import { create } from 'zustand'

export type AttemptResult = 'pending' | 'correct' | 'wrong'
export type GamePhase = 'idle' | 'playing' | 'finished'

export const ROUNDS = 9
export const WRONG_GUESSES_BEFORE_REVEAL = 2

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
  target: string | null
  attempts: AttemptResult[]
  // Wrong guesses on the *current* target. Resets on correct guess or reveal.
  consecutiveWrong: number
  // When non-null, the WorldViewer is expected to fly the camera to this
  // country and drop an X marker, then call clearReveal().
  revealTarget: string | null
  // When non-null, the player just got the *final* round correct. The viewer
  // pans to this country, holds 2 s, then calls finishGame() to transition to
  // the 'finished' phase. Keeps the score-screen handoff cinematic.
  endingTarget: string | null

  startGame: () => void
  resetGame: () => void
  clearReveal: () => void
  finishGame: () => void
  // Routes a globe click through the game logic when in 'playing' phase.
  handleGlobeClick: (clicked: string | null) => void
}

const pickTarget = (pool: string[], exclude: string | null): string | null => {
  if (pool.length === 0) return null
  const choices = exclude ? pool.filter((c) => c !== exclude) : pool
  const list = choices.length > 0 ? choices : pool
  return list[Math.floor(Math.random() * list.length)] ?? null
}

const emptyAttempts = (): AttemptResult[] =>
  Array.from({ length: ROUNDS }, () => 'pending')

export const useGameStore = create<GameState>((set, get) => ({
  heading: 0,
  setHeading: (heading) => set({ heading }),

  countries: [],
  setCountries: (countries) => set({ countries }),

  country: null,
  setCountry: (country) => set({ country }),

  phase: 'idle',
  target: null,
  attempts: [],
  consecutiveWrong: 0,
  revealTarget: null,
  endingTarget: null,

  startGame: () => {
    const pool = get().countries
    if (pool.length === 0) return
    set({
      phase: 'playing',
      target: pickTarget(pool, null),
      attempts: emptyAttempts(),
      country: null,
      consecutiveWrong: 0,
      revealTarget: null,
      endingTarget: null,
    })
  },

  resetGame: () =>
    set({
      phase: 'idle',
      target: null,
      attempts: [],
      country: null,
      consecutiveWrong: 0,
      revealTarget: null,
      endingTarget: null,
    }),

  clearReveal: () => set({ revealTarget: null }),

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
        target: finished ? null : pickTarget(s.countries, s.target),
        endingTarget: finished ? clicked : null,
      })
      return
    }

    const newWrong = s.consecutiveWrong + 1
    if (newWrong >= WRONG_GUESSES_BEFORE_REVEAL) {
      // Trigger camera reveal; viewer drops an X at the target's centroid.
      set({
        attempts: next,
        consecutiveWrong: 0,
        revealTarget: s.target,
        target: finished ? null : pickTarget(s.countries, s.target),
        phase: finished ? 'finished' : 'playing',
      })
      return
    }

    set({
      attempts: next,
      consecutiveWrong: newWrong,
      target: finished ? null : s.target,
      phase: finished ? 'finished' : 'playing',
    })
  },
}))
