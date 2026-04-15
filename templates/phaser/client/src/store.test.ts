import { describe, it, expect, beforeEach } from 'vitest'
import { gameStore } from './store'

describe('GameStore', () => {
  beforeEach(() => {
    gameStore.setState({ started: false, elapsed: 0 })
  })

  it('starts in not-started state', () => {
    expect(gameStore.getState().started).toBe(false)
    expect(gameStore.getState().elapsed).toBe(0)
  })

  it('can start the game', () => {
    gameStore.getState().start()
    expect(gameStore.getState().started).toBe(true)
  })

  it('accumulates elapsed time', () => {
    gameStore.getState().tick(0.016)
    gameStore.getState().tick(0.016)
    expect(gameStore.getState().elapsed).toBeCloseTo(0.032)
  })
})
