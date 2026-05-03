import { create } from 'zustand'

export type UpgradeId =
  | 'fireRate'
  | 'bulletCount'
  | 'damage'
  | 'burst'
  | 'penetration'
  | 'homing'
  | 'maxHp'
  | 'largeBullets'
  | 'chainExplode'

export interface PlayerStats {
  fireInterval: number
  bulletCount: number
  bulletDamage: number
  burstCount: number
  penetration: number
  bulletRadiusMul: number
  homingInterval: number
  maxLives: number
  chainExplodeChance: number
}

const INITIAL_LIVES = 3
const BASE_FIRE_INTERVAL = 0.36

const BASE_STATS: PlayerStats = {
  fireInterval: BASE_FIRE_INTERVAL,
  bulletCount: 1,
  bulletDamage: 1,
  burstCount: 1,
  penetration: 0,
  bulletRadiusMul: 1,
  homingInterval: 0,
  maxLives: INITIAL_LIVES,
  chainExplodeChance: 0,
}

export const playerStats: PlayerStats = { ...BASE_STATS }

export function resetStats() {
  Object.assign(playerStats, BASE_STATS)
}

export interface UpgradeDef {
  id: UpgradeId
  name: string
  describe: (s: PlayerStats) => string
  isAvailable?: (s: PlayerStats) => boolean
  apply: (s: PlayerStats) => void
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'fireRate',
    name: 'Rapid Fire',
    describe: () => '+25% fire rate',
    apply: (s) => {
      s.fireInterval *= 0.8
    },
  },
  {
    id: 'bulletCount',
    name: 'Multi-Shot',
    describe: () => '+1 bullet per shot',
    isAvailable: (s) => s.bulletCount < 5,
    apply: (s) => {
      s.bulletCount += 1
    },
  },
  {
    id: 'damage',
    name: 'Heavy Rounds',
    describe: (s) => `+1 damage (now ${s.bulletDamage + 1})`,
    apply: (s) => {
      s.bulletDamage += 1
    },
  },
  {
    id: 'burst',
    name: 'Burst Fire',
    describe: (s) => `+1 round per burst (now ${s.burstCount + 1})`,
    isAvailable: (s) => s.burstCount < 4,
    apply: (s) => {
      s.burstCount += 1
    },
  },
  {
    id: 'penetration',
    name: 'Piercing Rounds',
    describe: (s) => `+1 enemy penetration (now ${s.penetration + 1})`,
    isAvailable: (s) => s.penetration < 5,
    apply: (s) => {
      s.penetration += 1
    },
  },
  {
    id: 'homing',
    name: 'Homing Missile',
    describe: (s) =>
      s.homingInterval <= 0 ? 'Launch homing missiles every 4s' : 'Faster homing missiles',
    apply: (s) => {
      if (s.homingInterval <= 0) s.homingInterval = 4.0
      else s.homingInterval = Math.max(0.5, s.homingInterval - 0.7)
    },
  },
  {
    id: 'maxHp',
    name: 'Hull Plating',
    describe: () => '+1 max HP & heal',
    apply: (s) => {
      s.maxLives += 1
    },
  },
  {
    id: 'largeBullets',
    name: 'Heavy Caliber',
    describe: () => '+25% bullet size',
    isAvailable: (s) => s.bulletRadiusMul < 3,
    apply: (s) => {
      s.bulletRadiusMul *= 1.25
    },
  },
  {
    id: 'chainExplode',
    name: 'Chain Reaction',
    describe: (s) =>
      `+15% chain explode (now ${Math.round(Math.min(1, s.chainExplodeChance + 0.15) * 100)}%)`,
    isAvailable: (s) => s.chainExplodeChance < 1,
    apply: (s) => {
      s.chainExplodeChance = Math.min(1, s.chainExplodeChance + 0.15)
    },
  },
]

const UPGRADE_BY_ID: Record<UpgradeId, UpgradeDef> = UPGRADES.reduce(
  (acc, u) => {
    acc[u.id] = u
    return acc
  },
  {} as Record<UpgradeId, UpgradeDef>,
)

