import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore } from './store'

describe('GameStore', () => {
  beforeEach(() => {
    useGameStore.setState({ started: false, elapsed: 0 })
  })

  it('starts in not-started state', () => {
    expect(useGameStore.getState().started).toBe(false)
    expect(useGameStore.getState().elapsed).toBe(0)
  })

  it('can start the game', () => {
    useGameStore.getState().start()
    expect(useGameStore.getState().started).toBe(true)
  })

  it('accumulates elapsed time', () => {
    useGameStore.getState().tick(0.016)
    useGameStore.getState().tick(0.016)
    expect(useGameStore.getState().elapsed).toBeCloseTo(0.032)
  })
})
