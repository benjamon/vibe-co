import { create } from 'zustand'

export type CoinFace = 'heads' | 'tails'

interface GameState {
  flipping: boolean
  result: CoinFace | null
  pendingResult: CoinFace | null
  headsCount: number
  tailsCount: number
  flips: number
  startFlip: () => void
  finishFlip: () => void
  reset: () => void
}

export const useGameStore = create<GameState>((set, get) => ({
  flipping: false,
  result: null,
  pendingResult: null,
  headsCount: 0,
  tailsCount: 0,
  flips: 0,
  startFlip: () => {
    if (get().flipping) return
    const next: CoinFace = Math.random() < 0.5 ? 'heads' : 'tails'
    set({ flipping: true, result: null, pendingResult: next })
  },
  finishFlip: () => {
    const { pendingResult, headsCount, tailsCount, flips } = get()
    if (!pendingResult) return
    set({
      flipping: false,
      result: pendingResult,
      pendingResult: null,
      headsCount: headsCount + (pendingResult === 'heads' ? 1 : 0),
      tailsCount: tailsCount + (pendingResult === 'tails' ? 1 : 0),
      flips: flips + 1,
    })
  },
  reset: () =>
    set({
      flipping: false,
      result: null,
      pendingResult: null,
      headsCount: 0,
      tailsCount: 0,
      flips: 0,
    }),
}))
