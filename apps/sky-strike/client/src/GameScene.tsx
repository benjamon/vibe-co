import { useFrame, useThree } from '@react-three/fiber'
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
} from 'three'
import { CHAIN_DAMAGE, playerStats, useGameStore } from './store'
import { useInput, type InputState } from './useInput'
import { playConfirm, playDamage, playEmpTick, playHit, playKill, playLevelUp, playMissileHit, playPickup, playShoot, playSpawn } from './audio'
import {
  addChainRing,
  addEmpTrail,
  addExplosion,
  addHitSparks,
  addMuzzleFlash,
  addPlayerHit,
  addShake,
  addSpawnRing,
  clearEffects,
  getParticles,
  getShake,
  updateEffects,
} from './effects'

const FIELD_HALF_WIDTH = 7
const FIELD_TOP = 10
const FIELD_BOTTOM = -10
const PLAYER_Y = -7
const PLAYER_SPEED = 9
const PLAYER_RADIUS = 0.55

const BULLET_SPEED_PLAYER = 16
const BULLET_SPEED_ENEMY = 7
const BULLET_RADIUS = 0.18
const BURST_DELAY = 0.06

const ENEMY_RADIUS = 0.55
const MISSILE_RADIUS = 0.3
const MISSILE_DAMAGE = 5
const MISSILE_MAX_SPEED = 14
const MISSILE_ACCEL = 30
const MISSILE_LIFETIME = 5
const MISSILE_ARM_DELAY_MIN = 0.5
const MISSILE_ARM_DELAY_MAX = 1.0
const MISSILE_TUMBLE_SPEED = 8
const MISSILE_TUMBLE_SPIN = 16
const MISSILE_TUMBLE_DRAG = 2.0

const MAX_BULLETS = 128
const MAX_MISSILES = 24
const MAX_ENEMIES_PER_TYPE = 24
const MAX_PARTICLES = 600
const MAX_RINGS = 32
const STAR_COUNT = 80
const MAX_EMPS = 4
const MAX_DIAMONDS = 240
const MAX_DRONES = 5
const DRONE_SPACING = 1.0
const DRONE_FOLLOW_RATE = 5

const MAX_GHOSTS = 64
const GHOST_LIFETIME = 3.0
const GHOST_RADIUS = 0.45
const GHOST_SPEED = 4
const GHOST_DIR_CHANGE_MIN = 0.25
const GHOST_DIR_CHANGE_MAX = 0.6
const MAX_GHOST_HITS = 16

const KNOCKBACK_DAMP = 8
const SLOW_DURATION = 1.0
const SLOW_FACTOR = 0.4

const EMP_FLIGHT_SPEED = 9
const EMP_TARGET_Y = 5
const EMP_TICK_INTERVAL = 0.5

const DIAMOND_DRIFT_VY = -2
const DIAMOND_MAGNET_SPEED = 16
const DIAMOND_COLLECT_THRESHOLD = 0.55
const DIAMOND_RADIUS = 0.27

const DANGER_MESSAGE = 'ENEMY POWER UP'
const DANGER_MESSAGE_DURATION = 3.0

const MAX_BULLET_HITS = 8

const BOSS_INTERVAL = 120
const BOSS_WARNING_DURATION = 8
const BOSS_DYING_DURATION = 1.6
const BOSS_HALF_WIDTH = 3.5
const BOSS_HALF_HEIGHT = 1.2
const BOSS_HP_MUL = 200
const BOSS_FIRE_INTERVAL = 1 / 5
const BOSS_FIRE_HALF_ARC = Math.PI / 6
const BOSS_BULLET_SPEED = 7.5
const BOSS_SCORE = 5000
const BOSS_XP = 10
const BOSS_DEATH_EXPLOSIONS = 14
const BOSS_DEATH_EXPLOSION_INTERVAL = 0.11
const BOSS_TARGET_Y = 5.5
const BOSS_ENTER_SPEED = 3
const BOSS_SWAY_AMP = 4
const BOSS_SWAY_FREQ = 0.6

const LEVEL_UP_INPUT_LOCKOUT = 0.65
const LEVEL_UP_HOLD_DURATION = 0.4
const LEVEL_UP_FLASH_DURATION = 0.35
const LEVEL_UP_SLIDE_OUT_DURATION = 0.55

type LevelUpPhase = 'hold' | 'flash' | 'out'

type EnemyType = 0 | 1 | 2

interface Bullet {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  fromPlayer: boolean
  empowered: boolean
  damage: number
  pen: number
  radius: number
  hitGens: Float64Array
  hitCount: number
}

interface Enemy {
  active: boolean
  type: EnemyType
  x: number
  y: number
  vy: number
  hp: number
  fireTimer: number
  age: number
  baseX: number
  swayAmplitude: number
  swayFrequency: number
  gen: number
  elite: boolean
  marked: boolean
  slowTimer: number
  knockbackVy: number
}

const ELITE_SCALE = 1.15
const ELITE_HP_MUL = 2
const ELITE_XP_MUL = 2
const ELITE_SPAWN_INTERVAL = 24

type BossPhase = 'idle' | 'warning' | 'enter' | 'fight' | 'dying'

interface BossState {
  phase: BossPhase
  timer: number
  x: number
  y: number
  swayPhase: number
  hp: number
  maxHp: number
  gen: number
  fireTimer: number
  deathExplosionTimer: number
  deathExplosionCount: number
  killCount: number
  upgradeGranted: boolean
}

let nextGen = 1
function newGen() {
  return nextGen++
}

let lastBossProgress = -1
function publishBossProgress(p: number) {
  const rounded = Math.max(0, Math.min(1, Math.floor(p * 200) / 200))
  if (rounded === lastBossProgress) return
  lastBossProgress = rounded
  useGameStore.getState().setBossProgress(rounded)
}

// Per-frame accumulators — coalesce many small store updates into one flush
// per frame so React subscribers re-render at most once and the store
// allocates a single state object per channel instead of one per kill / hit.
let frameScore = 0
let frameXp = 0
let frameHeal = 0
let bossHpDirty = false
let pendingBossHp = 0
let pendingBossMaxHp = 0

function pushScore(n: number) {
  frameScore += n
}
function pushXp(n: number) {
  frameXp += n
}
function pushHeal(n: number) {
  frameHeal += n
}
function pushBossHp(hp: number, maxHp: number) {
  pendingBossHp = hp
  pendingBossMaxHp = maxHp
  bossHpDirty = true
}
function flushFrameUpdates(store: ReturnType<typeof useGameStore.getState>) {
  if (frameScore !== 0) {
    store.addScore(frameScore)
    frameScore = 0
  }
  if (frameXp !== 0) {
    store.addXp(frameXp)
    frameXp = 0
  }
  if (frameHeal !== 0) {
    store.heal(frameHeal)
    frameHeal = 0
  }
  if (bossHpDirty) {
    store.setBossHp(pendingBossHp, pendingBossMaxHp)
    bossHpDirty = false
  }
}

interface Missile {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  age: number
  armTimer: number
  rotation: number
  angularVelocity: number
  mark: boolean
}

type EmpPhase = 'flight' | 'active'

interface EmpState {
  active: boolean
  phase: EmpPhase
  x: number
  y: number
  vy: number
  ageRemaining: number
  age: number
  tickTimer: number
}

interface Diamond {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  value: number
  phase: number
}

interface Drone {
  active: boolean
  x: number
  y: number
}

interface Ghost {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  age: number
  damage: number
  changeDirTimer: number
  hitGens: Float64Array
  hitCount: number
}

const COLOR_BULLET_PLAYER = new Color('#33ffaa')
const COLOR_BULLET_ENEMY = new Color('#ff3344')
const COLOR_BULLET_EMPOWERED = new Color('#ffdd33')
const COLOR_MISSILE_NORMAL = new Color('#aaff44')
const COLOR_MISSILE_MARK = new Color('#1a0033')
const COLOR_ENEMY_BASIC_HEX = '#ff5577'
const COLOR_ENEMY_SHOOTER_HEX = '#ffaa33'
const COLOR_ENEMY_ZIGZAG_HEX = '#aa66ff'
const PLAYER_COLOR_NORMAL = new Color('#33ddff')
const PLAYER_COLOR_HIT = new Color('#ffffff')
const PLAYER_EMISSIVE_NORMAL = new Color('#1166aa')
const PLAYER_EMISSIVE_HIT = new Color('#ffffff')

const tempObj = new Object3D()
const tempColor = new Color()
const HIDDEN_MATRIX = new Matrix4().makeScale(0, 0, 0)

function pickEnemyType(elapsed: number): EnemyType {
  const r = Math.random()
  // zigzag × 0.7, shooter × 0.5; basic absorbs the freed share.
  if (elapsed < 8) return r < 0.895 ? 0 : 2
  if (elapsed < 20) {
    if (r < 0.75) return 0
    if (r < 0.925) return 2
    return 1
  }
  if (r < 0.665) return 0
  if (r < 0.875) return 2
  return 1
}

function spawnInterval(elapsed: number): number {
  return Math.max(0.35, 1.1 - elapsed * 0.025)
}

function colorHexFor(type: EnemyType): string {
  if (type === 0) return COLOR_ENEMY_BASIC_HEX
  if (type === 1) return COLOR_ENEMY_SHOOTER_HEX
  return COLOR_ENEMY_ZIGZAG_HEX
}

function scoreFor(type: EnemyType): number {
  if (type === 0) return 50
  if (type === 2) return 100
  return 150
}

function xpFor(type: EnemyType): number {
  if (type === 0) return 1
  if (type === 2) return 2
  return 3
}

function gemCountFor(type: EnemyType): number {
  return type === 0 ? 1 : 2
}

function dropGems(diamonds: Diamond[], e: Enemy) {
  const value = xpFor(e.type) * (e.elite ? ELITE_XP_MUL : 1)
  const count = gemCountFor(e.type)
  for (let k = 0; k < count; k++) {
    spawnDiamond(diamonds, e.x, e.y, value)
  }
}

function makeBulletPool(): Bullet[] {
  const arr: Bullet[] = []
  for (let i = 0; i < MAX_BULLETS; i++) {
    arr.push({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      fromPlayer: true,
      empowered: false,
      damage: 1,
      pen: 0,
      radius: BULLET_RADIUS,
      hitGens: new Float64Array(MAX_BULLET_HITS),
      hitCount: 0,
    })
  }
  return arr
}

