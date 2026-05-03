import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Group, MathUtils } from 'three'
import { useGameStore, type CoinState } from './store'

const FLIP_DURATION = 1.6
const GRAVITY = 30
const LAUNCH_VELOCITY = (GRAVITY * FLIP_DURATION) / 2

interface CoinAnim {
  active: boolean
  t: number
  startRot: number
  endRot: number
}

function CoinMesh({
  coin,
  position,
}: {
  coin: CoinState
  position: [number, number, number]
}) {
  const groupRef = useRef<Group>(null)
  const finishFlip = useGameStore((s) => s.finishFlip)
  const anim = useRef<CoinAnim>({ active: false, t: 0, startRot: 0, endRot: 0 })

  useEffect(() => {
    if (!coin.flipping || !coin.pendingResult) return
    const g = groupRef.current
    const startRot = g?.rotation.x ?? 0
    const target = coin.pendingResult === 'heads' ? 0 : Math.PI
    const spins = 5 + Math.floor(Math.random() * 3)
    const currentMod = ((startRot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    const delta = target - currentMod
    const endRot = startRot + Math.PI * 2 * spins + delta
    anim.current = { active: true, t: 0, startRot, endRot }
  }, [coin.flipping, coin.pendingResult])

  useFrame((_state, delta) => {
    const g = groupRef.current
    if (!g) return

    if (anim.current.active) {
      anim.current.t += delta
      const t = Math.min(anim.current.t, FLIP_DURATION)
      const p = t / FLIP_DURATION
      const eased = 1 - Math.pow(1 - p, 3)
      g.rotation.x = MathUtils.lerp(anim.current.startRot, anim.current.endRot, eased)
      g.position.y = LAUNCH_VELOCITY * t - 0.5 * GRAVITY * t * t
      if (anim.current.t >= FLIP_DURATION) {
        anim.current.active = false
        g.position.y = 0
        g.rotation.x = anim.current.endRot
        finishFlip(coin.id)
      }
    } else if (!coin.flipping) {
      g.rotation.x = coin.result === 'tails' ? Math.PI : 0
      g.position.y = 0
    }
  })

  return (
    <group ref={groupRef} position={position}>
      <mesh castShadow>
        <cylinderGeometry args={[1.5, 1.5, 0.25, 64]} />
        <meshStandardMaterial color="#b8860b" metalness={0.7} roughness={0.3} />
      </mesh>

      <mesh position={[0, 0.126, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.45, 64]} />
        <meshStandardMaterial color="#ffd700" metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.135, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.9, 0.06, 16, 64]} />
        <meshStandardMaterial color="#8b6914" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[-0.3, 0.14, 0]}>
        <boxGeometry args={[0.15, 0.02, 0.9]} />
        <meshStandardMaterial color="#8b6914" />
      </mesh>
      <mesh position={[0.3, 0.14, 0]}>
        <boxGeometry args={[0.15, 0.02, 0.9]} />
        <meshStandardMaterial color="#8b6914" />
      </mesh>
      <mesh position={[0, 0.14, 0]}>
        <boxGeometry args={[0.6, 0.02, 0.15]} />
        <meshStandardMaterial color="#8b6914" />
      </mesh>

      <mesh position={[0, -0.126, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.45, 64]} />
        <meshStandardMaterial color="#d4a017" metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, -0.135, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.9, 0.06, 16, 64]} />
        <meshStandardMaterial color="#6b4e0f" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, -0.14, -0.35]}>
        <boxGeometry args={[0.9, 0.02, 0.15]} />
        <meshStandardMaterial color="#6b4e0f" />
      </mesh>
      <mesh position={[0, -0.14, 0.05]}>
        <boxGeometry args={[0.15, 0.02, 0.7]} />
        <meshStandardMaterial color="#6b4e0f" />
      </mesh>
    </group>
  )
}

function gridPosition(index: number, total: number): [number, number, number] {
  const cols = Math.ceil(Math.sqrt(total))
  const rows = Math.ceil(total / cols)
  const col = index % cols
  const row = Math.floor(index / cols)
  const spacing = 4
  const x = (col - (cols - 1) / 2) * spacing
  const z = (row - (rows - 1) / 2) * spacing
  return [x, 0, z]
}

export function GameScene() {
  const coins = useGameStore((s) => s.coins)
  return (
    <>
      {coins.map((coin, i) => (
        <CoinMesh
          key={coin.id}
          coin={coin}
          position={gridPosition(i, coins.length)}
        />
      ))}
    </>
  )
}
