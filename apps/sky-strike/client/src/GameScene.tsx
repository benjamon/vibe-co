import { useFrame, useThree } from '@react-three/fiber'
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
} from 'three'
import { playerStats, useGameStore } from './store'
import { useInput, type InputState } from './useInput'
import { playDamage, playHit, playKill, playLevelUp, playShoot, playSpawn } from './audio'
import {
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

const CHAIN_RADIUS = 2.5
const CHAIN_RADIUS_SQ = CHAIN_RADIUS * CHAIN_RADIUS
const CHAIN_DAMAGE = 2

const MAX_BULLETS = 128
const MAX_MISSILES = 8
const MAX_ENEMIES_PER_TYPE = 24
const MAX_PARTICLES = 600
const MAX_RINGS = 32
const STAR_COUNT = 80

const LEVEL_UP_INPUT_LOCKOUT = 0.7

type EnemyType = 0 | 1 | 2

interface Bullet {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  fromPlayer: boolean
  damage: number
  pen: number
  radius: number
  hitCooldown: number
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
}

interface Missile {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  age: number
}

const COLOR_BULLET_PLAYER = new Color('#33ffaa')
const COLOR_BULLET_ENEMY = new Color('#ff3344')
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
  if (elapsed < 8) return r < 0.85 ? 0 : 2
  if (elapsed < 20) {
    if (r < 0.6) return 0
    if (r < 0.85) return 2
    return 1
  }
  if (r < 0.45) return 0
  if (r < 0.75) return 2
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
      damage: 1,
      pen: 0,
      radius: BULLET_RADIUS,
      hitCooldown: 0,
    })
  }
  return arr
}

