import { createStore } from 'zustand/vanilla'

interface GameState {
  started: boolean
  elapsed: number
}

interface GameActions {
  start: () => void
  tick: (dt: number) => void
}

export const gameStore = createStore<GameState & GameActions>((set) => ({
  started: false,
  elapsed: 0,
  start: () => set({ started: true }),
  tick: (dt) => set((s) => ({ elapsed: s.elapsed + dt })),
}))
