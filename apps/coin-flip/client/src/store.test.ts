import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  autoFlipIntervalMs,
  autoFlipperCost,
  coinValueCost,
  coinsPerTapCost,
  useGameStore,
} from './store'

describe('CoinFlipStore', () => {
  beforeEach(() => {
    useGameStore.getState().reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts with one idle coin and zero gold', () => {
    const s = useGameStore.getState()
    expect(s.gold).toBe(0)
    expect(s.coinValue).toBe(1)
    expect(s.coinsPerTap).toBe(1)
    expect(s.autoFlippers).toBe(0)
    expect(s.coins).toHaveLength(1)
    expect(s.coins[0].flipping).toBe(false)
    expect(s.flips).toBe(0)
  })

  it('tap flips all idle coins simultaneously', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    useGameStore.setState({ gold: 1000 })
    useGameStore.getState().buyCoinsPerTap()
    useGameStore.getState().tap()
    const after = useGameStore.getState()
    expect(after.coins).toHaveLength(2)
    expect(after.coins.every((c) => c.flipping)).toBe(true)
    expect(after.coins.every((c) => c.pendingResult === 'heads')).toBe(true)
  })

  it('finishFlip awards gold equal to coinValue and updates stats', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9) // tails
    useGameStore.getState().tap()
    const id = useGameStore.getState().coins[0].id
    useGameStore.getState().finishFlip(id)
    const s = useGameStore.getState()
    expect(s.gold).toBe(1)
    expect(s.flips).toBe(1)
    expect(s.tailsCount).toBe(1)
    expect(s.headsCount).toBe(0)
    expect(s.coins[0].flipping).toBe(false)
    expect(s.coins[0].result).toBe('tails')
  })

  it('autoFlipOne flips exactly one idle coin', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    useGameStore.setState({ gold: 1000 })
    useGameStore.getState().buyCoinsPerTap()
    useGameStore.getState().buyCoinsPerTap()
    useGameStore.getState().autoFlipOne()
    const flipping = useGameStore.getState().coins.filter((c) => c.flipping)
    expect(flipping).toHaveLength(1)
  })

  it('tap is a no-op when every coin is already flipping', () => {
    useGameStore.getState().tap()
    const before = useGameStore.getState().coins.map((c) => c.pendingResult)
    useGameStore.getState().tap()
    const after = useGameStore.getState().coins.map((c) => c.pendingResult)
    expect(after).toEqual(before)
  })

  it('upgrades deduct gold and apply effects', () => {
    useGameStore.setState({ gold: 1000 })
    const tapCost = coinsPerTapCost(1)
    useGameStore.getState().buyCoinsPerTap()
    let s = useGameStore.getState()
    expect(s.gold).toBe(1000 - tapCost)
    expect(s.coinsPerTap).toBe(2)
    expect(s.coins).toHaveLength(2)

    const valCost = coinValueCost(1)
    useGameStore.getState().buyCoinValue()
    s = useGameStore.getState()
    expect(s.gold).toBe(1000 - tapCost - valCost)
    expect(s.coinValue).toBe(2)

    const autoCost = autoFlipperCost(0)
    useGameStore.getState().buyAutoFlipper()
    s = useGameStore.getState()
    expect(s.gold).toBe(1000 - tapCost - valCost - autoCost)
    expect(s.autoFlippers).toBe(1)
  })

  it('upgrades are blocked when broke', () => {
    useGameStore.getState().buyCoinsPerTap()
    useGameStore.getState().buyCoinValue()
    useGameStore.getState().buyAutoFlipper()
    const s = useGameStore.getState()
    expect(s.coinsPerTap).toBe(1)
    expect(s.coinValue).toBe(1)
    expect(s.autoFlippers).toBe(0)
  })

  it('autoFlipIntervalMs scales as 5000/N', () => {
    expect(autoFlipIntervalMs(0)).toBe(0)
    expect(autoFlipIntervalMs(1)).toBe(5000)
    expect(autoFlipIntervalMs(5)).toBe(1000)
    expect(autoFlipIntervalMs(10)).toBe(500)
  })
})
