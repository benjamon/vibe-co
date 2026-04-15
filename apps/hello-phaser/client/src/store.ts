import { createStore } from 'zustand/vanilla'

interface GameState {
  started: boolean
  elapsed: number
  coins: number
  totalCoins: number
}

interface GameActions {
  start: () => void
  tick: (dt: number) => void
  collectCoin: () => void
  setTotalCoins: (n: number) => void
}

export const gameStore = createStore<GameState & GameActions>((set) => ({
  started: false,
  elapsed: 0,
  coins: 0,
  totalCoins: 0,
  start: () => set({ started: true }),
  tick: (dt) => set((s) => ({ elapsed: s.elapsed + dt })),
  collectCoin: () => set((s) => ({ coins: s.coins + 1 })),
  setTotalCoins: (n) => set({ totalCoins: n }),
}))