function makeMissilePool(): Missile[] {
  const arr: Missile[] = []
  for (let i = 0; i < MAX_MISSILES; i++) {
    arr.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, age: 0 })
  }
  return arr
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
  const playerXRef = useRef(0)
  const fireTimerRef = useRef(0)
  const burstShotsRef = useRef(0)
  const burstTimerRef = useRef(0)
  const homingTimerRef = useRef(0)
  const spawnTimerRef = useRef(0.6)
  const elapsedRef = useRef(0)
  const invulnRef = useRef(0)
  const wasPausedRef = useRef(false)
  const pauseLockoutRef = useRef(0)
  const prevLeftRef = useRef(false)
  const prevRightRef = useRef(false)

  const bulletsMeshRef = useRef<InstancedMesh>(null)
  const missilesMeshRef = useRef<InstancedMesh>(null)
  const basicMeshRef = useRef<InstancedMesh>(null)
  const shooterMeshRef = useRef<InstancedMesh>(null)
  const cockpitMeshRef = useRef<InstancedMesh>(null)
  const zigzagMeshRef = useRef<InstancedMesh>(null)
  const sparkMeshRef = useRef<InstancedMesh>(null)
  const puffMeshRef = useRef<InstancedMesh>(null)
  const ringMeshRef = useRef<InstancedMesh>(null)
  const starMeshRef = useRef<InstancedMesh>(null)

  const bullets = useMemo(makeBulletPool, [])
  const missiles = useMemo(makeMissilePool, [])
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
      basicMeshRef.current,
      shooterMeshRef.current,
      cockpitMeshRef.current,
      zigzagMeshRef.current,
      sparkMeshRef.current,
      puffMeshRef.current,
      ringMeshRef.current,
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
      spawnTimerRef.current = 0.5
      elapsedRef.current = 0
      invulnRef.current = 1.2
      for (let i = 0; i < bullets.length; i++) bullets[i].active = false
      for (let i = 0; i < missiles.length; i++) missiles[i].active = false
      for (let i = 0; i < enemiesBasic.length; i++) enemiesBasic[i].active = false
      for (let i = 0; i < enemiesShooter.length; i++) enemiesShooter[i].active = false
      for (let i = 0; i < enemiesZigzag.length; i++) enemiesZigzag[i].active = false
      clearEffects()
    }
  }, [started, bullets, missiles, enemiesBasic, enemiesShooter, enemiesZigzag])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const state = useGameStore.getState()
    const paused = state.pendingLevelUps > 0

    if (paused) {
      const input = inputRef.current
      if (!wasPausedRef.current) {
        prevLeftRef.current = true
        prevRightRef.current = true
        wasPausedRef.current = true
        pauseLockoutRef.current = LEVEL_UP_INPUT_LOCKOUT
        playLevelUp()
      }
      if (pauseLockoutRef.current > 0) {
        pauseLockoutRef.current -= dt
        prevLeftRef.current = input.left
        prevRightRef.current = input.right
      } else {
        const leftEdge = !prevLeftRef.current && input.left
        const rightEdge = !prevRightRef.current && input.right
        prevLeftRef.current = input.left
        prevRightRef.current = input.right
        if (leftEdge) state.selectUpgrade(0)
        else if (rightEdge) state.selectUpgrade(1)
      }
      camera.position.x = 0
      camera.position.y = 0
      return
    }
    wasPausedRef.current = false
    pauseLockoutRef.current = 0
    prevLeftRef.current = inputRef.current.left
    prevRightRef.current = inputRef.current.right

    if (started) {
      elapsedRef.current += dt
      if (invulnRef.current > 0) invulnRef.current -= dt

      const input: InputState = inputRef.current
      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0)
      playerXRef.current += dir * PLAYER_SPEED * dt
      if (playerXRef.current < -FIELD_HALF_WIDTH + 0.5) playerXRef.current = -FIELD_HALF_WIDTH + 0.5
      if (playerXRef.current > FIELD_HALF_WIDTH - 0.5) playerXRef.current = FIELD_HALF_WIDTH - 0.5

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
          fireSalvo(bullets, playerXRef.current)
        }
      }

      if (playerStats.homingInterval > 0) {
        homingTimerRef.current -= dt
        if (homingTimerRef.current <= 0) {
          homingTimerRef.current = playerStats.homingInterval
          spawnMissile(missiles, playerXRef.current)
        }
      }

      spawnTimerRef.current -= dt
      if (spawnTimerRef.current <= 0) {
        spawnTimerRef.current = spawnInterval(elapsedRef.current)
        const type = pickEnemyType(elapsedRef.current)
        const pool = type === 0 ? enemiesBasic : type === 1 ? enemiesShooter : enemiesZigzag
        const e = findInactiveEnemy(pool)
        if (e) {
          const x = (Math.random() * 2 - 1) * (FIELD_HALF_WIDTH - 0.8)
          e.active = true
          e.type = type
          e.x = x
          e.y = FIELD_TOP + 1
          e.baseX = x
          e.age = 0
          e.fireTimer = 1 + Math.random() * 1.5
          e.swayAmplitude = 0
          e.swayFrequency = 0
          const hpScale = Math.pow(2, elapsedRef.current / 60)
          e.hp = Math.ceil(2 * hpScale)
          if (type === 0) {
            e.vy = -3 - Math.random() * 1.2
          } else if (type === 1) {
            e.vy = -1.8
            e.hp = Math.ceil(4 * hpScale)
          } else {
            e.vy = -2.2
            e.swayAmplitude = 2 + Math.random() * 1.5
            e.swayFrequency = 1 + Math.random() * 0.8
          }
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
        if (b.hitCooldown > 0) b.hitCooldown -= dt
        if (
          b.y > FIELD_TOP + 1 ||
          b.y < FIELD_BOTTOM - 1 ||
          b.x < -FIELD_HALF_WIDTH - 3 ||
          b.x > FIELD_HALF_WIDTH + 3
        ) {
          b.active = false
        }
      }

      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i]
        if (!b.active || !b.fromPlayer || b.hitCooldown > 0) continue
        if (
          tryHitEnemy(b, enemiesBasic, allEnemyPools) ||
          tryHitEnemy(b, enemiesShooter, allEnemyPools) ||
          tryHitEnemy(b, enemiesZigzag, allEnemyPools)
        ) {
          b.active = false
        }
      }

      updateMissiles(missiles, dt, allEnemyPools)

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
        if (hit) {
          addPlayerHit(px, py)
          addShake(0.45, 0.4)
          playDamage()
          state.loseLife()
          invulnRef.current = 1.5
        }
      }
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

    const bulletsMesh = bulletsMeshRef.current
    if (bulletsMesh) {
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i]
        if (b.active) {
          tempObj.position.set(b.x, b.y, 0)
          tempObj.rotation.set(0, 0, 0)
          tempObj.scale.setScalar(b.radius / BULLET_RADIUS)
          tempObj.updateMatrix()
          bulletsMesh.setMatrixAt(i, tempObj.matrix)
          bulletsMesh.setColorAt(i, b.fromPlayer ? COLOR_BULLET_PLAYER : COLOR_BULLET_ENEMY)
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
          const angle = Math.atan2(m.vy, m.vx) - Math.PI / 2
          tempObj.position.set(m.x, m.y, 0)
          tempObj.rotation.set(0, 0, angle)
          tempObj.scale.setScalar(1)
          tempObj.updateMatrix()
          missilesMesh.setMatrixAt(i, tempObj.matrix)
        } else {
          missilesMesh.setMatrixAt(i, HIDDEN_MATRIX)
        }
      }
      missilesMesh.instanceMatrix.needsUpdate = true
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
      if (p.shape === 2) {
        if (ringMesh && ringIdx < MAX_RINGS) {
          const r = (1 - t) * 1.6 + 0.2
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
    hideRest(sparkMesh, sparkIdx, MAX_PARTICLES)
    hideRest(puffMesh, puffIdx, MAX_PARTICLES)
    hideRest(ringMesh, ringIdx, MAX_RINGS)

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
      </group>

      <instancedMesh ref={bulletsMeshRef} args={[undefined, undefined, MAX_BULLETS]}>
        <sphereGeometry args={[BULLET_RADIUS, 8, 8]} />
        <meshBasicMaterial />
      </instancedMesh>

      <instancedMesh ref={missilesMeshRef} args={[undefined, undefined, MAX_MISSILES]}>
        <coneGeometry args={[0.18, 0.6, 6]} />
        <meshBasicMaterial color="#aaff44" />
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

function fireSalvo(bullets: Bullet[], playerX: number) {
  const bx = playerX
  const by = PLAYER_Y + 0.7
  const count = playerStats.bulletCount
  const baseAngle = Math.PI / 2
  const spreadStep = 0.18
  const totalSpread = (count - 1) * spreadStep
  const startAngle = baseAngle - totalSpread / 2
  const radius = BULLET_RADIUS * playerStats.bulletRadiusMul
  for (let k = 0; k < count; k++) {
    const a = count === 1 ? baseAngle : startAngle + spreadStep * k
    const b = findInactiveBullet(bullets)
    if (!b) break
    b.active = true
    b.x = bx
    b.y = by
    b.vx = Math.cos(a) * BULLET_SPEED_PLAYER
    b.vy = Math.sin(a) * BULLET_SPEED_PLAYER
    b.fromPlayer = true
    b.damage = playerStats.bulletDamage
    b.pen = playerStats.penetration
    b.radius = radius
    b.hitCooldown = 0
  }
  addMuzzleFlash(bx, by)
  playShoot()
}

function spawnMissile(missiles: Missile[], playerX: number) {
  const m = findInactiveMissile(missiles)
  if (!m) return
  m.active = true
  m.x = playerX
  m.y = PLAYER_Y + 0.8
  m.vx = (Math.random() - 0.5) * 4
  m.vy = 4
  m.age = 0
}

function updateEnemyPool(pool: Enemy[], dt: number, bullets: Bullet[]) {
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i]
    if (!e.active) continue
    e.age += dt
    e.y += e.vy * dt
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
          b.damage = 1
          b.pen = 0
          b.radius = BULLET_RADIUS
          b.hitCooldown = 0
        }
      }
    }
    if (e.y < FIELD_BOTTOM - 1 || Math.abs(e.x) > FIELD_HALF_WIDTH + 3) {
      e.active = false
    }
  }
}

