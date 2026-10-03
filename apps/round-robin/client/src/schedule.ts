/**
 * Doubles round robin scheduler.
 *
 * Goal: every player partners with every other player exactly once.
 * Each round, up to `courts` matches run in parallel and nobody plays twice
 * in the same round. When the partnership count can't be split evenly, the
 * last match(es) use "fill-in" opponents — players who repeat a partnership
 * just to make a game happen. Those are flagged so the UI can show them.
 */

export type Team = [number, number]

export interface Match {
  teams: [Team, Team]
  /** Indices (0/1) of teams whose partnership is a repeat, used only to fill a court. */
  fillIn?: number[]
}

export interface Round {
  matches: Match[]
  sittingOut: number[]
}

export function maxCourts(playerCount: number): number {
  return Math.floor(playerCount / 4)
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const key = (a: number, b: number) => (a < b ? a * 1000 + b : b * 1000 + a)

interface Attempt {
  rounds: Round[]
  fillIns: number
  repeatOpponents: number
  restSpread: number
}

function attempt(n: number, courts: number, rand: () => number): Attempt {
  let remaining: Team[] = []
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) remaining.push([a, b])

  const games = new Array<number>(n).fill(0)
  const sat = new Array<number>(n).fill(0)
  const lastPlayed = new Array<number>(n).fill(-1)
  const opp = new Map<number, number>()
  const rounds: Round[] = []
  let fillIns = 0
  let repeatOpponents = 0

  while (remaining.length > 0) {
    const r = rounds.length
    // Favor players who've played less and rested longer; jitter for variety.
    const score = (t: Team) =>
      (games[t[0]] + games[t[1]]) * 10 +
      (lastPlayed[t[0]] === r - 1 ? 3 : 0) +
      (lastPlayed[t[1]] === r - 1 ? 3 : 0) +
      rand() * 4
    const ordered = remaining
      .map((t) => ({ t, s: score(t) }))
      .sort((x, y) => x.s - y.s)
      .map((x) => x.t)

    const used = new Set<number>()
    const picked: Team[] = []
    for (const t of ordered) {
      if (picked.length >= courts * 2) break
      if (used.has(t[0]) || used.has(t[1])) continue
      picked.push(t)
      used.add(t[0])
      used.add(t[1])
    }
    if (picked.length > 1 && picked.length % 2 === 1) {
      const dropped = picked.pop()!
      used.delete(dropped[0])
      used.delete(dropped[1])
    }

    const matches: Match[] = []
    if (picked.length === 1) {
      // Lone partnership left: give it opponents from the least-played free players.
      const free = [...Array(n).keys()]
        .filter((p) => !used.has(p))
        .sort((a, b) => games[a] - games[b] || rand() - 0.5)
      const filler: Team = [free[0], free[1]]
      matches.push({ teams: [picked[0], filler], fillIn: [1] })
      fillIns++
    } else {
      // Pair up picked teams, avoiding repeat opponents where possible.
      const pool = [...picked]
      while (pool.length) {
        const t = pool.shift()!
        let best = 0
        let bestCost = Infinity
        pool.forEach((u, i) => {
          let c = 0
          for (const a of t) for (const b of u) c += opp.get(key(a, b)) ?? 0
          if (c < bestCost) {
            bestCost = c
            best = i
          }
        })
        const u = pool.splice(best, 1)[0]
        matches.push({ teams: [t, u] })
      }
    }

    const pickedKeys = new Set(picked.map((t) => key(t[0], t[1])))
    remaining = remaining.filter((t) => !pickedKeys.has(key(t[0], t[1])))

    const playing = new Set<number>()
    for (const m of matches) {
      const [t, u] = m.teams
      for (const a of t)
        for (const b of u) {
          const k = key(a, b)
          const prev = opp.get(k) ?? 0
          if (prev > 0) repeatOpponents++
          opp.set(k, prev + 1)
        }
      for (const p of [...t, ...u]) {
        playing.add(p)
        games[p]++
        lastPlayed[p] = r
      }
    }
    const sittingOut = [...Array(n).keys()].filter((p) => !playing.has(p))
    for (const p of sittingOut) sat[p]++
    rounds.push({ matches, sittingOut })
  }

  return {
    rounds,
    fillIns,
    repeatOpponents,
    restSpread: Math.max(...sat) - Math.min(...sat),
  }
}

/** Build a schedule. Tries many randomized greedy passes and keeps the best. */
export function buildSchedule(playerCount: number, courts: number, seed = Date.now()): Round[] {
  if (playerCount < 4) throw new Error('Need at least 4 players')
  const c = Math.max(1, Math.min(courts, maxCourts(playerCount)))
  const rand = mulberry32(seed)
  const tries = playerCount > 24 ? 40 : 200
  let best: Attempt | null = null
  const cost = (a: Attempt) =>
    a.rounds.length * 1e6 + a.fillIns * 1e4 + a.restSpread * 100 + a.repeatOpponents
  for (let i = 0; i < tries; i++) {
    const a = attempt(playerCount, c, rand)
    if (!best || cost(a) < cost(best)) best = a
  }
  return best!.rounds
}
