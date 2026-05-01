import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Group } from 'three'
import { useGameStore } from './store'
import { useInput, type InputState } from './useInput'

const FIELD_HALF_WIDTH = 7
const FIELD_TOP = 10
const FIELD_BOTTOM = -10
const PLAYER_Y = -7
const PLAYER_SPEED = 9
const PLAYER_RADIUS = 0.55
const PLAYER_FIRE_INTERVAL = 0.12

const BULLET_SPEED_PLAYER = 16
const BULLET_SPEED_ENEMY = 7
const BULLET_RADIUS = 0.18

const ENEMY_RADIUS = 0.55

interface Bullet {
  id: number
  x: number
  y: number
  vy: number
  fromPlayer: boolean
}

type EnemyType = 'basic' | 'shooter' | 'zigzag'

interface Enemy {
  id: number
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
  rotation: number
}

let nextId = 1
const newId = () => nextId++

function pickEnemyType(elapsed: number): EnemyType {
  const r = Math.random()
  if (elapsed < 8) {
    if (r < 0.85) return 'basic'
    return 'zigzag'
  }
  if (elapsed < 20) {
    if (r < 0.6) return 'basic'
    if (r < 0.85) return 'zigzag'
    return 'shooter'
  }
  if (r < 0.45) return 'basic'
  if (r < 0.75) return 'zigzag'
  return 'shooter'
}

function spawnInterval(elapsed: number): number {
  return Math.max(0.35, 1.1 - elapsed * 0.025)
}

function makeEnemy(elapsed: number): Enemy {
  const type = pickEnemyType(elapsed)
  const x = (Math.random() * 2 - 1) * (FIELD_HALF_WIDTH - 0.8)
  const base: Enemy = {
    id: newId(),
    type,
    x,
    y: FIELD_TOP + 1,
    vy: -3,
    hp: 1,
    fireTimer: 1 + Math.random() * 1.5,
    age: 0,
    baseX: x,
    swayAmplitude: 0,
    swayFrequency: 0,
    rotation: 0,
  }
  if (type === 'basic') {
    base.vy = -3 - Math.random() * 1.2
  } else if (type === 'shooter') {
    base.vy = -1.8
    base.hp = 2
  } else {
    base.vy = -2.2
    base.swayAmplitude = 2 + Math.random() * 1.5
    base.swayFrequency = (1 + Math.random() * 0.8) * 0.25
  }
  return base
}

function colorForEnemy(type: EnemyType): string {
  if (type === 'basic') return '#ff5577'
  if (type === 'shooter') return '#ffaa33'
  return '#aa66ff'
}

function PlayerMesh({ x, hit }: { x: number; hit: boolean }) {
  return (
    <group position={[x, PLAYER_Y, 0]}>
      <mesh>
        <coneGeometry args={[0.5, 1.2, 4]} />
        <meshStandardMaterial
          color={hit ? '#ffffff' : '#33ddff'}
          emissive={hit ? '#ffffff' : '#1166aa'}
          emissiveIntensity={hit ? 1 : 0.5}
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
  )
}