function bulletHasHit(b: Bullet, gen: number): boolean {
  for (let i = 0; i < b.hitCount; i++) {
    if (b.hitGens[i] === gen) return true
  }
  return false
}

function recordHit(b: Bullet, gen: number) {
  if (b.hitCount < b.hitGens.length) {
    b.hitGens[b.hitCount++] = gen
  }
}

function makeBoss(): BossState {
  return {
    phase: 'idle',
    timer: BOSS_INTERVAL,
    x: 0,
    y: 0,
    swayPhase: 0,
    hp: 0,
    maxHp: 0,
    gen: 0,
    fireTimer: 0,
    deathExplosionTimer: 0,
    deathExplosionCount: 0,
    killCount: 0,
    upgradeGranted: false,
  }
}

function makeMissilePool(): Missile[] {
  const arr: Missile[] = []
  for (let i = 0; i < MAX_MISSILES; i++) {
    arr.push({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      age: 0,
      armTimer: 0,
      rotation: 0,
      angularVelocity: 0,
      mark: false,
    })
  }
  return arr
}

function makeEmpPool(): EmpState[] {
  const arr: EmpState[] = []
  for (let i = 0; i < MAX_EMPS; i++) {
    arr.push({
      active: false,
      phase: 'flight',
      x: 0,
      y: 0,
      vy: 0,
      ageRemaining: 0,
      age: 0,
      tickTimer: 0,
    })
  }
  return arr
}

function findInactiveEmp(pool: EmpState[]): EmpState | null {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].active) return pool[i]
  }
  return null
}

function makeDiamondPool(): Diamond[] {
  const arr: Diamond[] = []
  for (let i = 0; i < MAX_DIAMONDS; i++) {
    arr.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, value: 0, phase: 0 })
  }
  return arr
}

function makeDronePool(): Drone[] {
  const arr: Drone[] = []
  for (let i = 0; i < MAX_DRONES; i++) {
    arr.push({ active: false, x: 0, y: 0 })
  }
  return arr
}

function makeGhostPool(): Ghost[] {
  const arr: Ghost[] = []
  for (let i = 0; i < MAX_GHOSTS; i++) {
    arr.push({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      age: 0,
      damage: 0,
      changeDirTimer: 0,
      hitGens: new Float64Array(MAX_GHOST_HITS),
      hitCount: 0,
    })
  }
  return arr
}

let ghostsPool: Ghost[] | null = null
function spawnGhost(x: number, y: number, damage: number) {
  const pool = ghostsPool
  if (!pool) return
  for (let i = 0; i < pool.length; i++) {
    const g = pool[i]
    if (!g.active) {
      g.active = true
      g.x = x
      g.y = y
      const angle = Math.random() * Math.PI * 2
      g.vx = Math.cos(angle) * GHOST_SPEED
      g.vy = Math.sin(angle) * GHOST_SPEED
      g.age = 0
      g.damage = damage
      g.changeDirTimer =
        GHOST_DIR_CHANGE_MIN + Math.random() * (GHOST_DIR_CHANGE_MAX - GHOST_DIR_CHANGE_MIN)
      g.hitCount = 0
      return
    }
  }
}

function ghostHasHit(g: Ghost, gen: number): boolean {
  for (let i = 0; i < g.hitCount; i++) {
    if (g.hitGens[i] === gen) return true
  }
  return false
}

function recordGhostHit(g: Ghost, gen: number) {
  if (g.hitCount < g.hitGens.length) {
    g.hitGens[g.hitCount++] = gen
  }
}

function spawnDiamond(diamonds: Diamond[], x: number, y: number, value: number) {
  for (let i = 0; i < diamonds.length; i++) {
    const d = diamonds[i]
    if (!d.active) {
      d.active = true
      d.x = x
      d.y = y
      d.vx = (Math.random() - 0.5) * 2
      d.vy = 1 + Math.random() * 1.5
      d.value = value
      d.phase = Math.random() * Math.PI * 2
      return
    }
  }
}

function makeEnemyPool(type: EnemyType): Enemy[] {
  const arr: Enemy[] = []
  for (let i = 0; i < MAX_ENEMIES_PER_TYPE; i++) {
    arr.push({
      active: false,
      type,
      x: 0,
      y: 0,
      vy: 0,
      hp: 0,
      fireTimer: 0,
      age: 0,
      baseX: 0,
      swayAmplitude: 0,
      swayFrequency: 0,
      gen: 0,
      elite: false,
      marked: false,
      slowTimer: 0,
      knockbackVy: 0,
    })
  }
  return arr
}

function findInactiveBullet(pool: Bullet[]): Bullet | null {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].active) return pool[i]
  }
  return null
}

function findInactiveMissile(pool: Missile[]): Missile | null {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].active) return pool[i]
  }
  return null
}

function findInactiveEnemy(pool: Enemy[]): Enemy | null {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].active) return pool[i]
  }
  return null
}

