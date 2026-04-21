import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Group, MathUtils } from 'three'
import { useGameStore } from './store'

const FLIP_DURATION = 1.6

function Coin() {
  const groupRef = useRef<Group>(null)
  const flipping = useGameStore((s) => s.flipping)
  const pendingResult = useGameStore((s) => s.pendingResult)
  const result = useGameStore((s) => s.result)
  const finishFlip = useGameStore((s) => s.finishFlip)

  const anim = useRef({ active: false, t: 0, startRot: 0, endRot: 0 })

  useEffect(() => {
    if (!flipping || !pendingResult) return
    const g = groupRef.current
    const startRot = g?.rotation.x ?? 0
    // Heads face is +Y (rotation.x ≡ 0 mod 2π). Tails is -Y (rotation.x ≡ π).
    const target = pendingResult === 'heads' ? 0 : Math.PI
    const spins = 5 + Math.floor(Math.random() * 3)
    const currentMod = ((startRot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    const delta = target - currentMod
    const endRot = startRot + Math.PI * 2 * spins + delta
    anim.current = { active: true, t: 0, startRot, endRot }
  }, [flipping, pendingResult])

  useFrame((_state, delta) => {
    const g = groupRef.current
    if (!g) return

    if (anim.current.active) {
      anim.current.t += delta
      const p = Math.min(anim.current.t / FLIP_DURATION, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      g.rotation.x = MathUtils.lerp(anim.current.startRot, anim.current.endRot, eased)
      g.position.y = Math.sin(p * Math.PI) * 2.5
      if (p >= 1) {
        anim.current.active = false
        g.position.y = 0
        g.rotation.x = anim.current.endRot
        finishFlip()
      }
    } else if (!flipping) {
      g.rotation.x = result === 'tails' ? Math.PI : 0
      g.position.y = 0
    }
  })

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* Coin body — cylinder axis along Y, flat faces ±Y */}
      <mesh castShadow>
        <cylinderGeometry args={[1.5, 1.5, 0.25, 64]} />
        <meshStandardMaterial color="#b8860b" metalness={0.7} roughness={0.3} />
      </mesh>

      {/* Heads face (+Y) */}
      <mesh position={[0, 0.126, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.45, 64]} />
        <meshStandardMaterial color="#ffd700" metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.135, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.9, 0.06, 16, 64]} />
        <meshStandardMaterial color="#8b6914" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* H: two posts + crossbar, lying flat on top */}
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

      {/* Tails face (-Y) */}
      <mesh position={[0, -0.126, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.45, 64]} />
        <meshStandardMaterial color="#d4a017" metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, -0.135, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.9, 0.06, 16, 64]} />
        <meshStandardMaterial color="#6b4e0f" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* T: top bar + stem, lying flat on bottom */}
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

export function GameScene() {
  return <Coin />
}
