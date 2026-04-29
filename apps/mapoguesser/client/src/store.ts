import { create } from 'zustand'

interface GameState {
  heading: number
  setHeading: (heading: number) => void
}

export const useGameStore = create<GameState>((set) => ({
  heading: 0,
  setHeading: (heading) => set({ heading }),
}))
