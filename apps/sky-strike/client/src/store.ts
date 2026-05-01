import { create } from 'zustand'

interface GameState {
  started: boolean
  gameOver: boolean
  score: number
  lives: number
  highScore: number
  start: () => void
  end: () => void
  reset: () => void
  addScore: (n: number) => void
  loseLife: () => void
}

const INITIAL_LIVES = 3

export const useGameStore = create<GameState>((set, get) => ({
  started: false,
  gameOver: false,
  score: 0,
  lives: INITIAL_LIVES,
  highScore: 0,
  start: () => set({ started: true, gameOver: false, score: 0, lives: INITIAL_LIVES }),
  end: () =>
    set((s) => ({
      started: false,
      gameOver: true,
      highScore: Math.max(s.highScore, s.score),
    })),
  reset: () => set({ started: false, gameOver: false, score: 0, lives: INITIAL_LIVES }),
  addScore: (n) => set((s) => ({ score: s.score + n })),
  loseLife: () => {
    const next = get().lives - 1
    if (next <= 0) {
      set({ lives: 0 })
      get().end()
    } else {
      set({ lives: next })
    }
  },
}))