function GameSceneInner() {
  const started = useGameStore((s) => s.started)

  const { camera } = useThree()
  const inputRef = useInput()

  const playerRef = useRef<Group>(null)
  const playerBodyMatRef = useRef<MeshStandardMaterial>(null)
  const shieldMeshRef = useRef<Mesh>(null)
  const bossMeshRef = useRef<Mesh>(null)
  const bossMatRef = useRef<MeshBasicMaterial>(null)
  const bossRef = useRef<BossState>(makeBoss())
  const playerXRef = useRef(0)
  const fireTimerRef = useRef(0)
  const burstShotsRef = useRef(0)
  const burstTimerRef = useRef(0)
  const homingTimerRef = useRef(0)
  const empCooldownRef = useRef(0)
  const shotCounterRef = useRef(0)
  const shieldCooldownRef = useRef(0)
  const lastDangerMinuteRef = useRef(0)
  const dangerClearTimerRef = useRef(0)
  const spawnTimerRef = useRef(0.6)
  const elapsedRef = useRef(0)
  const eliteSpawnCounterRef = useRef(0)
  const invulnRef = useRef(0)
  const wasPausedRef = useRef(false)
  const pauseLockoutRef = useRef(0)
  const phaseRef = useRef<LevelUpPhase>('hold')
  const phaseTimerRef = useRef(0)
  const holdLeftTimerRef = useRef(0)
  const holdRightTimerRef = useRef(0)
  const selectedIdxRef = useRef<-1 | 0 | 1>(-1)

  const bulletsMeshRef = useRef<InstancedMesh>(null)
  const missilesMeshRef = useRef<InstancedMesh>(null)
  const empBallMeshRef = useRef<InstancedMesh>(null)
  const empMeshRef = useRef<InstancedMesh>(null)
  const diamondMeshRef = useRef<InstancedMesh>(null)
  const basicMeshRef = useRef<InstancedMesh>(null)
  const shooterMeshRef = useRef<InstancedMesh>(null)
  const cockpitMeshRef = useRef<InstancedMesh>(null)
  const zigzagMeshRef = useRef<InstancedMesh>(null)
  const sparkMeshRef = useRef<InstancedMesh>(null)
  const puffMeshRef = useRef<InstancedMesh>(null)
  const ringMeshRef = useRef<InstancedMesh>(null)
  const starMeshRef = useRef<InstancedMesh>(null)
  const droneMeshRef = useRef<InstancedMesh>(null)
  const ghostMeshRef = useRef<InstancedMesh>(null)
  const prevSparkUsedRef = useRef(0)
  const prevPuffUsedRef = useRef(0)
  const prevRingUsedRef = useRef(0)
  const markMissileCooldownRef = useRef(0)

  const bullets = useMemo(makeBulletPool, [])
  const missiles = useMemo(makeMissilePool, [])
  const emps = useMemo(makeEmpPool, [])
  const diamonds = useMemo(makeDiamondPool, [])
  const drones = useMemo(makeDronePool, [])
  const ghosts = useMemo(makeGhostPool, [])

  useEffect(() => {
    ghostsPool = ghosts
    return () => {
      ghostsPool = null
    }
  }, [ghosts])
  const enemiesBasic = useMemo(() => makeEnemyPool(0), [])
  const enemiesShooter = useMemo(() => makeEnemyPool(1), [])
  const enemiesZigzag = useMemo(() => makeEnemyPool(2), [])
  const allEnemyPools = useMemo(
    () => [enemiesBasic, enemiesShooter, enemiesZigzag],
    [enemiesBasic, enemiesShooter, enemiesZigzag],
  )

  const stars = useMemo(() => {
    const arr: { x: number; y: number; size: number }[] = []
    for (let i = 0; i < STAR_COUNT; i++) {
      arr.push({
        x: (Math.random() * 2 - 1) * FIELD_HALF_WIDTH * 1.3,
        y: (Math.random() * 2 - 1) * FIELD_TOP * 1.2,
        size: 0.03 + Math.random() * 0.08,
      })
    }
    return arr
  }, [])

  useLayoutEffect(() => {
    const meshes = [
      bulletsMeshRef.current,
      missilesMeshRef.current,
      empMeshRef.current,
      empBallMeshRef.current,
      diamondMeshRef.current,
      basicMeshRef.current,
      shooterMeshRef.current,
      cockpitMeshRef.current,
      zigzagMeshRef.current,
      sparkMeshRef.current,
      puffMeshRef.current,
      ringMeshRef.current,
      droneMeshRef.current,
      ghostMeshRef.current,
    ]
    for (const mesh of meshes) {
      if (!mesh) continue
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, HIDDEN_MATRIX)
      mesh.instanceMatrix.needsUpdate = true
      mesh.frustumCulled = false
    }
    const star = starMeshRef.current
    if (star) {
      for (let i = 0; i < STAR_COUNT; i++) {
        const s = stars[i]
        tempObj.position.set(s.x, s.y, -2)
        tempObj.rotation.set(0, 0, 0)
        tempObj.scale.setScalar(s.size)
        tempObj.updateMatrix()
        star.setMatrixAt(i, tempObj.matrix)
      }
      star.instanceMatrix.needsUpdate = true
      star.frustumCulled = false
    }
  }, [stars])

  useEffect(() => {
    if (started) {
      playerXRef.current = 0
      fireTimerRef.current = 0
      burstShotsRef.current = 0
      burstTimerRef.current = 0
      homingTimerRef.current = playerStats.homingInterval
      empCooldownRef.current = playerStats.empMaxCooldown
      markMissileCooldownRef.current = playerStats.markMissileMaxCooldown
      shotCounterRef.current = 0
      shieldCooldownRef.current = 0
      lastDangerMinuteRef.current = 0
      dangerClearTimerRef.current = 0
      spawnTimerRef.current = 0.5
      elapsedRef.current = 0
      eliteSpawnCounterRef.current = 0
      invulnRef.current = 1.2
      for (let i = 0; i < bullets.length; i++) {
        bullets[i].active = false
        bullets[i].hitCount = 0
      }
      for (let i = 0; i < missiles.length; i++) missiles[i].active = false
      for (let i = 0; i < emps.length; i++) emps[i].active = false
      for (let i = 0; i < diamonds.length; i++) diamonds[i].active = false
      for (let i = 0; i < drones.length; i++) {
        drones[i].active = false
        drones[i].x = 0
        drones[i].y = PLAYER_Y
      }
      for (let i = 0; i < ghosts.length; i++) {
        ghosts[i].active = false
        ghosts[i].hitCount = 0
      }
      for (let i = 0; i < enemiesBasic.length; i++) enemiesBasic[i].active = false
      for (let i = 0; i < enemiesShooter.length; i++) enemiesShooter[i].active = false
      for (let i = 0; i < enemiesZigzag.length; i++) enemiesZigzag[i].active = false
      const boss = bossRef.current
      boss.phase = 'idle'
      boss.timer = BOSS_INTERVAL
      boss.x = 0
      boss.y = 0
      boss.swayPhase = 0
      boss.hp = 0
      boss.maxHp = 0
      boss.gen = 0
      boss.fireTimer = 0
      boss.deathExplosionCount = 0
      boss.deathExplosionTimer = 0
      boss.killCount = 0
      boss.upgradeGranted = false
      frameScore = 0
      frameXp = 0
      frameHeal = 0
      bossHpDirty = false
      const store = useGameStore.getState()
      store.setBossWarning(false)
      store.setBossHp(0, 0)
      lastBossProgress = -1
      store.setBossProgress(0)
      store.setDangerMessage('')
      clearEffects()
    }
  }, [started, bullets, missiles, emps, diamonds, drones, ghosts, enemiesBasic, enemiesShooter, enemiesZigzag])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const state = useGameStore.getState()
    if (state.userPaused) {
      return
    }
    const paused = state.pendingLevelUps + state.pendingBossUpgrades > 0

    if (paused) {
      const input = inputRef.current
      if (!wasPausedRef.current) {
        wasPausedRef.current = true
        pauseLockoutRef.current = LEVEL_UP_INPUT_LOCKOUT
        phaseRef.current = 'hold'
        phaseTimerRef.current = 0
        holdLeftTimerRef.current = 0
        holdRightTimerRef.current = 0
        selectedIdxRef.current = -1
        playLevelUp()
      }

      if (phaseRef.current === 'hold') {
        if (pauseLockoutRef.current > 0) {
          pauseLockoutRef.current -= dt
          holdLeftTimerRef.current = 0
          holdRightTimerRef.current = 0
        } else {
          if (input.left && !input.right) {
            holdLeftTimerRef.current += dt
            holdRightTimerRef.current = 0
          } else if (input.right && !input.left) {
            holdRightTimerRef.current += dt
            holdLeftTimerRef.current = 0
          } else {
            holdLeftTimerRef.current = 0
            holdRightTimerRef.current = 0
          }
          if (holdLeftTimerRef.current >= LEVEL_UP_HOLD_DURATION) {
            selectedIdxRef.current = 0
            phaseRef.current = 'flash'
            phaseTimerRef.current = LEVEL_UP_FLASH_DURATION
            playConfirm()
          } else if (holdRightTimerRef.current >= LEVEL_UP_HOLD_DURATION) {
            selectedIdxRef.current = 1
            phaseRef.current = 'flash'
            phaseTimerRef.current = LEVEL_UP_FLASH_DURATION
            playConfirm()
          }
        }
        state.setLevelUpVisuals({
          holdLeftProgress: Math.min(1, holdLeftTimerRef.current / LEVEL_UP_HOLD_DURATION),
          holdRightProgress: Math.min(1, holdRightTimerRef.current / LEVEL_UP_HOLD_DURATION),
          flashingIdx: -1,
          slidingOut: false,
        })
      } else if (phaseRef.current === 'flash') {
        phaseTimerRef.current -= dt
        state.setLevelUpVisuals({
          holdLeftProgress: 0,
          holdRightProgress: 0,
          flashingIdx: selectedIdxRef.current,
          slidingOut: false,
        })
        if (phaseTimerRef.current <= 0) {
          phaseRef.current = 'out'
          phaseTimerRef.current = LEVEL_UP_SLIDE_OUT_DURATION
          state.setLevelUpVisuals({
            holdLeftProgress: 0,
            holdRightProgress: 0,
            flashingIdx: -1,
            slidingOut: true,
          })
        }
      } else {
        phaseTimerRef.current -= dt
        if (phaseTimerRef.current <= 0) {
          const idx = selectedIdxRef.current
          if (idx === 0 || idx === 1) state.selectUpgrade(idx)
          if (useGameStore.getState().pendingLevelUps > 0) {
            phaseRef.current = 'hold'
            phaseTimerRef.current = 0
            holdLeftTimerRef.current = 0
            holdRightTimerRef.current = 0
            selectedIdxRef.current = -1
            pauseLockoutRef.current = LEVEL_UP_INPUT_LOCKOUT
            useGameStore.getState().setLevelUpVisuals({
              holdLeftProgress: 0,
              holdRightProgress: 0,
              flashingIdx: -1,
              slidingOut: false,
            })
            playLevelUp()
          }
        }
      }

      camera.position.x = 0
      camera.position.y = 0
      return
    }
    wasPausedRef.current = false
    pauseLockoutRef.current = 0
    phaseRef.current = 'hold'
    phaseTimerRef.current = 0
    holdLeftTimerRef.current = 0
    holdRightTimerRef.current = 0
    selectedIdxRef.current = -1

    if (started) {
      if (bossRef.current.phase === 'idle') elapsedRef.current += dt
      if (invulnRef.current > 0) invulnRef.current -= dt
      if (shieldCooldownRef.current > 0) shieldCooldownRef.current -= dt

      const minute = Math.floor(elapsedRef.current / 60)
      if (minute > lastDangerMinuteRef.current) {
        lastDangerMinuteRef.current = minute
        useGameStore.getState().setDangerMessage(DANGER_MESSAGE)
        dangerClearTimerRef.current = DANGER_MESSAGE_DURATION
      }
      if (dangerClearTimerRef.current > 0) {
        dangerClearTimerRef.current -= dt
        if (dangerClearTimerRef.current <= 0) {
          useGameStore.getState().setDangerMessage('')
        }
      }

      const input: InputState = inputRef.current
      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0)
      playerXRef.current += dir * PLAYER_SPEED * playerStats.moveSpeedMul * dt
      if (playerXRef.current < -FIELD_HALF_WIDTH + 0.25) playerXRef.current = -FIELD_HALF_WIDTH + 0.25
      if (playerXRef.current > FIELD_HALF_WIDTH - 0.25) playerXRef.current = FIELD_HALF_WIDTH - 0.25

      updateDrones(drones, dt, playerXRef.current)

      fireTimerRef.current -= dt
      if (fireTimerRef.current <= 0 && burstShotsRef.current === 0) {
        fireTimerRef.current = playerStats.fireInterval
        burstShotsRef.current = playerStats.burstCount
        burstTimerRef.current = 0
      }
      if (burstShotsRef.current > 0) {
        burstTimerRef.current -= dt
        if (burstTimerRef.current <= 0) {
          burstTimerRef.current = BURST_DELAY
          burstShotsRef.current -= 1
          shotCounterRef.current += 1
          fireSalvo(bullets, playerXRef.current, shotCounterRef.current)
          fireDroneShots(bullets, drones)
        }
      }

      if (playerStats.homingInterval > 0) {
        homingTimerRef.current -= dt
        if (homingTimerRef.current <= 0) {
          homingTimerRef.current = playerStats.homingInterval
          spawnMissileSalvo(missiles, playerXRef.current)
        }
      }

      if (playerStats.markMissileEnabled) {
        markMissileCooldownRef.current -= dt
        if (markMissileCooldownRef.current <= 0) {
          markMissileCooldownRef.current = playerStats.markMissileMaxCooldown
          spawnMarkMissile(missiles, playerXRef.current)
        }
      }

      if (playerStats.empEnabled) {
        empCooldownRef.current -= dt
        if (empCooldownRef.current <= 0) {
          empCooldownRef.current = playerStats.empMaxCooldown
          spawnEmp(emps, playerXRef.current)
        }
      }
      updateEmps(emps, dt, allEnemyPools, bossRef.current, diamonds)
      updateDiamonds(diamonds, dt, playerXRef.current, PLAYER_Y)

      spawnTimerRef.current -= dt
      if (spawnTimerRef.current <= 0 && bossRef.current.phase === 'idle') {
        spawnTimerRef.current = spawnInterval(elapsedRef.current)
        const type = pickEnemyType(elapsedRef.current)
        const pool = type === 0 ? enemiesBasic : type === 1 ? enemiesShooter : enemiesZigzag
        const e = findInactiveEnemy(pool)
        if (e) {
          const x = (Math.random() * 2 - 1) * (FIELD_HALF_WIDTH - 0.8)
          let isElite = false
          if (bossRef.current.killCount > 0) {
            eliteSpawnCounterRef.current += 1
            isElite = eliteSpawnCounterRef.current % ELITE_SPAWN_INTERVAL === 0
          }
          e.active = true
          e.type = type
          e.x = x
          e.y = FIELD_TOP + 1
          e.baseX = x
          e.age = 0
          e.fireTimer = 1 + Math.random() * 1.5
          e.swayAmplitude = 0
          e.swayFrequency = 0
          e.gen = newGen()
          e.elite = isElite
          e.marked = false
          e.slowTimer = 0
          e.knockbackVy = 0
          const hpScale = Math.pow(2, elapsedRef.current / 60)
          e.hp = Math.ceil(1 * hpScale)
          if (type === 0) {
            e.vy = -3 - Math.random() * 1.2
          } else if (type === 1) {
            e.vy = -1.8
            e.hp = Math.ceil(3 * hpScale)
          } else {
            e.vy = -2.2
            e.swayAmplitude = 2
            e.swayFrequency = 1.4
          }
          if (isElite) e.hp *= ELITE_HP_MUL
          addSpawnRing(e.x, e.y, colorHexFor(type))
          playSpawn()
        }
      }

      updateEnemyPool(enemiesBasic, dt, bullets)
      updateEnemyPool(enemiesShooter, dt, bullets)
      updateEnemyPool(enemiesZigzag, dt, bullets)

      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i]
        if (!b.active) continue
        b.x += b.vx * dt
        b.y += b.vy * dt
        if (
          b.y > FIELD_TOP + 1 ||
          b.y < FIELD_BOTTOM - 1 ||
          b.x < -FIELD_HALF_WIDTH - 3 ||
          b.x > FIELD_HALF_WIDTH + 3
        ) {
          b.active = false
        }
      }

      const boss = bossRef.current
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i]
        if (!b.active || !b.fromPlayer) continue
        let budget = b.pen + 1 - b.hitCount
        if (budget <= 0) {
          b.active = false
          continue
        }
        budget = damageEnemiesInRange(b, enemiesBasic, budget, allEnemyPools, boss, diamonds)
        if (budget > 0) budget = damageEnemiesInRange(b, enemiesShooter, budget, allEnemyPools, boss, diamonds)
        if (budget > 0) budget = damageEnemiesInRange(b, enemiesZigzag, budget, allEnemyPools, boss, diamonds)
        if (budget > 0 && bossIsTargetable(boss) && !bulletHasHit(b, boss.gen)) {
          if (bulletHitsBoss(b, boss)) {
            recordHit(b, boss.gen)
            applyBossDamage(boss, b.damage, b.x, b.y)
            budget -= 1
          }
        }
        if (budget <= 0) b.active = false
      }

      updateMissiles(missiles, dt, allEnemyPools, boss, diamonds)
      updateGhosts(ghosts, dt, allEnemyPools, boss, diamonds)

      const px = playerXRef.current
      const py = PLAYER_Y
      if (invulnRef.current <= 0) {
        let hit = false
        for (let i = 0; i < bullets.length; i++) {
          const b = bullets[i]
          if (!b.active || b.fromPlayer) continue
          const dx = b.x - px
          const dy = b.y - py
          const r = b.radius + PLAYER_RADIUS
          if (dx * dx + dy * dy < r * r) {
            b.active = false
            hit = true
            break
          }
        }
        if (!hit) {
          if (
            tryRamPlayer(enemiesBasic, px, py) ||
            tryRamPlayer(enemiesShooter, px, py) ||
            tryRamPlayer(enemiesZigzag, px, py)
          ) {
            hit = true
          }
        }
        if (!hit && bossIsTargetable(boss)) {
          const dx = boss.x - px
          const dy = boss.y - py
          const rx = BOSS_HALF_WIDTH + PLAYER_RADIUS
          const ry = BOSS_HALF_HEIGHT + PLAYER_RADIUS
          if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) < 1) {
            hit = true
          }
        }
        if (hit) {
          if (playerStats.shieldEnabled && shieldCooldownRef.current <= 0) {
            shieldCooldownRef.current = playerStats.shieldMaxCooldown
            addPlayerHit(px, py)
            addShake(0.18, 0.2)
            playHit()
            invulnRef.current = 0.4
          } else {
            addPlayerHit(px, py)
            addShake(0.45, 0.4)
            playDamage()
            state.loseLife()
            invulnRef.current = 1.5
          }
        }
      }

      updateBoss(boss, dt, elapsedRef.current, bullets)

      flushFrameUpdates(state)
    }

    updateEffects(dt)

    const blink = invulnRef.current > 0 && Math.floor(invulnRef.current * 12) % 2 === 0

    if (playerRef.current) {
      playerRef.current.position.x = playerXRef.current
      playerRef.current.position.y = PLAYER_Y
    }
    if (playerBodyMatRef.current) {
      const mat = playerBodyMatRef.current
      if (blink) {
        mat.color.copy(PLAYER_COLOR_HIT)
        mat.emissive.copy(PLAYER_EMISSIVE_HIT)
        mat.emissiveIntensity = 1
      } else {
        mat.color.copy(PLAYER_COLOR_NORMAL)
        mat.emissive.copy(PLAYER_EMISSIVE_NORMAL)
        mat.emissiveIntensity = 0.5
      }
    }
    if (shieldMeshRef.current) {
      shieldMeshRef.current.visible =
        playerStats.shieldEnabled && shieldCooldownRef.current <= 0
    }

    const bossMesh = bossMeshRef.current
    if (bossMesh) {
      const boss = bossRef.current
      const visible =
        boss.phase === 'enter' || boss.phase === 'fight' || boss.phase === 'dying'
      bossMesh.visible = visible
      if (visible) {
        bossMesh.position.set(boss.x, boss.y, 0)
        bossMesh.scale.set(BOSS_HALF_WIDTH, BOSS_HALF_HEIGHT, 1)
        if (bossMatRef.current && boss.phase === 'dying') {
          const flicker = Math.floor(boss.timer * 22) % 2 === 0
          bossMatRef.current.color.set(flicker ? '#ffffff' : '#ff2244')
        } else if (bossMatRef.current) {
          bossMatRef.current.color.set('#ff2244')
        }
      }
    }

    const star = starMeshRef.current
    if (star) {
      for (let i = 0; i < STAR_COUNT; i++) {
        const s = stars[i]
        s.y -= dt * 1.2
        if (s.y < FIELD_BOTTOM - 1) {
          s.y = FIELD_TOP + 1
          s.x = (Math.random() * 2 - 1) * FIELD_HALF_WIDTH * 1.3
        }
        tempObj.position.set(s.x, s.y, -2)
        tempObj.rotation.set(0, 0, 0)
        tempObj.scale.setScalar(s.size)
        tempObj.updateMatrix()
        star.setMatrixAt(i, tempObj.matrix)
      }
      star.instanceMatrix.needsUpdate = true
    }

    const ghostMesh = ghostMeshRef.current
    if (ghostMesh) {
      for (let i = 0; i < ghosts.length; i++) {
        const g = ghosts[i]
        if (g.active) {
          const fade = g.age < GHOST_LIFETIME - 0.6 ? 1 : Math.max(0, (GHOST_LIFETIME - g.age) / 0.6)
          const pulse = 0.85 + 0.15 * Math.sin(g.age * 9)
          tempObj.position.set(g.x, g.y, 0.05)
          tempObj.rotation.set(0, 0, g.age * 2)
          tempObj.scale.setScalar(pulse * (0.7 + 0.3 * fade))
          tempObj.updateMatrix()
          ghostMesh.setMatrixAt(i, tempObj.matrix)
          const k = 0.55 + 0.45 * fade
          tempColor.setRGB(0.85 * k, 0.95 * k, 1.0 * k)
          ghostMesh.setColorAt(i, tempColor)
        } else {
          ghostMesh.setMatrixAt(i, HIDDEN_MATRIX)
        }
      }
      ghostMesh.instanceMatrix.needsUpdate = true
      if (ghostMesh.instanceColor) ghostMesh.instanceColor.needsUpdate = true
    }

    const droneMesh = droneMeshRef.current
    if (droneMesh) {
      for (let i = 0; i < drones.length; i++) {
        const d = drones[i]
        if (d.active) {
          tempObj.position.set(d.x, d.y, 0)
          tempObj.rotation.set(0, 0, 0)
          tempObj.scale.setScalar(0.55)
          tempObj.updateMatrix()
          droneMesh.setMatrixAt(i, tempObj.matrix)
        } else {
          droneMesh.setMatrixAt(i, HIDDEN_MATRIX)
        }
      }
      droneMesh.instanceMatrix.needsUpdate = true
    }

    const bulletsMesh = bulletsMeshRef.current
    if (bulletsMesh) {
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i]
        if (b.active) {
          tempObj.position.set(b.x, b.y, b.fromPlayer ? 0 : 0.6)
          tempObj.rotation.set(0, 0, 0)
          tempObj.scale.setScalar(b.radius / BULLET_RADIUS)
          tempObj.updateMatrix()
          bulletsMesh.setMatrixAt(i, tempObj.matrix)
          bulletsMesh.setColorAt(
            i,
            b.empowered
              ? COLOR_BULLET_EMPOWERED
              : b.fromPlayer
                ? COLOR_BULLET_PLAYER
                : COLOR_BULLET_ENEMY,
          )
        } else {
          bulletsMesh.setMatrixAt(i, HIDDEN_MATRIX)
        }
      }
      bulletsMesh.instanceMatrix.needsUpdate = true
      if (bulletsMesh.instanceColor) bulletsMesh.instanceColor.needsUpdate = true
    }

    const missilesMesh = missilesMeshRef.current
    if (missilesMesh) {
      for (let i = 0; i < missiles.length; i++) {
        const m = missiles[i]
        if (m.active) {
          tempObj.position.set(m.x, m.y, 0)
          tempObj.rotation.set(0, 0, m.rotation)
          tempObj.scale.setScalar(1)
          tempObj.updateMatrix()
          missilesMesh.setMatrixAt(i, tempObj.matrix)
          missilesMesh.setColorAt(i, m.mark ? COLOR_MISSILE_MARK : COLOR_MISSILE_NORMAL)
        } else {
          missilesMesh.setMatrixAt(i, HIDDEN_MATRIX)
        }
      }
      missilesMesh.instanceMatrix.needsUpdate = true
      if (missilesMesh.instanceColor) missilesMesh.instanceColor.needsUpdate = true
    }

    const empMesh = empMeshRef.current
    if (empMesh) {
      const radius = playerStats.empRadius
      for (let i = 0; i < emps.length; i++) {
        const emp = emps[i]
        if (emp.active && emp.phase === 'active') {
          const pulseScale = 1 + 0.07 * Math.sin(emp.age * 7)
          tempObj.position.set(emp.x, emp.y, 0.05)
          tempObj.rotation.set(0, 0, emp.age * 0.6)
          tempObj.scale.setScalar(radius * pulseScale)
          tempObj.updateMatrix()
          empMesh.setMatrixAt(i, tempObj.matrix)
          const tickPhase = 1 - emp.tickTimer / EMP_TICK_INTERVAL
          const tickPulse = 0.55 + 0.45 * Math.max(0, 1 - tickPhase)
          const breath = 0.75 + 0.35 * Math.sin(emp.age * 7)
          const fade = Math.min(1, emp.ageRemaining / 0.6)
          const k = tickPulse * breath * fade
          tempColor.setRGB(0.55 * k, 0.85 * k, 1.0 * k)
          empMesh.setColorAt(i, tempColor)
        } else {
          empMesh.setMatrixAt(i, HIDDEN_MATRIX)
        }
      }
      empMesh.instanceMatrix.needsUpdate = true
      if (empMesh.instanceColor) empMesh.instanceColor.needsUpdate = true
    }

    const empBallMesh = empBallMeshRef.current
    if (empBallMesh) {
      for (let i = 0; i < emps.length; i++) {
        const emp = emps[i]
        if (emp.active) {
          const flicker = 0.7 + 0.3 * Math.sin(emp.age * 40)
          let scale: number
          let spin: number
          if (emp.phase === 'flight') {
            scale = 0.32 + 0.06 * Math.sin(emp.age * 30)
            spin = emp.age * 8
          } else {
            const fade = Math.min(1, emp.ageRemaining / 0.6)
            scale = (0.42 + 0.08 * Math.sin(emp.age * 8)) * fade
            spin = emp.age * 4
          }
          tempObj.position.set(emp.x, emp.y, 0.05)
          tempObj.rotation.set(0, 0, spin)
          tempObj.scale.setScalar(scale)
          tempObj.updateMatrix()
          empBallMesh.setMatrixAt(i, tempObj.matrix)
          tempColor.setRGB(0.6 * flicker, 0.95 * flicker, 1.0 * flicker)
          empBallMesh.setColorAt(i, tempColor)
        } else {
          empBallMesh.setMatrixAt(i, HIDDEN_MATRIX)
        }
      }
      empBallMesh.instanceMatrix.needsUpdate = true
      if (empBallMesh.instanceColor) empBallMesh.instanceColor.needsUpdate = true
    }

    const diamondMesh = diamondMeshRef.current
    if (diamondMesh) {
      const t = elapsedRef.current
      for (let i = 0; i < diamonds.length; i++) {
        const d = diamonds[i]
        if (d.active) {
          const wobble = 1 + 0.07 * Math.sin(t * 9 + d.phase)
          tempObj.position.set(d.x, d.y, 0.05)
          tempObj.rotation.set(0, t * 5 + d.phase, 0)
          tempObj.scale.setScalar(DIAMOND_RADIUS * wobble)
          tempObj.updateMatrix()
          diamondMesh.setMatrixAt(i, tempObj.matrix)
          const sparkPhase = (t * 0.7 + d.phase * 0.16) - Math.floor(t * 0.7 + d.phase * 0.16)
          const flash = sparkPhase < 0.07 ? 1.7 : 0.85
          tempColor.setRGB(flash, flash, flash)
          diamondMesh.setColorAt(i, tempColor)
        } else {
          diamondMesh.setMatrixAt(i, HIDDEN_MATRIX)
        }
      }
      diamondMesh.instanceMatrix.needsUpdate = true
      if (diamondMesh.instanceColor) diamondMesh.instanceColor.needsUpdate = true
    }

    writeEnemyMatrices(basicMeshRef.current, enemiesBasic, Math.PI)
    writeEnemyMatrices(shooterMeshRef.current, enemiesShooter, 0)
    writeEnemyMatrices(zigzagMeshRef.current, enemiesZigzag, 0)
    writeCockpitMatrices(cockpitMeshRef.current, enemiesShooter)

    const sparkMesh = sparkMeshRef.current
    const puffMesh = puffMeshRef.current
    const ringMesh = ringMeshRef.current
    let sparkIdx = 0
    let puffIdx = 0
    let ringIdx = 0
    const particles = getParticles()
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      if (!p.active) continue
      const t = Math.max(0, p.life / p.maxLife)
      if (p.shape === 2 || p.shape === 3) {
        if (ringMesh && ringIdx < MAX_RINGS) {
          const r = p.shape === 3 ? p.size : 0.2 + (p.size - 0.2) * (1 - t)
          tempObj.position.set(p.x, p.y, 0.1)
          tempObj.rotation.set(0, 0, 0)
          tempObj.scale.setScalar(r)
          tempObj.updateMatrix()
          ringMesh.setMatrixAt(ringIdx, tempObj.matrix)
          tempColor.setRGB(p.r * t, p.g * t, p.b * t)
          ringMesh.setColorAt(ringIdx, tempColor)
          ringIdx++
        }
      } else if (p.shape === 1) {
        if (puffMesh && puffIdx < MAX_PARTICLES) {
          const s = p.size * (1 + (1 - t) * 0.8)
          tempObj.position.set(p.x, p.y, 0.05)
          tempObj.rotation.set(0, 0, 0)
          tempObj.scale.setScalar(s)
          tempObj.updateMatrix()
          puffMesh.setMatrixAt(puffIdx, tempObj.matrix)
          const a = t * 0.7
          tempColor.setRGB(p.r * a, p.g * a, p.b * a)
          puffMesh.setColorAt(puffIdx, tempColor)
          puffIdx++
        }
      } else {
        if (sparkMesh && sparkIdx < MAX_PARTICLES) {
          const s = p.size * (0.4 + 0.6 * t)
          tempObj.position.set(p.x, p.y, 0.05)
          tempObj.rotation.set(0, 0, 0)
          tempObj.scale.setScalar(s)
          tempObj.updateMatrix()
          sparkMesh.setMatrixAt(sparkIdx, tempObj.matrix)
          const a = Math.min(1, t * 1.4)
          tempColor.setRGB(p.r * a, p.g * a, p.b * a)
          sparkMesh.setColorAt(sparkIdx, tempColor)
          sparkIdx++
        }
      }
    }
    hideRest(sparkMesh, sparkIdx, prevSparkUsedRef.current)
    hideRest(puffMesh, puffIdx, prevPuffUsedRef.current)
    hideRest(ringMesh, ringIdx, prevRingUsedRef.current)
    prevSparkUsedRef.current = sparkIdx
    prevPuffUsedRef.current = puffIdx
    prevRingUsedRef.current = ringIdx

    if (started) {
      const [sx, sy] = getShake()
      camera.position.x = sx
      camera.position.y = sy
    } else {
      camera.position.x = 0
      camera.position.y = 0
    }
  })

  return (
    <>
      <instancedMesh ref={starMeshRef} args={[undefined, undefined, STAR_COUNT]}>
        <sphereGeometry args={[1, 4, 4]} />
        <meshBasicMaterial color="#ffffff" />
      </instancedMesh>

      <mesh ref={bossMeshRef} visible={false} renderOrder={1}>
        <circleGeometry args={[1, 64]} />
        <meshBasicMaterial ref={bossMatRef} color="#ff2244" />
      </mesh>

      <group ref={playerRef}>
        <mesh>
          <coneGeometry args={[0.5, 1.2, 4]} />
          <meshStandardMaterial
            ref={playerBodyMatRef}
            color={PLAYER_COLOR_NORMAL}
            emissive={PLAYER_EMISSIVE_NORMAL}
            emissiveIntensity={0.5}
          />
        </mesh>
        <mesh position={[0, -0.2, 0]}>
          <boxGeometry args={[1.4, 0.2, 0.4]} />
          <meshStandardMaterial color="#1188cc" emissive="#0a4466" emissiveIntensity={0.4} />
        </mesh>
        <mesh position={[0, -0.7, 0]}>
          <sphereGeometry args={[0.2, 8, 8]} />
          <meshBasicMaterial color="#ffdd33" />
        </mesh>
        <pointLight position={[0, 0, 1]} intensity={1.2} distance={4} color="#33ddff" />
        <mesh ref={shieldMeshRef} visible={false} renderOrder={2}>
          <ringGeometry args={[0.85, 1.05, 36]} />
          <meshBasicMaterial color="#88e8ff" transparent depthWrite={false} blending={AdditiveBlending} />
        </mesh>
      </group>

      <instancedMesh ref={droneMeshRef} args={[undefined, undefined, MAX_DRONES]}>
        <coneGeometry args={[0.4, 0.9, 4]} />
        <meshStandardMaterial color="#88ccff" emissive="#225588" emissiveIntensity={0.5} />
      </instancedMesh>

      <instancedMesh ref={ghostMeshRef} args={[undefined, undefined, MAX_GHOSTS]}>
        <sphereGeometry args={[GHOST_RADIUS, 12, 8]} />
        <meshBasicMaterial transparent depthWrite={false} blending={AdditiveBlending} />
      </instancedMesh>

      <instancedMesh ref={bulletsMeshRef} args={[undefined, undefined, MAX_BULLETS]}>
        <sphereGeometry args={[BULLET_RADIUS, 8, 8]} />
        <meshBasicMaterial />
      </instancedMesh>

      <instancedMesh ref={missilesMeshRef} args={[undefined, undefined, MAX_MISSILES]}>
        <coneGeometry args={[0.18, 0.6, 6]} />
        <meshBasicMaterial />
      </instancedMesh>

      <instancedMesh ref={empMeshRef} args={[undefined, undefined, MAX_EMPS]}>
        <ringGeometry args={[0.9, 1.0, 48]} />
        <meshBasicMaterial transparent depthWrite={false} blending={AdditiveBlending} side={DoubleSide} />
      </instancedMesh>

      <instancedMesh ref={empBallMeshRef} args={[undefined, undefined, MAX_EMPS]}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial transparent depthWrite={false} blending={AdditiveBlending} />
      </instancedMesh>

      <instancedMesh ref={diamondMeshRef} args={[undefined, undefined, MAX_DIAMONDS]}>
        <octahedronGeometry args={[1, 0]} />
        <meshPhongMaterial
          color="#aae0ff"
          emissive="#1a4a88"
          emissiveIntensity={0.6}
          shininess={220}
          specular="#ffffff"
        />
      </instancedMesh>

      <instancedMesh ref={basicMeshRef} args={[undefined, undefined, MAX_ENEMIES_PER_TYPE]}>
        <coneGeometry args={[0.5, 0.9, 3]} />
        <meshBasicMaterial color={COLOR_ENEMY_BASIC_HEX} />
      </instancedMesh>

      <instancedMesh ref={shooterMeshRef} args={[undefined, undefined, MAX_ENEMIES_PER_TYPE]}>
        <boxGeometry args={[0.9, 0.9, 0.5]} />
        <meshBasicMaterial color={COLOR_ENEMY_SHOOTER_HEX} />
      </instancedMesh>

      <instancedMesh ref={cockpitMeshRef} args={[undefined, undefined, MAX_ENEMIES_PER_TYPE]}>
        <boxGeometry args={[0.3, 0.4, 0.3]} />
        <meshBasicMaterial color="#552200" />
      </instancedMesh>

      <instancedMesh ref={zigzagMeshRef} args={[undefined, undefined, MAX_ENEMIES_PER_TYPE]}>
        <octahedronGeometry args={[0.55, 0]} />
        <meshBasicMaterial color={COLOR_ENEMY_ZIGZAG_HEX} />
      </instancedMesh>

      <instancedMesh ref={sparkMeshRef} args={[undefined, undefined, MAX_PARTICLES]}>
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial transparent depthWrite={false} blending={AdditiveBlending} />
      </instancedMesh>

      <instancedMesh ref={puffMeshRef} args={[undefined, undefined, MAX_PARTICLES]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial transparent depthWrite={false} blending={AdditiveBlending} />
      </instancedMesh>

      <instancedMesh ref={ringMeshRef} args={[undefined, undefined, MAX_RINGS]}>
        <ringGeometry args={[0.92, 1.0, 24]} />
        <meshBasicMaterial transparent depthWrite={false} blending={AdditiveBlending} side={DoubleSide} />
      </instancedMesh>
    </>
  )
}

