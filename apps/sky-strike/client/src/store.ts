import { create } from 'zustand'

export type UpgradeId =
  | 'fireRate'
  | 'bulletCount'
  | 'damage'
  | 'burst'
  | 'penetration'
  | 'homing'
  | 'homingSalvo'
  | 'maxHp'
  | 'largeBullets'
  | 'chainExplode'
  | 'shield'
  | 'multiProjectile'
  | 'empower'
  | 'fullHeal'
  | 'instaKill'
  | 'lifeOnKill'
  | 'biggerBullets'

export interface PlayerStats {
  fireInterval: number
  bulletCount: number
  bulletDamage: number
  burstCount: number
  penetration: number
  bulletRadiusMul: number
  homingInterval: number
  homingSalvoCount: number
  maxLives: number
  chainExplodeChance: number
  chainExplodeRadius: number
  shieldEnabled: boolean
  shieldMaxCooldown: number
  empoweredEvery: number
  instaKillChance: number
  healOnKillChance: number
}

const INITIAL_LIVES = 3
const BASE_FIRE_INTERVAL = 0.36
export const CHAIN_RADIUS_BASE = 2.5 * 1.5

const BASE_STATS: PlayerStats = {
  fireInterval: BASE_FIRE_INTERVAL,
  bulletCount: 1,
  bulletDamage: 1,
  burstCount: 1,
  penetration: 0,
  bulletRadiusMul: 1,
  homingInterval: 0,
  homingSalvoCount: 1,
  maxLives: INITIAL_LIVES,
  chainExplodeChance: 0,
  chainExplodeRadius: 0,
  shieldEnabled: false,
  shieldMaxCooldown: 10,
  empoweredEvery: 0,
  instaKillChance: 0,
  healOnKillChance: 0,
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
  bossOnly?: boolean
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'fireRate',
    name: 'Rapid Fire',
    describe: () => '+15% fire rate',
    apply: (s) => {
      s.fireInterval *= 0.85
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
      s.homingInterval <= 0 ? 'Launch homing missiles every 4s' : 'Fire missiles more often',
    apply: (s) => {
      if (s.homingInterval <= 0) s.homingInterval = 4.0
      else s.homingInterval = Math.max(0.5, s.homingInterval - 0.7)
    },
  },
  {
    id: 'homingSalvo',
    name: 'Missile Salvo',
    describe: (s) => `+1 missile per salvo (now ${s.homingSalvoCount + 1})`,
    isAvailable: (s) => s.homingInterval > 0 && s.homingSalvoCount < 4,
    apply: (s) => {
      s.homingSalvoCount += 1
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
    describe: (s) => {
      const newChance = Math.min(1, s.chainExplodeChance + 0.15)
      const newRadius = s.chainExplodeRadius <= 0 ? CHAIN_RADIUS_BASE : s.chainExplodeRadius * 1.15
      return `+15% chance, +15% radius (${Math.round(newChance * 100)}%, r${newRadius.toFixed(1)})`
    },
    isAvailable: (s) => s.chainExplodeChance < 1,
    apply: (s) => {
      s.chainExplodeChance = Math.min(1, s.chainExplodeChance + 0.15)
      if (s.chainExplodeRadius <= 0) s.chainExplodeRadius = CHAIN_RADIUS_BASE
      else s.chainExplodeRadius *= 1.15
    },
  },
  {
    id: 'shield',
    name: 'Projectile Shield',
    describe: () => 'Nullify one hit every 10 seconds',
    bossOnly: true,
    isAvailable: (s) => !s.shieldEnabled,
    apply: (s) => {
      s.shieldEnabled = true
      s.shieldMaxCooldown = 10
    },
  },
  {
    id: 'multiProjectile',
    name: '+1 Projectile',
    describe: (s) =>
      s.homingInterval > 0 ? '+1 main bullet, +1 missile per salvo' : '+1 main bullet',
    bossOnly: true,
    apply: (s) => {
      s.bulletCount += 1
      if (s.homingInterval > 0) s.homingSalvoCount += 1
    },
  },
  {
    id: 'empower',
    name: 'Empowered Rounds',
    describe: (s) => {
      const next =
        s.empoweredEvery <= 0
          ? 10
          : Math.max(1, Math.floor(s.empoweredEvery * 0.6))
      return next === 1
        ? 'Every shot 2× size & damage'
        : `Every ${next}th shot 2× size & damage`
    },
    bossOnly: true,
    isAvailable: (s) => s.empoweredEvery !== 1,
    apply: (s) => {
      s.empoweredEvery =
        s.empoweredEvery <= 0
          ? 10
          : Math.max(1, Math.floor(s.empoweredEvery * 0.6))
    },
  },
  {
    id: 'fullHeal',
    name: 'Full Repair',
    describe: () => 'Heal to max HP',
    bossOnly: true,
    apply: () => {
      // lives applied in selectUpgrade
    },
  },
  {
    id: 'instaKill',
    name: 'Critical Strike',
    describe: (s) => {
      const newChance = Math.min(1, s.instaKillChance + 0.05)
      return `+5% insta-kill on enemies (now ${Math.round(newChance * 100)}%, bosses 0.01%)`
    },
    bossOnly: true,
    isAvailable: (s) => s.instaKillChance < 1,
    apply: (s) => {
      s.instaKillChance = Math.min(1, s.instaKillChance + 0.05)
    },
  },
  {
    id: 'lifeOnKill',
    name: 'Vampiric Strike',
    describe: (s) => {
      const newChance = Math.min(1, s.healOnKillChance + 0.04)
      return `+4% heal on kill (now ${Math.round(newChance * 100)}%)`
    },
    bossOnly: true,
    isAvailable: (s) => s.healOnKillChance < 1,
    apply: (s) => {
      s.healOnKillChance = Math.min(1, s.healOnKillChance + 0.04)
    },
  },
  {
    id: 'biggerBullets',
    name: 'Massive Rounds',
    describe: () => '+50% bullet size',
    bossOnly: true,
    apply: (s) => {
      s.bulletRadiusMul *= 1.5
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

function pickFromList(list: UpgradeDef[]): UpgradeId[] {
  if (list.length === 0) return []
  if (list.length === 1) return [list[0].id]
  const a = Math.floor(Math.random() * list.length)
  let b = Math.floor(Math.random() * (list.length - 1))
  if (b >= a) b += 1
  return [list[a].id, list[b].id]
}

function pickUpgradeChoices(stats: PlayerStats): UpgradeId[] {
  const available = UPGRADES.filter(
    (u) => !u.bossOnly && (!u.isAvailable || u.isAvailable(stats)),
  )
  return pickFromList(available)
}

function pickBossUpgradeChoices(stats: PlayerStats): UpgradeId[] {
  const available = UPGRADES.filter(
    (u) => u.bossOnly === true && (!u.isAvailable || u.isAvailable(stats)),
  )
  return pickFromList(available)
}

function xpThresholdFor(level: number): number {
  return 5 + level * 3
}

interface LevelUpVisuals {
  holdLeftProgress: number
  holdRightProgress: number
  flashingIdx: -1 | 0 | 1
  slidingOut: boolean
}

interface BossUiState {
  bossWarning: boolean
  bossHp: number
  bossMaxHp: number
  bossProgress: number
}

interface GameState extends LevelUpVisuals, BossUiState {
  started: boolean
  gameOver: boolean
  score: number
  lives: number
  highScore: number
  xp: number
  level: number
  xpToNext: number
  pendingLevelUps: number
  pendingBossUpgrades: number
  upgradeChoices: UpgradeId[]
  start: () => void
  end: () => void
  reset: () => void
  addScore: (n: number) => void
  loseLife: () => void
  heal: (n: number) => void
  addXp: (n: number) => void
  selectUpgrade: (idx: number) => void
  grantUpgrade: () => void
  setLevelUpVisuals: (v: LevelUpVisuals) => void
  setBossWarning: (v: boolean) => void
  setBossHp: (hp: number, maxHp: number) => void
  setBossProgress: (p: number) => void
}

const RESET_VISUALS: LevelUpVisuals = {
  holdLeftProgress: 0,
  holdRightProgress: 0,
  flashingIdx: -1,
  slidingOut: false,
}

const RESET_BOSS_UI: BossUiState = {
  bossWarning: false,
  bossHp: 0,
  bossMaxHp: 0,
  bossProgress: 0,
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
  pendingBossUpgrades: 0,
  upgradeChoices: [],
  ...RESET_VISUALS,
  ...RESET_BOSS_UI,
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
      pendingBossUpgrades: 0,
      upgradeChoices: [],
      ...RESET_VISUALS,
  ...RESET_BOSS_UI,
    })
  },
  end: () =>
    set((s) => ({
      started: false,
      gameOver: true,
      pendingLevelUps: 0,
      pendingBossUpgrades: 0,
      upgradeChoices: [],
      ...RESET_VISUALS,
  ...RESET_BOSS_UI,
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
      pendingBossUpgrades: 0,
      upgradeChoices: [],
      ...RESET_VISUALS,
  ...RESET_BOSS_UI,
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
  heal: (n) => {
    set((s) => {
      const max = playerStats.maxLives
      const newLives = Math.min(max, s.lives + n)
      if (newLives === s.lives) return s
      return { lives: newLives }
    })
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
        // Don't replace boss-pool choices with regular ones if a boss reward is currently shown.
        const choices =
          s.upgradeChoices.length > 0
            ? s.upgradeChoices
            : s.pendingBossUpgrades > 0
              ? pickBossUpgradeChoices(playerStats)
              : pickUpgradeChoices(playerStats)
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
    const wasBoss = def.bossOnly === true
    set((s) => {
      let livesNext = s.lives
      if (id === 'maxHp') livesNext = s.lives + 1
      else if (id === 'fullHeal') livesNext = playerStats.maxLives
      const remainingBoss = wasBoss ? s.pendingBossUpgrades - 1 : s.pendingBossUpgrades
      const remainingRegular = wasBoss ? s.pendingLevelUps : s.pendingLevelUps - 1
      let nextChoices: UpgradeId[] = []
      if (remainingBoss > 0) {
        nextChoices = pickBossUpgradeChoices(playerStats)
      } else if (remainingRegular > 0) {
        nextChoices = pickUpgradeChoices(playerStats)
      }
      return {
        pendingBossUpgrades: Math.max(0, remainingBoss),
        pendingLevelUps: Math.max(0, remainingRegular),
        upgradeChoices: nextChoices,
        lives: livesNext,
      }
    })
  },
  grantUpgrade: () =>
    set((s) => {
      // Boss reward — picks from boss pool, takes priority over any pending regular choices.
      const showBossNow = s.upgradeChoices.length === 0 || s.pendingBossUpgrades === 0
      const choices = showBossNow
        ? pickBossUpgradeChoices(playerStats)
        : s.upgradeChoices
      return {
        pendingBossUpgrades: s.pendingBossUpgrades + 1,
        upgradeChoices: choices,
      }
    }),
  setBossWarning: (v) =>
    set((s) => (s.bossWarning === v ? s : { bossWarning: v })),
  setBossHp: (hp, maxHp) =>
    set((s) =>
      s.bossHp === hp && s.bossMaxHp === maxHp ? s : { bossHp: hp, bossMaxHp: maxHp },
    ),
  setBossProgress: (p) =>
    set((s) => (s.bossProgress === p ? s : { bossProgress: p })),
  setLevelUpVisuals: (v) =>
    set((s) => {
      if (
        s.holdLeftProgress === v.holdLeftProgress &&
        s.holdRightProgress === v.holdRightProgress &&
        s.flashingIdx === v.flashingIdx &&
        s.slidingOut === v.slidingOut
      ) {
        return s
      }
      return v
    }),
}))
