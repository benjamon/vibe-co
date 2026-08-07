import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  autoFlipIntervalMs,
  autoFlipperCost,
  coinCost,
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
    expect(s.coinCount).toBe(1)
    expect(s.autoFlippers).toBe(0)
    expect(s.coins).toHaveLength(1)
    expect(s.coins[0].flipping).toBe(false)
    expect(s.flips).toBe(0)
  })

  it('starting cost of a 2nd coin is 10g and 1st coins-per-tap upgrade is 100g', () => {
    expect(coinCost(1)).toBe(10)
    expect(coinsPerTapCost(1)).toBe(100)
  })

  it('tap flips up to coinsPerTap idle coins, leaving the rest idle', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    useGameStore.setState({ gold: 10_000 })
    useGameStore.getState().buyCoin()
    useGameStore.getState().buyCoin()
    useGameStore.getState().buyCoinsPerTap()
    useGameStore.getState().tap()
    const s = useGameStore.getState()
    expect(s.coins).toHaveLength(3)
    const flipping = s.coins.filter((c) => c.flipping)
    expect(flipping).toHaveLength(2)
    expect(flipping.every((c) => c.pendingResult === 'heads')).toBe(true)
  })

  it('finishFlip awards gold equal to coinValue and updates stats', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
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
    useGameStore.setState({ gold: 10_000 })
    useGameStore.getState().buyCoin()
    useGameStore.getState().buyCoin()
    useGameStore.getState().autoFlipOne()
    const flipping = useGameStore.getState().coins.filter((c) => c.flipping)
    expect(flipping).toHaveLength(1)
  })

  it('tap is a no-op when every reachable coin is already flipping', () => {
    useGameStore.getState().tap()
    const before = useGameStore.getState().coins.map((c) => c.pendingResult)
    useGameStore.getState().tap()
    const after = useGameStore.getState().coins.map((c) => c.pendingResult)
    expect(after).toEqual(before)
  })

  it('buyCoin adds a coin and deducts gold', () => {
    useGameStore.setState({ gold: 1000 })
    const cost = coinCost(1)
    useGameStore.getState().buyCoin()
    const s = useGameStore.getState()
    expect(s.gold).toBe(1000 - cost)
    expect(s.coinCount).toBe(2)
    expect(s.coins).toHaveLength(2)
  })

  it('buyCoinsPerTap is blocked when coinsPerTap >= coinCount', () => {
    useGameStore.setState({ gold: 10_000 })
    useGameStore.getState().buyCoinsPerTap()
    const s = useGameStore.getState()
    expect(s.coinsPerTap).toBe(1)
    expect(s.gold).toBe(10_000)
  })

  it('buyCoinsPerTap deducts gold and raises the per-tap cap up to coinCount', () => {
    useGameStore.setState({ gold: 10_000 })
    useGameStore.getState().buyCoin()
    const tapCost = coinsPerTapCost(1)
    useGameStore.getState().buyCoinsPerTap()
    const s = useGameStore.getState()
    expect(s.coinsPerTap).toBe(2)
    expect(s.gold).toBe(10_000 - coinCost(1) - tapCost)
  })

  it('buyCoinValue and buyAutoFlipper deduct their respective costs', () => {
    useGameStore.setState({ gold: 1000 })
    const valCost = coinValueCost(1)
    const autoCostBefore = autoFlipperCost(0)
    useGameStore.getState().buyCoinValue()
    useGameStore.getState().buyAutoFlipper()
    const s = useGameStore.getState()
    expect(s.coinValue).toBe(2)
    expect(s.autoFlippers).toBe(1)
    expect(s.gold).toBe(1000 - valCost - autoCostBefore)
  })

  it('upgrades are blocked when broke', () => {
    useGameStore.getState().buyCoin()
    useGameStore.getState().buyCoinValue()
    useGameStore.getState().buyAutoFlipper()
    const s = useGameStore.getState()
    expect(s.coinCount).toBe(1)
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
