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

import {
  useGameStore,
  ROUNDS,
  itemWeightKey,
  DEFAULT_ITEM_WEIGHT,
  MIN_ITEM_WEIGHT,
  type AttemptResult,
  type ItemWeights,
} from './store'

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

  it('draws only from a named region pool (e.g. Europe)', () => {
    const EUROPE_SAMPLE = ['France', 'Germany', 'Italy', 'Spain', 'Portugal']
    useGameStore.setState({ countries: [...POOL, ...EUROPE_SAMPLE] })
    useGameStore.getState().startGame('eu-seed', 'europe')
    const targets = useGameStore.getState().targets
    expect(useGameStore.getState().mode).toBe('classic')
    // Europe's fixed pool intersected with the loaded countries leaves only
    // the sample above, so the draw is capped there — never a POOL entry.
    expect(targets.length).toBe(EUROPE_SAMPLE.length)
    for (const t of targets) expect(EUROPE_SAMPLE).toContain(t)
  })

  it('keeps classic-all and a named region draw independent for the same seed', () => {
    const AMERICAS_SAMPLE = ['Brazil', 'Mexico']
    useGameStore.setState({ countries: [...POOL, ...AMERICAS_SAMPLE] })
    useGameStore.getState().startGame('shared', 'classic')
    const classic = useGameStore.getState().targets
    useGameStore.getState().startGame('shared', 'americas')
    const americas = useGameStore.getState().targets
    // Same seed, but a different sub-mode must not resume the classic save.
    expect(useGameStore.getState().subMode).toBe('americas')
    expect(classic).toHaveLength(ROUNDS)
    // Americas' fixed pool intersected with the loaded countries leaves only
    // the sample above — proving this draw didn't fall back to classic-all.
    expect(americas.length).toBe(AMERICAS_SAMPLE.length)
    for (const t of americas) expect(AMERICAS_SAMPLE).toContain(t)
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

  it('flags the exact guess that pushes an item into mastery, and no others', () => {
    // Every other pool item already mastered; POOL[0] one correct guess away
    // (streak 2) — guessing it correctly should floor its weight and mark
    // that guess's index in masteredOnAttempt, with every other index false.
    const itemWeights: ItemWeights = {}
    for (const c of POOL.slice(1)) {
      itemWeights[itemWeightKey('countries', c)] = {
        weight: MIN_ITEM_WEIGHT,
        streak: 3,
      }
    }
    itemWeights[itemWeightKey('countries', POOL[0])] = { weight: 0.25, streak: 2 }
    useGameStore.setState({ itemWeights })
    useGameStore.getState().startGame('mastery-seed')

    let masteredIndex = -1
    for (let i = 0; i < ROUNDS; i++) {
      const target = useGameStore.getState().target!
      if (target === POOL[0]) masteredIndex = i
      useGameStore.getState().handleGlobeClick(target)
    }

    expect(masteredIndex).toBeGreaterThanOrEqual(0)
    const flags = useGameStore.getState().masteredOnAttempt
    expect(flags[masteredIndex]).toBe(true)
    expect(flags.filter((f) => f).length).toBe(1)
    expect(
      useGameStore.getState().itemWeights[itemWeightKey('countries', POOL[0])]
        .weight,
    ).toBe(MIN_ITEM_WEIGHT)
  })

  it('always includes an unmastered item, even when the rest of the pool is mastered', () => {
    // Master every country except one; the weighted draw would otherwise
    // almost never surface the mastered ones, but the guarantee should still
    // pull in the one remaining unmastered item.
    const itemWeights: ItemWeights = {}
    for (const c of POOL.slice(1)) {
      itemWeights[itemWeightKey('countries', c)] = {
        weight: MIN_ITEM_WEIGHT,
        streak: 3,
      }
    }
    useGameStore.setState({ itemWeights })
    useGameStore.getState().startGame('unmastered-seed')
    expect(useGameStore.getState().targets).toContain(POOL[0])
  })

  it('always includes the least-recently-guessed item once the whole pool has been guessed', () => {
    // Every item guessed and mastered, but one item is far staler than the
    // rest — it should be forced back into the round despite its low weight.
    const itemWeights: ItemWeights = {}
    POOL.forEach((c, i) => {
      itemWeights[itemWeightKey('countries', c)] = {
        weight: MIN_ITEM_WEIGHT,
        streak: 3,
        lastGuessed: i === 0 ? 1000 : 2_000_000 + i,
      }
    })
    useGameStore.setState({ itemWeights })
    useGameStore.getState().startGame('stale-seed')
    expect(useGameStore.getState().targets).toContain(POOL[0])
  })

  it('does not always pin guaranteed items to the start or end of the round', () => {
    const itemWeights: ItemWeights = {}
    for (const c of POOL.slice(1)) {
      itemWeights[itemWeightKey('countries', c)] = {
        weight: MIN_ITEM_WEIGHT,
        streak: 3,
      }
    }
    useGameStore.setState({ itemWeights })

    const positions = new Set<number>()
    for (let i = 0; i < 20; i++) {
      useGameStore.getState().startGame(`shuffle-seed-${i}`)
      positions.add(useGameStore.getState().targets.indexOf(POOL[0]))
    }
    // Across enough seeds, the guaranteed item should land somewhere other
    // than always position 0 or always the last slot.
    expect(positions.size).toBeGreaterThan(1)
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