export function getUpgrade(id: UpgradeId): UpgradeDef {
  return UPGRADE_BY_ID[id]
}

function pickUpgradeChoices(stats: PlayerStats): UpgradeId[] {
  const available = UPGRADES.filter((u) => !u.isAvailable || u.isAvailable(stats))
  if (available.length === 0) return []
  if (available.length === 1) return [available[0].id]
  const a = Math.floor(Math.random() * available.length)
  let b = Math.floor(Math.random() * (available.length - 1))
  if (b >= a) b += 1
  return [available[a].id, available[b].id]
}

function xpThresholdFor(level: number): number {
  return 5 + level * 3
}

interface GameState {
  started: boolean
  gameOver: boolean
  score: number
  lives: number
  highScore: number
  xp: number
  level: number
  xpToNext: number
  pendingLevelUps: number
  upgradeChoices: UpgradeId[]
  start: () => void
  end: () => void
  reset: () => void
  addScore: (n: number) => void
  loseLife: () => void
  addXp: (n: number) => void
  selectUpgrade: (idx: number) => void
}

export const useGameStore = create<GameState>((set, get) => ({
  started: false,
  gameOver: false,
  score: 0,
  lives: INITIAL_LIVES,
  highScore: 0,
  xp: 0,
  level: 1,
  xpToNext: xpThresholdFor(1),
  pendingLevelUps: 0,
  upgradeChoices: [],
  start: () => {
    resetStats()
    set({
      started: true,
      gameOver: false,
      score: 0,
      lives: playerStats.maxLives,
      xp: 0,
      level: 1,
      xpToNext: xpThresholdFor(1),
      pendingLevelUps: 0,
      upgradeChoices: [],
    })
  },
  end: () =>
    set((s) => ({
      started: false,
      gameOver: true,
      pendingLevelUps: 0,
      upgradeChoices: [],
      highScore: Math.max(s.highScore, s.score),
    })),
  reset: () => {
    resetStats()
    set({
      started: false,
      gameOver: false,
      score: 0,
      lives: INITIAL_LIVES,
      xp: 0,
      level: 1,
      xpToNext: xpThresholdFor(1),
      pendingLevelUps: 0,
      upgradeChoices: [],
    })
  },
  addScore: (n) => set((s) => ({ score: s.score + n })),
  loseLife: () => {
    const next = get().lives - 1
    if (next <= 0) {
      set({ lives: 0 })
      get().end()
    } else {
      set({ lives: next })
    }
  },
  addXp: (n) => {
    set((s) => {
      let xp = s.xp + n
      let level = s.level
      let xpToNext = s.xpToNext
      let levelUps = 0
      while (xp >= xpToNext) {
        xp -= xpToNext
        level += 1
        xpToNext = xpThresholdFor(level)
        levelUps += 1
      }
      if (levelUps > 0) {
        const totalPending = s.pendingLevelUps + levelUps
        const choices =
          s.upgradeChoices.length > 0 ? s.upgradeChoices : pickUpgradeChoices(playerStats)
        return {
          xp,
          level,
          xpToNext,
          pendingLevelUps: totalPending,
          upgradeChoices: choices,
        }
      }
      return { xp, level, xpToNext }
    })
  },
  selectUpgrade: (idx) => {
    const id = get().upgradeChoices[idx]
    if (!id) return
    const def = UPGRADE_BY_ID[id]
    def.apply(playerStats)
    const livesDelta = id === 'maxHp' ? 1 : 0
    set((s) => {
      const remaining = s.pendingLevelUps - 1
      if (remaining > 0) {
        return {
          pendingLevelUps: remaining,
          upgradeChoices: pickUpgradeChoices(playerStats),
          lives: s.lives + livesDelta,
        }
      }
      return {
        pendingLevelUps: 0,
        upgradeChoices: [],
        lives: s.lives + livesDelta,
      }
    })
  },
}))