function tryHitEnemy(b: Bullet, pool: Enemy[], allPools: Enemy[][]): boolean {
  for (let j = 0; j < pool.length; j++) {
    const e = pool[j]
    if (!e.active) continue
    const dx = b.x - e.x
    const dy = b.y - e.y
    const r = b.radius + ENEMY_RADIUS
    if (dx * dx + dy * dy < r * r) {
      e.hp -= b.damage
      const color = colorHexFor(e.type)
      const store = useGameStore.getState()
      if (e.hp <= 0) {
        store.addScore(scoreFor(e.type))
        store.addXp(xpFor(e.type))
        addExplosion(e.x, e.y, color)
        addShake(0.18, 0.22)
        playKill()
        e.active = false
        if (Math.random() < playerStats.chainExplodeChance) {
          chainExplode(e.x, e.y, allPools)
        }
      } else {
        addHitSparks(b.x, b.y, color)
        addShake(0.05, 0.08)
        playHit()
      }
      b.hitCooldown = 0.04
      if (b.pen > 0) {
        b.pen -= 1
        return false
      }
      return true
    }
  }
  return false
}

function tryRamPlayer(pool: Enemy[], px: number, py: number): boolean {
  for (let j = 0; j < pool.length; j++) {
    const e = pool[j]
    if (!e.active) continue
    const dx = e.x - px
    const dy = e.y - py
    const r = ENEMY_RADIUS + PLAYER_RADIUS
    if (dx * dx + dy * dy < r * r) {
      addExplosion(e.x, e.y, colorHexFor(e.type))
      e.active = false
      return true
    }
  }
  return false
}

