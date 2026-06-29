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

import { useGameStore, ROUNDS, type AttemptResult } from './store'

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

  it('draws only from the World Cup pool in worldcup mode', () => {
    const WC = ['Brazil', 'France', 'Japan', 'Ghana', 'Mexico']
    useGameStore.setState({ worldCupCountries: WC })
    useGameStore.getState().startGame('wc-seed', 'worldcup')
    const targets = useGameStore.getState().targets
    expect(useGameStore.getState().mode).toBe('worldcup')
    // Pool is smaller than ROUNDS, so the draw is capped at the pool size and
    // every target is a qualifier — never a classic-pool country.
    expect(targets.length).toBe(WC.length)
    for (const t of targets) expect(WC).toContain(t)
  })

  it('keeps classic and worldcup draws independent for the same seed', () => {
    useGameStore.setState({ worldCupCountries: POOL })
    useGameStore.getState().startGame('shared', 'classic')
    const classic = useGameStore.getState().targets
    useGameStore.getState().startGame('shared', 'worldcup')
    const worldcup = useGameStore.getState().targets
    // Same seed, but a worldcup match must not resume the classic save.
    expect(useGameStore.getState().mode).toBe('worldcup')
    expect(classic).toHaveLength(ROUNDS)
    expect(worldcup).toHaveLength(ROUNDS)
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

  it('serves all 9 countries in order on a flawless run', () => {
    useGameStore.getState().startGame('perfect-seed')
    const targets = useGameStore.getState().targets
    expect(targets).toHaveLength(ROUNDS)

    const served: string[] = []
    for (let i = 0; i < ROUNDS; i++) {
      const target = useGameStore.getState().target!
      served.push(target)
      useGameStore.getState().handleGlobeClick(target)
    }
    expect(served).toEqual(targets)
    expect(useGameStore.getState().attempts).toHaveLength(ROUNDS)
    expect(
      useGameStore.getState().attempts.filter((a) => a === 'correct'),
    ).toHaveLength(ROUNDS)
  })

  it('caps the match at 9 guesses — a miss costs a later country', () => {
    useGameStore.getState().startGame('cap-seed')
    const targets = useGameStore.getState().targets
    const served: string[] = []

    // Burn one extra guess by missing the first country once, then correct it.
    served.push(useGameStore.getState().target!) // targets[0]
    const wrong = targets.find((t) => t !== targets[0])!
    useGameStore.getState().handleGlobeClick(wrong) // guess 1: miss, same target
    expect(useGameStore.getState().target).toBe(targets[0])
    useGameStore.getState().handleGlobeClick(targets[0]) // guess 2: correct

    // Spend the rest of the 9-guess budget guessing correctly.
    while (useGameStore.getState().attempts.length < ROUNDS) {
      const target = useGameStore.getState().target!
      served.push(target)
      useGameStore.getState().handleGlobeClick(target)
    }

    // Exactly ROUNDS guesses were used, and the single miss means the last
    // country in the seed was never reached.
    expect(useGameStore.getState().attempts).toHaveLength(ROUNDS)
    expect(served).not.toContain(targets[ROUNDS - 1])
    expect(useGameStore.getState().targetIndex).toBe(ROUNDS - 1)
  })

  it('advances one target after two misses and logs both guesses', () => {
    useGameStore.getState().startGame('reveal-seed')
    const targets = useGameStore.getState().targets
    const first = useGameStore.getState().target
    expect(first).toBe(targets[0])
    const wrong = targets.find((t) => t !== first)!

    useGameStore.getState().handleGlobeClick(wrong) // miss 1 → same target
    expect(useGameStore.getState().target).toBe(first)
    expect(useGameStore.getState().attempts).toEqual(['wrong'])
    expect(useGameStore.getState().targetIndex).toBe(0)

    useGameStore.getState().handleGlobeClick(wrong) // miss 2 → reveal + advance
    expect(useGameStore.getState().revealTarget).toBe(first)
    expect(useGameStore.getState().target).toBe(targets[1])
    // Both misses occupy a slot; the sequence advanced by exactly one.
    expect(useGameStore.getState().attempts).toEqual(['wrong', 'wrong'])
    expect(useGameStore.getState().targetIndex).toBe(1)

    useGameStore.getState().clearReveal()
    expect(useGameStore.getState().target).toBe(targets[1])
  })

  it('increments the perfect-game streak on a flawless 9/9 finish', () => {
    useGameStore.setState({
      perfectStreak: 2,
      attempts: Array.from({ length: ROUNDS }, () => 'correct' as AttemptResult),
    })
    useGameStore.getState().finishGame()
    expect(useGameStore.getState().perfectStreak).toBe(3)
    expect(useGameStore.getState().phase).toBe('finished')
  })

  it('resets the perfect-game streak when a match ends with a miss', () => {
    useGameStore.setState({
      perfectStreak: 4,
      // A full 9-guess budget spent, with a miss in it → not perfect.
      attempts: Array.from(
        { length: ROUNDS },
        (_, i) => (i === 0 ? 'wrong' : 'correct') as AttemptResult,
      ),
    })
    // The last guess is spent, so the reveal ends the match.
    useGameStore.getState().clearReveal()
    expect(useGameStore.getState().phase).toBe('finished')
    expect(useGameStore.getState().perfectStreak).toBe(0)
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
    expect(useGameStore.getState().attempts).toEqual([])
    expect(useGameStore.getState().targetIndex).toBe(0)
  })
})