function fireSalvo(bullets: Bullet[], playerX: number, shotIndex: number) {
  const bx = playerX
  const by = PLAYER_Y + 0.7
  const count = playerStats.bulletCount
  const baseAngle = Math.PI / 2
  const spreadStep = 0.18
  const totalSpread = (count - 1) * spreadStep
  const startAngle = baseAngle - totalSpread / 2
  const baseRadius = BULLET_RADIUS * playerStats.bulletRadiusMul
  const empoweredEvery = playerStats.empoweredEvery
  const empowered = empoweredEvery > 0 && shotIndex % empoweredEvery === 0
  const damage = playerStats.bulletDamage * (empowered ? 2 : 1)
  const radius = baseRadius * (empowered ? 2 : 1)
  for (let k = 0; k < count; k++) {
    const a = count === 1 ? baseAngle : startAngle + spreadStep * k
    const b = findInactiveBullet(bullets)
    if (!b) break
    b.active = true
    b.x = bx
    b.y = by
    const bulletSpeed = BULLET_SPEED_PLAYER * playerStats.bulletSpeedMul
    b.vx = Math.cos(a) * bulletSpeed
    b.vy = Math.sin(a) * bulletSpeed
    b.fromPlayer = true
    b.empowered = empowered
    b.damage = damage
    b.pen = playerStats.penetration
    b.radius = radius
    b.hitCount = 0
  }
  addMuzzleFlash(bx, by)
  playShoot()
}