function chainExplode(x: number, y: number, allPools: Enemy[][]) {
  const store = useGameStore.getState()
  for (const pool of allPools) {
    for (let i = 0; i < pool.length; i++) {
      const e = pool[i]
      if (!e.active) continue
      const dx = e.x - x
      const dy = e.y - y
      if (dx * dx + dy * dy < CHAIN_RADIUS_SQ) {
        e.hp -= CHAIN_DAMAGE
        const color = colorHexFor(e.type)
        if (e.hp <= 0) {
          store.addScore(Math.floor(scoreFor(e.type) / 2))
          store.addXp(xpFor(e.type))
          addExplosion(e.x, e.y, color)
          e.active = false
        } else {
          addHitSparks(e.x, e.y, color)
        }
      }
    }
  }
  addExplosion(x, y, '#ffaa00')
  addShake(0.2, 0.25)
}

function updateMissiles(missiles: Missile[], dt: number, allPools: Enemy[][]) {
  const store = useGameStore.getState()
  for (let i = 0; i < missiles.length; i++) {
    const m = missiles[i]
    if (!m.active) continue
    m.age += dt

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
        const r = MISSILE_RADIUS + ENEMY_RADIUS
        if (dx * dx + dy * dy < r * r) {
          e.hp -= MISSILE_DAMAGE
          const color = colorHexFor(e.type)
          if (e.hp <= 0) {
            store.addScore(scoreFor(e.type))
            store.addXp(xpFor(e.type))
            addExplosion(e.x, e.y, color)
            e.active = false
            if (Math.random() < playerStats.chainExplodeChance) {
              chainExplode(e.x, e.y, allPools)
            }
          } else {
            addHitSparks(e.x, e.y, color)
          }
          addExplosion(m.x, m.y, '#ffcc44')
          addShake(0.15, 0.18)
          playKill()
          m.active = false
          hit = true
          break
        }
      }
    }
  }
}

function writeEnemyMatrices(mesh: InstancedMesh | null, pool: Enemy[], rotZ: number) {
  if (!mesh) return
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i]
    if (e.active) {
      tempObj.position.set(e.x, e.y, 0)
      tempObj.rotation.set(0, 0, rotZ)
      tempObj.scale.setScalar(1)
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
      tempObj.position.set(e.x, e.y - 0.5, 0)
      tempObj.rotation.set(0, 0, 0)
      tempObj.scale.setScalar(1)
      tempObj.updateMatrix()
      mesh.setMatrixAt(i, tempObj.matrix)
    } else {
      mesh.setMatrixAt(i, HIDDEN_MATRIX)
    }
  }
  mesh.instanceMatrix.needsUpdate = true
}

function hideRest(mesh: InstancedMesh | null, used: number, max: number) {
  if (!mesh) return
  for (let i = used; i < max; i++) {
    mesh.setMatrixAt(i, HIDDEN_MATRIX)
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

export const GameScene = memo(GameSceneInner)
