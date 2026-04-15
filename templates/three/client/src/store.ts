import { create } from 'zustand'

interface GameState {
  started: boolean
  elapsed: number
  start: () => void
  tick: (dt: number) => void
}

export const useGameStore = create<GameState>((set) => ({
  started: false,
  elapsed: 0,
  start: () => set({ started: true }),
  tick: (dt) => set((s) => ({ elapsed: s.elapsed + dt })),
}))
