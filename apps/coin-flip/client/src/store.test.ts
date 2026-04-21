import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useGameStore } from './store'

describe('CoinFlipStore', () => {
  beforeEach(() => {
    useGameStore.getState().reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts in idle state', () => {
    const s = useGameStore.getState()
    expect(s.flipping).toBe(false)
    expect(s.result).toBeNull()
    expect(s.flips).toBe(0)
    expect(s.headsCount).toBe(0)
    expect(s.tailsCount).toBe(0)
  })

  it('startFlip marks flipping and picks a pending result', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1) // < 0.5 → heads
    useGameStore.getState().startFlip()
    const s = useGameStore.getState()
    expect(s.flipping).toBe(true)
    expect(s.pendingResult).toBe('heads')
    expect(s.result).toBeNull()
  })

  it('finishFlip commits pending result and increments counts', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9) // >= 0.5 → tails
    useGameStore.getState().startFlip()
    useGameStore.getState().finishFlip()
    const s = useGameStore.getState()
    expect(s.flipping).toBe(false)
    expect(s.result).toBe('tails')
    expect(s.tailsCount).toBe(1)
    expect(s.headsCount).toBe(0)
    expect(s.flips).toBe(1)
  })

  it('ignores startFlip while already flipping', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    useGameStore.getState().startFlip()
    const first = useGameStore.getState().pendingResult
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    useGameStore.getState().startFlip()
    expect(useGameStore.getState().pendingResult).toBe(first)
  })
})