function updateDrones(drones: Drone[], dt: number, playerX: number) {
  const droneCount = playerStats.droneCount
  const followK = Math.min(1, dt * DRONE_FOLLOW_RATE)
  let leaderX = playerX
  let leaderY = PLAYER_Y
  for (let i = 0; i < drones.length; i++) {
    const d = drones[i]
    if (i < droneCount) {
      const targetY = leaderY - DRONE_SPACING
      if (!d.active) {
        d.x = leaderX
        d.y = targetY
        d.active = true
      } else {
        d.x += (leaderX - d.x) * followK
        d.y += (targetY - d.y) * followK
      }
      leaderX = d.x
      leaderY = d.y
    } else if (d.active) {
      d.active = false
    }
  }
}

function fireDroneShots(bullets: Bullet[], drones: Drone[]) {
  const speed = BULLET_SPEED_PLAYER * playerStats.bulletSpeedMul
  const radius = BULLET_RADIUS * playerStats.bulletRadiusMul
  const damage = playerStats.bulletDamage
  for (let i = 0; i < drones.length; i++) {
    const d = drones[i]
    if (!d.active) continue
    const b = findInactiveBullet(bullets)
    if (!b) return
    b.active = true
    b.x = d.x
    b.y = d.y + 0.3
    b.vx = 0
    b.vy = speed
    b.fromPlayer = true
    b.empowered = false
    b.damage = damage
    b.pen = playerStats.penetration
    b.radius = radius
    b.hitCount = 0
  }
}

