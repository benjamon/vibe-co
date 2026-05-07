import { create } from 'zustand'
import { submitPreferenceVote } from './highscore'

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
  | 'emp'
  | 'empDuration'
  | 'empDps'
  | 'empRadius'
  | 'magnetRadius'
  | 'moveSpeed'
  | 'bulletSpeed'
  | 'drone'
  | 'markMissile'
  | 'necromancy'
  | 'knockback'
  | 'slow'
  | 'overclock'

export interface PlayerStats {
  fireInterval: number
  bulletCount: number
  bulletDamage: number
  burstCount: number
  penetration: number
  bulletRadiusMul: number
  bulletSpeedMul: number
  moveSpeedMul: number
  homingInterval: number
  homingLevel: number
  homingSalvoCount: number
  maxLives: number
  chainExplodeChance: number
  chainExplodeRadius: number
  shieldEnabled: boolean
  shieldMaxCooldown: number
  empoweredEvery: number
  instaKillChance: number
  healOnKillChance: number
  empEnabled: boolean
  empMaxCooldown: number
  empDuration: number
  empTickDamage: number
  empRadius: number
  magnetRadius: number
  droneCount: number
  markMissileEnabled: boolean
  markMissileMaxCooldown: number
  necromancyEnabled: boolean
  bulletKnockback: number
  bulletSlowEnabled: boolean
  overclockMul: number
}

const INITIAL_LIVES = 3
export const BASE_FIRE_INTERVAL = 0.36
export const BASE_EMP_RADIUS = 2.5
export const BASE_MAGNET_RADIUS = 1.5
export const CHAIN_DAMAGE = 2
export const CHAIN_RADIUS_BASE = 2.5 * 0.75 * 0.7 * 2

const BASE_STATS: PlayerStats = {
  fireInterval: BASE_FIRE_INTERVAL,
  bulletCount: 1,
  bulletDamage: 1,
  burstCount: 1,
  penetration: 0,
  bulletRadiusMul: 1,
  bulletSpeedMul: 1,
  moveSpeedMul: 1,
  homingInterval: 0,
  homingLevel: 0,
  homingSalvoCount: 1,
  maxLives: INITIAL_LIVES,
  chainExplodeChance: 0,
  chainExplodeRadius: 0,
  shieldEnabled: false,
  shieldMaxCooldown: 10,
  empoweredEvery: 0,
  instaKillChance: 0,
  healOnKillChance: 0,
  empEnabled: false,
  empMaxCooldown: 3,
  empDuration: 2,
  empTickDamage: 3,
  empRadius: BASE_EMP_RADIUS,
  magnetRadius: BASE_MAGNET_RADIUS,
  droneCount: 0,
  markMissileEnabled: false,
  markMissileMaxCooldown: 10,
  necromancyEnabled: false,
  bulletKnockback: 0,
  bulletSlowEnabled: false,
  overclockMul: 1,
}

export const playerStats: PlayerStats = { ...BASE_STATS }

export function resetStats() {
  Object.assign(playerStats, BASE_STATS)
}

export interface UpgradeDef {
  id: UpgradeId
  code: string
  name: string
  describe: (s: PlayerStats) => string
  isAvailable?: (s: PlayerStats) => boolean
  apply: (s: PlayerStats) => void
  bossOnly?: boolean
}

