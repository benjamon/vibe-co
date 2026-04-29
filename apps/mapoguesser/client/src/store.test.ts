import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore } from './store'

describe('GameStore', () => {
  beforeEach(() => {
    useGameStore.setState({ heading: 0 })
  })

  it('starts with zero heading', () => {
    expect(useGameStore.getState().heading).toBe(0)
  })

  it('updates the heading', () => {
    useGameStore.getState().setHeading(1.5)
    expect(useGameStore.getState().heading).toBeCloseTo(1.5)
  })
})
