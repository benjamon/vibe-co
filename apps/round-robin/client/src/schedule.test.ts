import { describe, expect, it } from 'vitest'
import { buildSchedule, maxCourts } from './schedule'

describe('buildSchedule', () => {
  for (let n = 4; n <= 16; n++) {
    for (const courts of [1, 2, 3, 4]) {
      it(`${n} players, ${courts} court(s)`, () => {
        const rounds = buildSchedule(n, courts, 42)
        const partnered = new Map<string, number>()
        const effectiveCourts = Math.min(courts, maxCourts(n))

        for (const r of rounds) {
          expect(r.matches.length).toBeGreaterThan(0)
          expect(r.matches.length).toBeLessThanOrEqual(effectiveCourts)
          const seen = new Set<number>()
          for (const m of r.matches) {
            m.teams.forEach((t, i) => {
              for (const p of t) {
                expect(seen.has(p)).toBe(false)
                seen.add(p)
              }
              if (m.fillIn?.includes(i)) return
              const k = [...t].sort((a, b) => a - b).join('-')
              partnered.set(k, (partnered.get(k) ?? 0) + 1)
            })
          }
          for (const p of r.sittingOut) expect(seen.has(p)).toBe(false)
          expect(seen.size + r.sittingOut.length).toBe(n)
        }

        // Every pair partners exactly once.
        expect(partnered.size).toBe((n * (n - 1)) / 2)
        for (const v of partnered.values()) expect(v).toBe(1)
      })
    }
  }

  it('hits the optimal round count for 8 players on 2 courts', () => {
    expect(buildSchedule(8, 2, 1).length).toBe(7)
  })
})