function spawnEmp(emps: EmpState[], playerX: number) {
  const e = findInactiveEmp(emps)
  if (!e) return
  e.active = true
  e.phase = 'flight'
  e.x = playerX
  e.y = PLAYER_Y + 0.6
  e.vy = EMP_FLIGHT_SPEED
  e.ageRemaining = 0
  e.age = 0
  e.tickTimer = 0
  playSpawn()
}

function updateEmps(
  emps: EmpState[],
  dt: number,
  allPools: Enemy[][],
  boss: BossState,
  diamonds: Diamond[],
) {
  const radius = playerStats.empRadius
  const radiusSq = radius * radius
  const dmg = playerStats.empTickDamage
  for (let i = 0; i < emps.length; i++) {
    const emp = emps[i]
    if (!emp.active) continue
    emp.age += dt

    if (emp.phase === 'flight') {
      emp.y += emp.vy * dt
      addEmpTrail(emp.x, emp.y)
      if (emp.y >= EMP_TARGET_Y) {
        emp.y = EMP_TARGET_Y
        emp.vy = 0
        emp.phase = 'active'
        emp.ageRemaining = playerStats.empDuration
        emp.tickTimer = 0
        addChainRing(emp.x, emp.y, radius, '#88ccff')
        addHitSparks(emp.x, emp.y, '#88ccff')
        addShake(0.12, 0.18)
      }
      continue
    }

    emp.ageRemaining -= dt
    if (emp.ageRemaining <= 0) {
      emp.active = false
      addChainRing(emp.x, emp.y, radius, '#88ccff')
      continue
    }
    emp.tickTimer -= dt
    if (emp.tickTimer <= 0) {
      emp.tickTimer = EMP_TICK_INTERVAL
      playEmpTick()
      for (const pool of allPools) {
        for (let j = 0; j < pool.length; j++) {
          const e = pool[j]
          if (!e.active) continue
          const dx = e.x - emp.x
          const dy = e.y - emp.y
          if (dx * dx + dy * dy >= radiusSq) continue
          const wasMarked = e.marked
          e.hp -= dmg
          if (
            playerStats.instaKillChance > 0 &&
            Math.random() < playerStats.instaKillChance
          ) {
            e.hp = 0
          }
          const color = colorHexFor(e.type)
          if (e.hp <= 0) {
            onEnemyKilled(e, color, diamonds)
            if (Math.random() < playerStats.chainExplodeChance) {
              chainExplode(e.x, e.y, allPools, boss, diamonds)
            }
          } else {
            addHitSparks(e.x, e.y, '#88ccff')
          }
          if (wasMarked) {
            spreadMarkDamage(e, dmg, allPools, boss, diamonds)
          }
        }
      }
      if (bossIsTargetable(boss)) {
        const dx = boss.x - emp.x
        const dy = boss.y - emp.y
        if (dx * dx + dy * dy < radiusSq) {
          applyBossDamage(boss, dmg, boss.x, boss.y)
        }
      }
    }
  }
}

function updateDiamonds(diamonds: Diamond[], dt: number, playerX: number, playerY: number) {
  const magnetRadius = playerStats.magnetRadius
  const magnetRadiusSq = magnetRadius * magnetRadius
  const collectThresholdSq = DIAMOND_COLLECT_THRESHOLD * DIAMOND_COLLECT_THRESHOLD
  for (let i = 0; i < diamonds.length; i++) {
    const d = diamonds[i]
    if (!d.active) continue

    const dx = playerX - d.x
    const dy = playerY - d.y
    const distSq = dx * dx + dy * dy

    if (distSq < collectThresholdSq) {
      d.active = false
      pushXp(d.value)
      addHitSparks(d.x, d.y, '#88ccff')
      playPickup()
      continue
    }

    if (distSq < magnetRadiusSq) {
      const dist = Math.sqrt(distSq) || 1
      d.vx = (dx / dist) * DIAMOND_MAGNET_SPEED
      d.vy = (dy / dist) * DIAMOND_MAGNET_SPEED
    } else {
      // gravity-like drift
      d.vx *= 0.95
      d.vy = Math.max(DIAMOND_DRIFT_VY, d.vy - 4 * dt)
    }

    d.x += d.vx * dt
    d.y += d.vy * dt

    if (
      d.y < FIELD_BOTTOM - 1 ||
      d.x < -FIELD_HALF_WIDTH - 3 ||
      d.x > FIELD_HALF_WIDTH + 3
    ) {
      d.active = false
    }
  }
}

function spawnMissileSalvo(missiles: Missile[], playerX: number) {
  const count = playerStats.homingSalvoCount
  for (let k = 0; k < count; k++) {
    const m = findInactiveMissile(missiles)
    if (!m) return
    const t = count > 1 ? k / (count - 1) - 0.5 : 0
    const angle = Math.random() * Math.PI * 2
    const speed = MISSILE_TUMBLE_SPEED * (0.7 + Math.random() * 0.6)
    m.active = true
    m.x = playerX + t * 0.6
    m.y = PLAYER_Y + 0.8
    m.vx = Math.cos(angle) * speed
    m.vy = Math.sin(angle) * speed
    m.age = 0
    m.armTimer = MISSILE_ARM_DELAY_MIN + Math.random() * (MISSILE_ARM_DELAY_MAX - MISSILE_ARM_DELAY_MIN)
    m.rotation = Math.random() * Math.PI * 2
    m.angularVelocity = (Math.random() < 0.5 ? -1 : 1) * MISSILE_TUMBLE_SPIN * (0.6 + Math.random() * 0.6)
    m.mark = false
  }
}

function spawnMarkMissile(missiles: Missile[], playerX: number) {
  const m = findInactiveMissile(missiles)
  if (!m) return
  const angle = Math.random() * Math.PI * 2
  const speed = MISSILE_TUMBLE_SPEED * (0.7 + Math.random() * 0.6)
  m.active = true
  m.x = playerX
  m.y = PLAYER_Y + 0.8
  m.vx = Math.cos(angle) * speed
  m.vy = Math.sin(angle) * speed
  m.age = 0
  m.armTimer = MISSILE_ARM_DELAY_MIN + Math.random() * (MISSILE_ARM_DELAY_MAX - MISSILE_ARM_DELAY_MIN)
  m.rotation = Math.random() * Math.PI * 2
  m.angularVelocity = (Math.random() < 0.5 ? -1 : 1) * MISSILE_TUMBLE_SPIN * (0.6 + Math.random() * 0.6)
  m.mark = true
}

