import { describe, it, expect, beforeEach } from 'vitest'

// Minimal localStorage shim — vitest runs under 'node' here so the global is
// missing. The store gates its access behind `typeof localStorage`, so this
// just enables the resume tests below.
const memoryStore = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k) => memoryStore.get(k) ?? null,
  setItem: (k, v) => {
    memoryStore.set(k, v)
  },
  removeItem: (k) => {
    memoryStore.delete(k)
  },
  clear: () => {
    memoryStore.clear()
  },
  key: (i) => Array.from(memoryStore.keys())[i] ?? null,
  get length() {
    return memoryStore.size
  },
} as Storage

import { useGameStore, ROUNDS } from './store'

const POOL = Array.from({ length: 30 }, (_, i) => `Country${i}`)

describe('GameStore', () => {
  beforeEach(() => {
    memoryStore.clear()
    useGameStore.getState().resetGame()
    useGameStore.setState({ heading: 0, countries: POOL })
  })

  it('starts with zero heading', () => {
    expect(useGameStore.getState().heading).toBe(0)
  })

  it('updates the heading', () => {
    useGameStore.getState().setHeading(1.5)
    expect(useGameStore.getState().heading).toBeCloseTo(1.5)
  })

  it('draws the same targets for the same seed', () => {
    useGameStore.getState().startGame('repeat-me')
    const a = useGameStore.getState().targets
    useGameStore.getState().startGame('repeat-me')
    const b = useGameStore.getState().targets
    expect(a).toEqual(b)
    expect(a).toHaveLength(ROUNDS)
    expect(new Set(a).size).toBe(ROUNDS)
  })

  it('draws different targets for different seeds', () => {
    useGameStore.getState().startGame('seed-a')
    const a = useGameStore.getState().targets
    useGameStore.getState().startGame('seed-b')
    const b = useGameStore.getState().targets
    expect(a).not.toEqual(b)
  })

  it('records the seed on the store when starting a match', () => {
    useGameStore.getState().startGame('hello')
    expect(useGameStore.getState().seed).toBe('hello')
  })

  it('resumes the same seed with prior attempts and markers', () => {
    useGameStore.getState().startGame('keep-me')
    const first = useGameStore.getState().target!
    useGameStore.getState().handleGlobeClick(first) // correct
    useGameStore.getState().addMarker({
      lat: 1,
      lon: 2,
      kind: 'correct',
      label: first,
    })

    const beforeReload = {
      attempts: useGameStore.getState().attempts,
      markers: useGameStore.getState().markers,
    }

    // Simulate a fresh app load: blow away in-memory state, keep localStorage,
    // then start the same seed.
    useGameStore.getState().resetGame()
    useGameStore.setState({ countries: POOL })
    useGameStore.getState().startGame('keep-me')

    expect(useGameStore.getState().attempts).toEqual(beforeReload.attempts)
    expect(useGameStore.getState().markers).toEqual(beforeReload.markers)
  })

  it('clears saved progress when a different seed starts', () => {
    useGameStore.getState().startGame('first-seed')
    useGameStore.getState().addMarker({
      lat: 0,
      lon: 0,
      kind: 'wrong',
      label: 'somewhere',
    })
    expect(useGameStore.getState().markers).toHaveLength(1)

    useGameStore.getState().startGame('second-seed')
    expect(useGameStore.getState().seed).toBe('second-seed')
    expect(useGameStore.getState().markers).toEqual([])
    expect(
      useGameStore.getState().attempts.every((a) => a === 'pending'),
    ).toBe(true)
  })
})