function EnemyMesh({ enemy }: { enemy: Enemy }) {
  const color = colorForEnemy(enemy.type)
  return (
    <group position={[enemy.x, enemy.y, 0]}>
      {enemy.type === 'basic' && (
        <mesh rotation={[0, 0, Math.PI]}>
          <coneGeometry args={[0.5, 0.9, 3]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
        </mesh>
      )}
      {enemy.type === 'shooter' && (
        <>
          <mesh>
            <boxGeometry args={[0.9, 0.9, 0.5]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
          </mesh>
          <mesh position={[0, -0.5, 0]}>
            <boxGeometry args={[0.3, 0.4, 0.3]} />
            <meshStandardMaterial color="#552200" />
          </mesh>
        </>
      )}
      {enemy.type === 'zigzag' && (
        <group rotation={[0, 0, enemy.rotation]}>
          <mesh>
            <octahedronGeometry args={[0.55, 0]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
          </mesh>
          <mesh position={[0, -0.7, 0.05]}>
            <circleGeometry args={[0.18, 16]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        </group>
      )}
    </group>
  )
}

function BulletMesh({ bullet }: { bullet: Bullet }) {
  return (
    <mesh position={[bullet.x, bullet.y, 0]}>
      <sphereGeometry args={[BULLET_RADIUS, 8, 8]} />
      <meshBasicMaterial color={bullet.fromPlayer ? '#33ffaa' : '#ff3344'} />
    </mesh>
  )
}

function StarField() {
  const stars = useRef<{ x: number; y: number; size: number }[]>([])
  if (stars.current.length === 0) {
    for (let i = 0; i < 80; i++) {
      stars.current.push({
        x: (Math.random() * 2 - 1) * FIELD_HALF_WIDTH * 1.3,
        y: (Math.random() * 2 - 1) * FIELD_TOP * 1.2,
        size: 0.03 + Math.random() * 0.08,
      })
    }
  }
  const groupRef = useRef<Group>(null)
  useFrame((_, dt) => {
    if (!groupRef.current) return
    for (const child of groupRef.current.children) {
      child.position.y -= dt * 1.2
      if (child.position.y < FIELD_BOTTOM - 1) {
        child.position.y = FIELD_TOP + 1
        child.position.x = (Math.random() * 2 - 1) * FIELD_HALF_WIDTH * 1.3
      }
    }
  })
  return (
    <group ref={groupRef} position={[0, 0, -2]}>
      {stars.current.map((s, i) => (
        <mesh key={i} position={[s.x, s.y, 0]}>
          <sphereGeometry args={[s.size, 4, 4]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      ))}
    </group>
  )
}

export function GameScene() {
  const started = useGameStore((s) => s.started)
  const addScore = useGameStore((s) => s.addScore)
  const loseLife = useGameStore((s) => s.loseLife)

  const inputRef = useInput()
  const playerXRef = useRef(0)
  const fireTimerRef = useRef(0)
  const spawnTimerRef = useRef(0.6)
  const elapsedRef = useRef(0)
  const invulnRef = useRef(0)
  const enemiesRef = useRef<Enemy[]>([])
  const bulletsRef = useRef<Bullet[]>([])

  const [, forceRender] = useState(0)

  useEffect(() => {
    if (started) {
      playerXRef.current = 0
      fireTimerRef.current = 0
      spawnTimerRef.current = 0.5
      elapsedRef.current = 0
      invulnRef.current = 1.2
      enemiesRef.current = []
      bulletsRef.current = []
    }
  }, [started])

  useFrame((_, dtRaw) => {
    if (!started) return
    const dt = Math.min(dtRaw, 0.05)
    elapsedRef.current += dt
    if (invulnRef.current > 0) invulnRef.current -= dt

    const input: InputState = inputRef.current
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0)
    playerXRef.current += dir * PLAYER_SPEED * dt
    if (playerXRef.current < -FIELD_HALF_WIDTH + 0.5) playerXRef.current = -FIELD_HALF_WIDTH + 0.5
    if (playerXRef.current > FIELD_HALF_WIDTH - 0.5) playerXRef.current = FIELD_HALF_WIDTH - 0.5

    fireTimerRef.current -= dt
    if (fireTimerRef.current <= 0) {
      fireTimerRef.current = PLAYER_FIRE_INTERVAL
      bulletsRef.current.push({
        id: newId(),
        x: playerXRef.current,
        y: PLAYER_Y + 0.7,
        vy: BULLET_SPEED_PLAYER,
        fromPlayer: true,
      })
    }

    spawnTimerRef.current -= dt
    if (spawnTimerRef.current <= 0) {
      spawnTimerRef.current = spawnInterval(elapsedRef.current)
      enemiesRef.current.push(makeEnemy(elapsedRef.current))
    }

    const enemies = enemiesRef.current
    const bullets = bulletsRef.current

    for (const e of enemies) {
      e.age += dt
      e.y += e.vy * dt
      if (e.type === 'zigzag') {
        const w = e.swayFrequency * Math.PI
        e.x = e.baseX + Math.sin(e.age * w) * e.swayAmplitude
        const vx = Math.cos(e.age * w) * e.swayAmplitude * w
        e.rotation = Math.atan2(vx, -e.vy)
      }
      if (e.type === 'shooter') {
        e.fireTimer -= dt
        if (e.fireTimer <= 0 && e.y < FIELD_TOP - 1) {
          e.fireTimer = 1.4 + Math.random() * 0.8
          bullets.push({
            id: newId(),
            x: e.x,
            y: e.y - 0.6,
            vy: -BULLET_SPEED_ENEMY,
            fromPlayer: false,
          })
        }
      }
    }

    for (const b of bullets) {
      b.y += b.vy * dt
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]
      if (!b.fromPlayer) continue
      let consumed = false
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j]
        const dx = b.x - e.x
        const dy = b.y - e.y
        const r = BULLET_RADIUS + ENEMY_RADIUS
        if (dx * dx + dy * dy < r * r) {
          e.hp -= 1
          consumed = true
          if (e.hp <= 0) {
            const reward = e.type === 'basic' ? 50 : e.type === 'zigzag' ? 100 : 150
            addScore(reward)
            enemies.splice(j, 1)
          }
          break
        }
      }
      if (consumed) bullets.splice(i, 1)
    }

    const px = playerXRef.current
    const py = PLAYER_Y
    if (invulnRef.current <= 0) {
      let hit = false
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i]
        if (b.fromPlayer) continue
        const dx = b.x - px
        const dy = b.y - py
        const r = BULLET_RADIUS + PLAYER_RADIUS
        if (dx * dx + dy * dy < r * r) {
          bullets.splice(i, 1)
          hit = true
          break
        }
      }
      if (!hit) {
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j]
          const dx = e.x - px
          const dy = e.y - py
          const r = ENEMY_RADIUS + PLAYER_RADIUS
          if (dx * dx + dy * dy < r * r) {
            enemies.splice(j, 1)
            hit = true
            break
          }
        }
      }
      if (hit) {
        loseLife()
        invulnRef.current = 1.5
      }
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i]
      if (e.y < FIELD_BOTTOM - 1 || Math.abs(e.x) > FIELD_HALF_WIDTH + 3) {
        enemies.splice(i, 1)
      }
    }
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]
      if (b.y > FIELD_TOP + 1 || b.y < FIELD_BOTTOM - 1) bullets.splice(i, 1)
    }

    forceRender((n) => (n + 1) % 1024)
  })

  const blink = invulnRef.current > 0 && Math.floor(invulnRef.current * 12) % 2 === 0

  return (
    <>
      <StarField />
      <PlayerMesh x={playerXRef.current} hit={blink} />
      {enemiesRef.current.map((e) => (
        <EnemyMesh key={e.id} enemy={e} />
      ))}
      {bulletsRef.current.map((b) => (
        <BulletMesh key={b.id} bullet={b} />
      ))}
    </>
  )
}