function updateEnemyPool(pool: Enemy[], dt: number, bullets: Bullet[]) {
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i]
    if (!e.active) continue
    e.age += dt
    if (e.slowTimer > 0) {
      e.slowTimer -= dt
      if (e.slowTimer < 0) e.slowTimer = 0
    }
    const slowMul = e.slowTimer > 0 ? SLOW_FACTOR : 1
    e.y += (e.vy * slowMul + e.knockbackVy) * dt
    if (e.knockbackVy > 0) {
      e.knockbackVy *= Math.max(0, 1 - KNOCKBACK_DAMP * dt)
      if (e.knockbackVy < 0.05) e.knockbackVy = 0
    }
    if (e.type === 2) {
      e.x = e.baseX + Math.sin(e.age * e.swayFrequency * Math.PI) * e.swayAmplitude
    }
    if (e.type === 1) {
      e.fireTimer -= dt
      if (e.fireTimer <= 0 && e.y < FIELD_TOP - 1) {
        e.fireTimer = 1.4 + Math.random() * 0.8
        const b = findInactiveBullet(bullets)
        if (b) {
          b.active = true
          b.x = e.x
          b.y = e.y - 0.6
          b.vx = 0
          b.vy = -BULLET_SPEED_ENEMY
          b.fromPlayer = false
          b.empowered = false
          b.damage = 1
          b.pen = 0
          b.radius = BULLET_RADIUS
          b.hitCount = 0
        }
      }
    }
    if (e.y < FIELD_BOTTOM - 1 || Math.abs(e.x) > FIELD_HALF_WIDTH + 3) {
      e.active = false
    }
  }
}

function damageEnemiesInRange(
  b: Bullet,
  pool: Enemy[],
  budget: number,
  allPools: Enemy[][],
  boss: BossState,
  diamonds: Diamond[],
): number {
  let remaining = budget
  for (let j = 0; j < pool.length; j++) {
    if (remaining <= 0) break
    const e = pool[j]
    if (!e.active) continue
    if (bulletHasHit(b, e.gen)) continue
    const dx = b.x - e.x
    const dy = b.y - e.y
    const enemyR = e.elite ? ENEMY_RADIUS * ELITE_SCALE : ENEMY_RADIUS
    const r = b.radius + enemyR
    if (dx * dx + dy * dy >= r * r) continue
    recordHit(b, e.gen)
    const wasMarked = e.marked
    const damage = b.damage
    e.hp -= damage
    if (playerStats.instaKillChance > 0 && Math.random() < playerStats.instaKillChance) {
      e.hp = 0
    }
    if (b.fromPlayer) {
      if (playerStats.bulletKnockback > 0 && e.knockbackVy < playerStats.bulletKnockback) {
        e.knockbackVy = playerStats.bulletKnockback
      }
      if (playerStats.bulletSlowEnabled) {
        e.slowTimer = SLOW_DURATION
      }
    }
    const color = colorHexFor(e.type)
    if (e.hp <= 0) {
      onEnemyKilled(e, color, diamonds)
      if (Math.random() < playerStats.chainExplodeChance) {
        chainExplode(e.x, e.y, allPools, boss, diamonds)
      }
    } else {
      addHitSparks(b.x, b.y, color)
      addShake(0.05, 0.08)
      playHit()
    }
    if (wasMarked) {
      spreadMarkDamage(e, damage, allPools, boss, diamonds)
    }
    remaining -= 1
  }
  return remaining
}

function onEnemyKilled(e: Enemy, color: string, diamonds: Diamond[]) {
  pushScore(scoreFor(e.type))
  dropGems(diamonds, e)
  addExplosion(e.x, e.y, color)
  addShake(0.18, 0.22)
  playKill()
  e.active = false
  if (
    playerStats.healOnKillChance > 0 &&
    Math.random() < playerStats.healOnKillChance
  ) {
    pushHeal(1)
  }
  if (playerStats.necromancyEnabled) {
    spawnGhost(e.x, e.y, playerStats.bulletDamage)
  }
}

function bossIsTargetable(boss: BossState): boolean {
  return boss.phase === 'enter' || boss.phase === 'fight'
}

function bulletHitsBoss(b: Bullet, boss: BossState): boolean {
  const dx = b.x - boss.x
  const dy = b.y - boss.y
  const rx = BOSS_HALF_WIDTH + b.radius
  const ry = BOSS_HALF_HEIGHT + b.radius
  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) < 1
}

function applyBossDamage(boss: BossState, dmg: number, sx: number, sy: number) {
  if (boss.phase !== 'enter' && boss.phase !== 'fight') return
  boss.hp -= dmg
  if (
    playerStats.instaKillChance > 0 &&
    Math.random() < playerStats.instaKillChance * 0.002
  ) {
    boss.hp = 0
  }
  if (boss.hp <= 0) {
    onBossKilled(boss)
  } else {
    addHitSparks(sx, sy, '#ff5544')
    addShake(0.06, 0.08)
    playHit()
    pushBossHp(Math.max(0, boss.hp), boss.maxHp)
  }
}

function onBossKilled(boss: BossState) {
  if (boss.phase === 'dying') return
  boss.phase = 'dying'
  boss.timer = BOSS_DYING_DURATION
  boss.deathExplosionTimer = 0
  boss.deathExplosionCount = 0
  boss.fireTimer = 0
  boss.killCount += 1
  boss.upgradeGranted = false
  pushScore(BOSS_SCORE)
  pushXp(BOSS_XP)
  const store = useGameStore.getState()
  store.setBossWarning(false)
  store.setBossHp(0, 0)
  addShake(0.6, 0.5)
}

function fireBossBullet(boss: BossState, bullets: Bullet[]) {
  const b = findInactiveBullet(bullets)
  if (!b) return
  const angle = -Math.PI / 2 + (Math.random() * 2 - 1) * BOSS_FIRE_HALF_ARC
  b.active = true
  b.x = boss.x
  b.y = boss.y - BOSS_HALF_HEIGHT * 0.7
  b.vx = Math.cos(angle) * BOSS_BULLET_SPEED
  b.vy = Math.sin(angle) * BOSS_BULLET_SPEED
  b.fromPlayer = false
  b.empowered = false
  b.damage = 1
  b.pen = 0
  b.radius = BULLET_RADIUS * 1.4
  b.hitCount = 0
}

function updateBoss(boss: BossState, dt: number, elapsed: number, bullets: Bullet[]) {
  if (boss.phase === 'idle') {
    boss.timer -= dt
    publishBossProgress(1 - boss.timer / BOSS_INTERVAL)
    if (boss.timer <= 0) {
      boss.phase = 'warning'
      boss.timer = BOSS_WARNING_DURATION
      publishBossProgress(1)
      useGameStore.getState().setBossWarning(true)
    }
    return
  }
  if (boss.phase === 'warning') {
    boss.timer -= dt
    if (boss.timer <= 0) {
      boss.phase = 'enter'
      boss.x = 0
      boss.y = FIELD_TOP + 2
      boss.swayPhase = 0
      boss.gen = newGen()
      const basicHp = Math.ceil(1 * Math.pow(2, elapsed / 60))
      boss.maxHp = basicHp * BOSS_HP_MUL
      boss.hp = boss.maxHp
      boss.fireTimer = 1.5
      const store = useGameStore.getState()
      store.setBossWarning(false)
      store.setBossHp(boss.hp, boss.maxHp)
    }
    return
  }
  if (boss.phase === 'enter') {
    boss.y -= BOSS_ENTER_SPEED * dt
    if (boss.y <= BOSS_TARGET_Y) {
      boss.y = BOSS_TARGET_Y
      boss.phase = 'fight'
    }
    return
  }
  if (boss.phase === 'fight') {
    boss.swayPhase += dt * BOSS_SWAY_FREQ
    boss.x = Math.sin(boss.swayPhase) * BOSS_SWAY_AMP
    boss.fireTimer -= dt
    if (boss.fireTimer <= 0) {
      boss.fireTimer = BOSS_FIRE_INTERVAL
      fireBossBullet(boss, bullets)
    }
    return
  }
  if (boss.phase === 'dying') {
    boss.timer -= dt
    boss.deathExplosionTimer -= dt
    if (
      boss.deathExplosionTimer <= 0 &&
      boss.deathExplosionCount < BOSS_DEATH_EXPLOSIONS
    ) {
      boss.deathExplosionTimer = BOSS_DEATH_EXPLOSION_INTERVAL
      const ox = boss.x + (Math.random() - 0.5) * BOSS_HALF_WIDTH * 1.6
      const oy = boss.y + (Math.random() - 0.5) * BOSS_HALF_HEIGHT * 1.6
      addExplosion(ox, oy, '#ff5544')
      addShake(0.3, 0.3)
      playKill()
      boss.deathExplosionCount += 1
    }
    if (!boss.upgradeGranted && boss.timer <= BOSS_DYING_DURATION / 2) {
      boss.upgradeGranted = true
      useGameStore.getState().grantUpgrade()
    }
    if (boss.timer <= 0) {
      boss.phase = 'idle'
      boss.timer = BOSS_INTERVAL
      boss.hp = 0
      boss.maxHp = 0
      lastBossProgress = -1
      publishBossProgress(0)
    }
  }
}

function tryRamPlayer(pool: Enemy[], px: number, py: number): boolean {
  for (let j = 0; j < pool.length; j++) {
    const e = pool[j]
    if (!e.active) continue
    const dx = e.x - px
    const dy = e.y - py
    const enemyR = e.elite ? ENEMY_RADIUS * ELITE_SCALE : ENEMY_RADIUS
    const r = enemyR + PLAYER_RADIUS
    if (dx * dx + dy * dy < r * r) {
      addExplosion(e.x, e.y, colorHexFor(e.type))
      e.active = false
      return true
    }
  }
  return false
}

