import { create } from 'zustand'

export type CoinFace = 'heads' | 'tails'

export interface CoinState {
  id: number
  flipping: boolean
  pendingResult: CoinFace | null
  result: CoinFace | null
}

interface GameState {
  gold: number
  coinValue: number
  coinsPerTap: number
  autoFlippers: number
  flips: number
  headsCount: number
  tailsCount: number
  coins: CoinState[]
  tap: () => void
  autoFlipOne: () => void
  finishFlip: (id: number) => void
  buyCoinsPerTap: () => void
  buyCoinValue: () => void
  buyAutoFlipper: () => void
  reset: () => void
}

export const AUTO_FLIPPER_BASE_INTERVAL_MS = 5000

export function coinsPerTapCost(currentLevel: number) {
  return Math.floor(5 * Math.pow(3, currentLevel - 1))
}

export function coinValueCost(currentLevel: number) {
  return Math.floor(10 * Math.pow(4, currentLevel - 1))
}

export function autoFlipperCost(currentCount: number) {
  return Math.floor(25 * Math.pow(2, currentCount))
}

export function autoFlipIntervalMs(autoFlippers: number) {
  return autoFlippers > 0 ? AUTO_FLIPPER_BASE_INTERVAL_MS / autoFlippers : 0
}

function makeCoin(id: number): CoinState {
  return { id, flipping: false, pendingResult: null, result: null }
}

const INITIAL_STATE = {
  gold: 0,
  coinValue: 1,
  coinsPerTap: 1,
  autoFlippers: 0,
  flips: 0,
  headsCount: 0,
  tailsCount: 0,
}

function rollFace(): CoinFace {
  return Math.random() < 0.5 ? 'heads' : 'tails'
}

export const useGameStore = create<GameState>((set, get) => ({
  ...INITIAL_STATE,
  coins: [makeCoin(0)],

  tap: () => {
    const { coins } = get()
    if (coins.every((c) => c.flipping)) return
    set({
      coins: coins.map((c) =>
        c.flipping
          ? c
          : { ...c, flipping: true, result: null, pendingResult: rollFace() },
      ),
    })
  },

  autoFlipOne: () => {
    const { coins } = get()
    const idx = coins.findIndex((c) => !c.flipping)
    if (idx === -1) return
    set({
      coins: coins.map((c, i) =>
        i === idx
          ? { ...c, flipping: true, result: null, pendingResult: rollFace() }
          : c,
      ),
    })
  },

  finishFlip: (id) => {
    const { coins, coinValue, gold, flips, headsCount, tailsCount } = get()
    const coin = coins.find((c) => c.id === id)
    if (!coin || !coin.pendingResult) return
    const pending = coin.pendingResult
    set({
      gold: gold + coinValue,
      flips: flips + 1,
      headsCount: headsCount + (pending === 'heads' ? 1 : 0),
      tailsCount: tailsCount + (pending === 'tails' ? 1 : 0),
      coins: coins.map((c) =>
        c.id === id
          ? { ...c, flipping: false, result: pending, pendingResult: null }
          : c,
      ),
    })
  },

  buyCoinsPerTap: () => {
    const { gold, coinsPerTap, coins } = get()
    const cost = coinsPerTapCost(coinsPerTap)
    if (gold < cost) return
    const nextId = (coins[coins.length - 1]?.id ?? -1) + 1
    set({
      gold: gold - cost,
      coinsPerTap: coinsPerTap + 1,
      coins: [...coins, makeCoin(nextId)],
    })
  },

  buyCoinValue: () => {
    const { gold, coinValue } = get()
    const cost = coinValueCost(coinValue)
    if (gold < cost) return
    set({ gold: gold - cost, coinValue: coinValue + 1 })
  },

  buyAutoFlipper: () => {
    const { gold, autoFlippers } = get()
    const cost = autoFlipperCost(autoFlippers)
    if (gold < cost) return
    set({ gold: gold - cost, autoFlippers: autoFlippers + 1 })
  },

  reset: () =>
    set({
      ...INITIAL_STATE,
      coins: [makeCoin(0)],
    }),
}))