const HOMING_BASE_INTERVAL = 4
const HOMING_MAX_LEVEL = 8

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'fireRate',
    code: 'fr',
    name: 'Fire Rate Up',
    describe: (s) => {
      const oldPct = (BASE_FIRE_INTERVAL / s.fireInterval) * 100
      const newPct = oldPct / 0.85
      return `${Math.round(oldPct)}% → ${Math.round(newPct)}%`
    },
    apply: (s) => {
      s.fireInterval *= 0.85
    },
  },
  {
    id: 'bulletCount',
    code: 'mc',
    name: 'Multi-Shot',
    describe: (s) => `${s.bulletCount} → ${s.bulletCount + 1} bullets, −15% attack speed`,
    isAvailable: (s) => s.bulletCount < 5,
    apply: (s) => {
      s.bulletCount += 1
      s.fireInterval *= 1.15
    },
  },
  {
    id: 'damage',
    code: 'dmg',
    name: 'Damage Up',
    describe: (s) => `${s.bulletDamage} → ${s.bulletDamage + 1}`,
    apply: (s) => {
      s.bulletDamage += 1
    },
  },
  {
    id: 'burst',
    code: 'brt',
    name: 'Burst Fire',
    describe: (s) => `${s.burstCount} → ${s.burstCount + 1} rounds, −15% attack speed`,
    isAvailable: (s) => s.burstCount < 4,
    apply: (s) => {
      s.burstCount += 1
      s.fireInterval *= 1.15
    },
  },
  {
    id: 'penetration',
    code: 'pen',
    name: 'Piercing Rounds',
    describe: (s) => `${s.penetration} → ${s.penetration + 1} pierces`,
    isAvailable: (s) => s.penetration < 5,
    apply: (s) => {
      s.penetration += 1
    },
  },
  {
    id: 'homing',
    code: 'hm',
    name: 'Homing Missile',
    describe: (s) => {
      if (s.homingLevel <= 0) {
        const first = HOMING_BASE_INTERVAL * s.overclockMul
        return `Fire homing missiles every ${first.toFixed(2)}s`
      }
      const next = (HOMING_BASE_INTERVAL / (s.homingLevel + 1)) * s.overclockMul
      return `${s.homingInterval.toFixed(2)}s → ${next.toFixed(2)}s between salvos`
    },
    isAvailable: (s) => s.homingLevel < HOMING_MAX_LEVEL,
    apply: (s) => {
      s.homingLevel += 1
      s.homingInterval = (HOMING_BASE_INTERVAL / s.homingLevel) * s.overclockMul
    },
  },
  {
    id: 'homingSalvo',
    code: 'hms',
    name: 'Missile Salvo',
    describe: (s) => `${s.homingSalvoCount} → ${s.homingSalvoCount + 1} missiles per salvo`,
    isAvailable: (s) => s.homingLevel > 0 && s.homingSalvoCount < 4,
    apply: (s) => {
      s.homingSalvoCount += 1
    },
  },
  {
    id: 'maxHp',
    code: 'hp',
    name: 'Max HP Up',
    describe: (s) => `${s.maxLives} → ${s.maxLives + 1}`,
    apply: (s) => {
      s.maxLives += 1
    },
  },
  {
    id: 'largeBullets',
    code: 'sz',
    name: 'Bullet Size Up',
    describe: (s) => {
      const oldPct = Math.round(s.bulletRadiusMul * 100)
      const newPct = Math.round(s.bulletRadiusMul * 1.25 * 100)
      return `${oldPct}% → ${newPct}% bullet size`
    },
    isAvailable: (s) => s.bulletRadiusMul < 3,
    apply: (s) => {
      s.bulletRadiusMul *= 1.25
    },
  },
  {
    id: 'moveSpeed',
    code: 'mov',
    name: 'Move Speed Up',
    describe: (s) => {
      const oldPct = Math.round(s.moveSpeedMul * 100)
      const newPct = Math.round(s.moveSpeedMul * 1.05 * 100)
      return `${oldPct}% → ${newPct}% move speed`
    },
    apply: (s) => {
      s.moveSpeedMul *= 1.05
    },
  },
  {
    id: 'bulletSpeed',
    code: 'bsp',
    name: 'Bullet Speed Up',
    describe: (s) => {
      const oldPct = Math.round(s.bulletSpeedMul * 100)
      const newPct = Math.round(s.bulletSpeedMul * 1.1 * 100)
      return `${oldPct}% → ${newPct}% bullet speed`
    },
    apply: (s) => {
      s.bulletSpeedMul *= 1.1
    },
  },
  {
    id: 'drone',
    code: 'drn',
    name: 'Follow Drone',
    describe: (s) =>
      s.droneCount === 0
        ? 'Adds a wingman drone that fires with you'
        : `${s.droneCount} → ${s.droneCount + 1} drones`,
    isAvailable: (s) => s.droneCount < 5,
    apply: (s) => {
      s.droneCount += 1
    },
  },
  {
    id: 'chainExplode',
    code: 'cn',
    name: 'Chain Reaction',
    describe: (s) => {
      const oldChance = Math.round(s.chainExplodeChance * 100)
      const newChance = Math.round(Math.min(1, s.chainExplodeChance + 0.15) * 100)
      const oldRadiusPct =
        s.chainExplodeRadius <= 0 ? 0 : Math.round((s.chainExplodeRadius / CHAIN_RADIUS_BASE) * 100)
      const newRadiusPct =
        s.chainExplodeRadius <= 0
          ? 100
          : Math.round((s.chainExplodeRadius * 1.15 / CHAIN_RADIUS_BASE) * 100)
      return `Chance ${oldChance}% → ${newChance}%, Radius ${oldRadiusPct}% → ${newRadiusPct}%, ${CHAIN_DAMAGE} dmg`
    },
    isAvailable: (s) => s.chainExplodeChance < 1,
    apply: (s) => {
      s.chainExplodeChance = Math.min(1, s.chainExplodeChance + 0.15)
      if (s.chainExplodeRadius <= 0) s.chainExplodeRadius = CHAIN_RADIUS_BASE
      else s.chainExplodeRadius *= 1.15
    },
  },
  {
    id: 'markMissile',
    code: 'mrk',
    name: 'Mark Target',
    describe: () =>
      'Every 10s, marks the next enemy spawned — its damage spreads to all others',
    isAvailable: (s) => !s.markMissileEnabled,
    apply: (s) => {
      s.markMissileEnabled = true
      s.markMissileMaxCooldown = 10 * s.overclockMul
    },
  },
  {
    id: 'emp',
    code: 'emp',
    name: 'EMP Bomb',
    describe: () => 'Drops an EMP every 3s — pulses 2s, 3 dmg/tick',
    isAvailable: (s) => !s.empEnabled,
    apply: (s) => {
      s.empEnabled = true
      s.empMaxCooldown = 3 * s.overclockMul
      s.empDuration = 2
      s.empTickDamage = 3
      s.empRadius = BASE_EMP_RADIUS
    },
  },
  {
    id: 'empDuration',
    code: 'emd',
    name: 'EMP Sustain',
    describe: (s) => `${s.empDuration.toFixed(1)}s → ${(s.empDuration + 1).toFixed(1)}s EMP`,
    isAvailable: (s) => s.empEnabled && s.empDuration < 10,
    apply: (s) => {
      s.empDuration += 1
    },
  },
  {
    id: 'empDps',
    code: 'epd',
    name: 'EMP Power',
    describe: (s) => `${s.empTickDamage.toFixed(1)} → ${(s.empTickDamage * 1.5).toFixed(1)} dmg/tick`,
    isAvailable: (s) => s.empEnabled,
    apply: (s) => {
      s.empTickDamage *= 1.5
    },
  },
  {
    id: 'empRadius',
    code: 'emr',
    name: 'EMP Reach',
    describe: (s) => {
      const oldPct = Math.round((s.empRadius / BASE_EMP_RADIUS) * 100)
      const newPct = Math.round((s.empRadius * 1.25 / BASE_EMP_RADIUS) * 100)
      return `${oldPct}% → ${newPct}% EMP radius`
    },
    isAvailable: (s) => s.empEnabled && s.empRadius < 8,
    apply: (s) => {
      s.empRadius *= 1.25
    },
  },
  {
    id: 'overclock',
    code: 'oc',
    name: 'Overclock',
    describe: (s) => {
      const oldRate = Math.round((1 / s.overclockMul) * 100)
      const newRate = Math.round((1 / (s.overclockMul * 0.9)) * 100)
      return `−10% all weapon & shield cooldowns (rate ${oldRate}% → ${newRate}%)`
    },
    bossOnly: true,
    apply: (s) => {
      s.overclockMul *= 0.9
      s.fireInterval *= 0.9
      s.homingInterval *= 0.9
      s.empMaxCooldown *= 0.9
      s.markMissileMaxCooldown *= 0.9
      s.shieldMaxCooldown *= 0.9
    },
  },
  {
    id: 'magnetRadius',
    code: 'mag',
    name: 'Magnet Reach',
    describe: (s) => {
      const oldPct = Math.round((s.magnetRadius / BASE_MAGNET_RADIUS) * 100)
      const newPct = Math.round((s.magnetRadius * 1.25 / BASE_MAGNET_RADIUS) * 100)
      return `${oldPct}% → ${newPct}% pickup radius`
    },
    isAvailable: (s) => s.magnetRadius < 6,
    apply: (s) => {
      s.magnetRadius *= 1.25
    },
  },
  {
    id: 'shield',
    code: 'shd',
    name: 'Projectile Shield',
    describe: () => 'Nullify one hit every 10 seconds',
    bossOnly: true,
    isAvailable: (s) => !s.shieldEnabled,
    apply: (s) => {
      s.shieldEnabled = true
      s.shieldMaxCooldown = 10 * s.overclockMul
    },
  },
  {
    id: 'multiProjectile',
    code: 'mp',
    name: '+1 Projectile',
    describe: (s) =>
      s.homingLevel > 0 ? '+1 main bullet, +1 missile per salvo' : '+1 main bullet',
    bossOnly: true,
    apply: (s) => {
      s.bulletCount += 1
      if (s.homingLevel > 0) s.homingSalvoCount += 1
    },
  },
  {
    id: 'empower',
    code: 'epw',
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
    code: 'heal',
    name: 'Full Repair',
    describe: () => 'Heal to max HP',
    bossOnly: true,
    apply: () => {
      // lives applied in selectUpgrade
    },
  },
  {
    id: 'instaKill',
    code: 'crit',
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
    code: 'vamp',
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
    code: 'big',
    name: 'Massive Rounds',
    describe: () => '+50% bullet size',
    bossOnly: true,
    apply: (s) => {
      s.bulletRadiusMul *= 1.5
    },
  },
  {
    id: 'necromancy',
    code: 'nec',
    name: 'Necromancy',
    describe: () => 'Killed enemies spawn a ghost — haunts for 3s, deals your bullet damage',
    bossOnly: true,
    isAvailable: (s) => !s.necromancyEnabled,
    apply: (s) => {
      s.necromancyEnabled = true
    },
  },
  {
    id: 'knockback',
    code: 'kb',
    name: 'Knockback',
    describe: () => 'Main bullets push enemies back a small amount',
    bossOnly: true,
    isAvailable: (s) => s.bulletKnockback <= 0,
    apply: (s) => {
      s.bulletKnockback = 5
    },
  },
  {
    id: 'slow',
    code: 'cryo',
    name: 'Cryo Rounds',
    describe: () => 'Main bullets slow enemies 60% for 1s',
    bossOnly: true,
    isAvailable: (s) => !s.bulletSlowEnabled,
    apply: (s) => {
      s.bulletSlowEnabled = true
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

const UPGRADE_BY_CODE: Record<string, UpgradeDef> = UPGRADES.reduce(
  (acc, u) => {
    acc[u.code] = u
    return acc
  },
  {} as Record<string, UpgradeDef>,
)

export function getUpgrade(id: UpgradeId): UpgradeDef {
  return UPGRADE_BY_ID[id]
}

export function getUpgradeByCode(code: string): UpgradeDef | undefined {
  return UPGRADE_BY_CODE[code]
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
  return 4 + (level - 1) * 3.3
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
  dangerMessage: string
}

export type RunBuild = Record<string, number>

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
  userPaused: boolean
  masterVolume: number
  sfxVolume: number
  musicVolume: number
  runBuild: RunBuild
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
  setDangerMessage: (msg: string) => void
  setUserPaused: (v: boolean) => void
  toggleUserPaused: () => void
  setMasterVolume: (v: number) => void
  setSfxVolume: (v: number) => void
  setMusicVolume: (v: number) => void
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
  dangerMessage: '',
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
  userPaused: false,
  masterVolume: 1.0,
  sfxVolume: 0.8,
  musicVolume: 0.5,
  runBuild: {},
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
      userPaused: false,
      runBuild: {},
      ...RESET_VISUALS,
  ...RESET_BOSS_UI,
    })
    get().grantUpgrade()
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
    const choices = get().upgradeChoices
    const id = choices[idx]
    if (!id) return
    const def = UPGRADE_BY_ID[id]
    if (choices.length === 2) {
      const otherId = choices[idx === 0 ? 1 : 0]
      const otherDef = UPGRADE_BY_ID[otherId]
      if (otherDef) {
        const codes = [def.code, otherDef.code].sort()
        const pairId = `${codes[0]}-${codes[1]}`
        const delta = def.code === codes[0] ? 1 : -1
        submitPreferenceVote(pairId, delta)
      }
    }
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
      const nextRunBuild: RunBuild = { ...s.runBuild, [def.code]: (s.runBuild[def.code] ?? 0) + 1 }
      return {
        pendingBossUpgrades: Math.max(0, remainingBoss),
        pendingLevelUps: Math.max(0, remainingRegular),
        upgradeChoices: nextChoices,
        lives: livesNext,
        runBuild: nextRunBuild,
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
  setDangerMessage: (msg) =>
    set((s) => (s.dangerMessage === msg ? s : { dangerMessage: msg })),
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
  setUserPaused: (v) => set((s) => (s.userPaused === v ? s : { userPaused: v })),
  toggleUserPaused: () => set((s) => ({ userPaused: !s.userPaused })),
  setMasterVolume: (v) => set({ masterVolume: Math.max(0, Math.min(1, v)) }),
  setSfxVolume: (v) => set({ sfxVolume: Math.max(0, Math.min(1, v)) }),
  setMusicVolume: (v) => set({ musicVolume: Math.max(0, Math.min(1, v)) }),
}))