function chainExplode(
  x: number,
  y: number,
  allPools: Enemy[][],
  boss: BossState,
  diamonds: Diamond[],
) {
  const radius = playerStats.chainExplodeRadius
  if (radius <= 0) return
  const radiusSq = radius * radius
  for (const pool of allPools) {
    for (let i = 0; i < pool.length; i++) {
      const e = pool[i]
      if (!e.active) continue
      const dx = e.x - x
      const dy = e.y - y
      if (dx * dx + dy * dy < radiusSq) {
        const wasMarked = e.marked
        e.hp -= CHAIN_DAMAGE
        if (playerStats.instaKillChance > 0 && Math.random() < playerStats.instaKillChance) {
          e.hp = 0
        }
        const color = colorHexFor(e.type)
        if (e.hp <= 0) {
          pushScore(Math.floor(scoreFor(e.type) / 2))
          dropGems(diamonds, e)
          addExplosion(e.x, e.y, color)
          e.active = false
          if (
            playerStats.healOnKillChance > 0 &&
            Math.random() < playerStats.healOnKillChance
          ) {
            pushHeal(1)
          }
          if (playerStats.necromancyEnabled) {
            spawnGhost(e.x, e.y, playerStats.bulletDamage)
          }
        } else {
          addHitSparks(e.x, e.y, color)
        }
        if (wasMarked) {
          spreadMarkDamage(e, CHAIN_DAMAGE, allPools, boss, diamonds)
        }
      }
    }
  }
  if (bossIsTargetable(boss)) {
    const dx = boss.x - x
    const dy = boss.y - y
    if (dx * dx + dy * dy < radiusSq) {
      applyBossDamage(boss, CHAIN_DAMAGE, boss.x, boss.y)
    }
  }
  addChainRing(x, y, radius, '#ffaa00')
  addShake(0.2, 0.25)
}

function updateMissiles(
  missiles: Missile[],
  dt: number,
  allPools: Enemy[][],
  boss: BossState,
  diamonds: Diamond[],
) {
  for (let i = 0; i < missiles.length; i++) {
    const m = missiles[i]
    if (!m.active) continue
    m.age += dt

    if (m.armTimer > 0) {
      m.armTimer -= dt
      const k = Math.max(0, 1 - MISSILE_TUMBLE_DRAG * dt)
      m.vx *= k
      m.vy *= k
      m.angularVelocity *= k
      m.rotation += m.angularVelocity * dt
    } else {
      let bestX = 0
      let bestY = 0
      let bestDist = Infinity
      let found = false
      for (const pool of allPools) {
        for (let j = 0; j < pool.length; j++) {
          const e = pool[j]
          if (!e.active) continue
          const dx = e.x - m.x
          const dy = e.y - m.y
          const d = dx * dx + dy * dy
          if (d < bestDist) {
            bestDist = d
            bestX = e.x
            bestY = e.y
            found = true
          }
        }
      }
      if (bossIsTargetable(boss)) {
        const dx = boss.x - m.x
        const dy = boss.y - m.y
        const d = dx * dx + dy * dy
        if (d < bestDist) {
          bestDist = d
          bestX = boss.x
          bestY = boss.y
          found = true
        }
      }

      if (found) {
        const dx = bestX - m.x
        const dy = bestY - m.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        m.vx += (dx / d) * MISSILE_ACCEL * dt
        m.vy += (dy / d) * MISSILE_ACCEL * dt
        const speed = Math.sqrt(m.vx * m.vx + m.vy * m.vy)
        if (speed > MISSILE_MAX_SPEED) {
          m.vx *= MISSILE_MAX_SPEED / speed
          m.vy *= MISSILE_MAX_SPEED / speed
        }
      }
      m.rotation = Math.atan2(m.vy, m.vx) - Math.PI / 2
    }

    m.x += m.vx * dt
    m.y += m.vy * dt

    if (
      m.age > MISSILE_LIFETIME ||
      m.x < -FIELD_HALF_WIDTH - 3 ||
      m.x > FIELD_HALF_WIDTH + 3 ||
      m.y < FIELD_BOTTOM - 2 ||
      m.y > FIELD_TOP + 5
    ) {
      m.active = false
      continue
    }

    let hit = false
    for (const pool of allPools) {
      if (hit) break
      for (let j = 0; j < pool.length; j++) {
        const e = pool[j]
        if (!e.active) continue
        const dx = e.x - m.x
        const dy = e.y - m.y
        const enemyR = e.elite ? ENEMY_RADIUS * ELITE_SCALE : ENEMY_RADIUS
        const r = MISSILE_RADIUS + enemyR
        if (dx * dx + dy * dy < r * r) {
          if (m.mark) {
            e.marked = true
            addExplosion(m.x, m.y, '#aa44ff')
            addChainRing(e.x, e.y, ENEMY_RADIUS * 2, '#aa44ff')
            addShake(0.12, 0.18)
            playMissileHit()
            m.active = false
            hit = true
            break
          }
          const wasMarked = e.marked
          e.hp -= MISSILE_DAMAGE
          if (playerStats.instaKillChance > 0 && Math.random() < playerStats.instaKillChance) {
            e.hp = 0
          }
          const color = colorHexFor(e.type)
          if (e.hp <= 0) {
            onEnemyKilled(e, color, diamonds)
            if (Math.random() < playerStats.chainExplodeChance) {
              chainExplode(e.x, e.y, allPools, boss, diamonds)
            }
          } else {
            addHitSparks(e.x, e.y, color)
          }
          if (wasMarked) {
            spreadMarkDamage(e, MISSILE_DAMAGE, allPools, boss, diamonds)
          }
          addExplosion(m.x, m.y, '#ffcc44')
          addShake(0.15, 0.18)
          playMissileHit()
          m.active = false
          hit = true
          break
        }
      }
    }
    if (!hit && bossIsTargetable(boss)) {
      const dx = boss.x - m.x
      const dy = boss.y - m.y
      const rx = BOSS_HALF_WIDTH + MISSILE_RADIUS
      const ry = BOSS_HALF_HEIGHT + MISSILE_RADIUS
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) < 1) {
        if (m.mark) {
          // Mark missiles dud against the boss; no marking of bosses.
          addExplosion(m.x, m.y, '#aa44ff')
          addShake(0.1, 0.15)
          m.active = false
        } else {
          applyBossDamage(boss, MISSILE_DAMAGE, m.x, m.y)
          addExplosion(m.x, m.y, '#ffcc44')
          addShake(0.15, 0.18)
          playMissileHit()
          m.active = false
        }
      }
    }
  }
}

function updateGhosts(
  ghosts: Ghost[],
  dt: number,
  allPools: Enemy[][],
  boss: BossState,
  diamonds: Diamond[],
) {
  for (let i = 0; i < ghosts.length; i++) {
    const g = ghosts[i]
    if (!g.active) continue
    g.age += dt
    if (g.age >= GHOST_LIFETIME) {
      g.active = false
      continue
    }
    g.changeDirTimer -= dt
    if (g.changeDirTimer <= 0) {
      const angle = Math.random() * Math.PI * 2
      g.vx = Math.cos(angle) * GHOST_SPEED
      g.vy = Math.sin(angle) * GHOST_SPEED
      g.changeDirTimer =
        GHOST_DIR_CHANGE_MIN + Math.random() * (GHOST_DIR_CHANGE_MAX - GHOST_DIR_CHANGE_MIN)
    }
    g.x += g.vx * dt
    g.y += g.vy * dt
    if (g.x < -FIELD_HALF_WIDTH) {
      g.x = -FIELD_HALF_WIDTH
      g.vx = Math.abs(g.vx)
    } else if (g.x > FIELD_HALF_WIDTH) {
      g.x = FIELD_HALF_WIDTH
      g.vx = -Math.abs(g.vx)
    }
    if (g.y < FIELD_BOTTOM + 1) {
      g.y = FIELD_BOTTOM + 1
      g.vy = Math.abs(g.vy)
    } else if (g.y > FIELD_TOP - 1) {
      g.y = FIELD_TOP - 1
      g.vy = -Math.abs(g.vy)
    }
    for (const pool of allPools) {
      for (let j = 0; j < pool.length; j++) {
        const e = pool[j]
        if (!e.active) continue
        if (ghostHasHit(g, e.gen)) continue
        const dx = e.x - g.x
        const dy = e.y - g.y
        const enemyR = e.elite ? ENEMY_RADIUS * ELITE_SCALE : ENEMY_RADIUS
        const r = GHOST_RADIUS + enemyR
        if (dx * dx + dy * dy >= r * r) continue
        recordGhostHit(g, e.gen)
        const wasMarked = e.marked
        e.hp -= g.damage
        const color = colorHexFor(e.type)
        if (e.hp <= 0) {
          onEnemyKilled(e, color, diamonds)
        } else {
          addHitSparks(e.x, e.y, '#cceeff')
        }
        if (wasMarked) {
          spreadMarkDamage(e, g.damage, allPools, boss, diamonds)
        }
      }
    }
  }
}

function spreadMarkDamage(
  src: Enemy,
  dmg: number,
  allPools: Enemy[][],
  boss: BossState,
  diamonds: Diamond[],
) {
  for (const pool of allPools) {
    for (let i = 0; i < pool.length; i++) {
      const other = pool[i]
      if (!other.active || other === src) continue
      other.hp -= dmg
      const color = colorHexFor(other.type)
      if (other.hp <= 0) {
        onEnemyKilled(other, color, diamonds)
      } else {
        addHitSparks(other.x, other.y, '#aa44ff')
      }
    }
  }
  if (bossIsTargetable(boss)) {
    applyBossDamage(boss, dmg, boss.x, boss.y)
  }
}

function writeEnemyMatrices(mesh: InstancedMesh | null, pool: Enemy[], rotZ: number) {
  if (!mesh) return
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i]
    if (e.active) {
      const s = e.elite ? ELITE_SCALE : 1
      tempObj.position.set(e.x, e.y, 0)
      tempObj.rotation.set(0, 0, rotZ)
      tempObj.scale.setScalar(s)
      tempObj.updateMatrix()
      mesh.setMatrixAt(i, tempObj.matrix)
    } else {
      mesh.setMatrixAt(i, HIDDEN_MATRIX)
    }
  }
  mesh.instanceMatrix.needsUpdate = true
}

function writeCockpitMatrices(mesh: InstancedMesh | null, pool: Enemy[]) {
  if (!mesh) return
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i]
    if (e.active) {
      const s = e.elite ? ELITE_SCALE : 1
      tempObj.position.set(e.x, e.y - 0.5 * s, 0)
      tempObj.rotation.set(0, 0, 0)
      tempObj.scale.setScalar(s)
      tempObj.updateMatrix()
      mesh.setMatrixAt(i, tempObj.matrix)
    } else {
      mesh.setMatrixAt(i, HIDDEN_MATRIX)
    }
  }
  mesh.instanceMatrix.needsUpdate = true
}

function hideRest(mesh: InstancedMesh | null, used: number, prevUsed: number) {
  if (!mesh) return
  if (used >= prevUsed) {
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    return
  }
  for (let i = used; i < prevUsed; i++) {
    mesh.setMatrixAt(i, HIDDEN_MATRIX)
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

export const GameScene = memo(GameSceneInner)
