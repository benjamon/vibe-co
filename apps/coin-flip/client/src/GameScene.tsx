import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Group, MathUtils } from 'three'
import { useGameStore } from './store'

const FLIP_DURATION = 1.6

function Coin() {
  const groupRef = useRef<Group>(null)
  const flipping = useGameStore((s) => s.flipping)
  const pendingResult = useGameStore((s) => s.pendingResult)
  const result = useGameStore((s) => s.result)
  const finishFlip = useGameStore((s) => s.finishFlip)

  const anim = useRef({ active: false, t: 0, startRot: 0, endRot: 0, spins: 6 })

  useEffect(() => {
    if (!flipping || !pendingResult) return
    const startRot = groupRef.current?.rotation.x ?? 0
    const base = pendingResult === 'heads' ? 0 : Math.PI
    const spins = 5 + Math.floor(Math.random() * 3)
    const endRot = startRot + Math.PI * 2 * spins + (base - ((startRot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2))
    anim.current = { active: true, t: 0, startRot, endRot, spins }
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
        finishFlip()
      }
    } else if (!flipping) {
      // Idle: gentle hover rotation around Y so both faces aren't static-looking
      g.rotation.y += delta * 0.6
      // Settle the flip axis to show the current face
      if (result === 'tails') g.rotation.x = Math.PI
      else g.rotation.x = 0
      g.position.y = Math.sin(performance.now() * 0.002) * 0.1
    }
  })

  // Cylinder oriented as a coin: axis along Y, we rotate around X for flip.
  // Rotate the geometry so the round face looks forward-ish initially isn't needed;
  // we'll use a cylinder lying flat (rotated 90° on Z).
  const materials = useMemo(
    () => ({
      edge: { color: '#b8860b' },
      heads: { color: '#ffd700' },
      tails: { color: '#d4a017' },
    }),
    [],
  )

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* Cylinder: args = [radiusTop, radiusBottom, height, radialSegments] */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[1.5, 1.5, 0.25, 64]} />
        <meshStandardMaterial color={materials.edge.color} metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Heads face (front, +Z) */}
      <mesh position={[0, 0, 0.13]}>
        <circleGeometry args={[1.45, 64]} />
        <meshStandardMaterial color={materials.heads.color} metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0, 0.14]}>
        <torusGeometry args={[0.9, 0.08, 16, 64]} />
        <meshStandardMaterial color="#8b6914" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* H marker */}
      <mesh position={[0, 0, 0.14]}>
        <boxGeometry args={[0.15, 0.9, 0.02]} />
        <meshStandardMaterial color="#8b6914" />
      </mesh>
      <mesh position={[0.3, 0, 0.14]}>
        <boxGeometry args={[0.15, 0.9, 0.02]} />
        <meshStandardMaterial color="#8b6914" />
      </mesh>
      <mesh position={[-0.3, 0, 0.14]}>
        <boxGeometry args={[0.15, 0.9, 0.02]} />
        <meshStandardMaterial color="#8b6914" />
      </mesh>
      <mesh position={[0, 0, 0.14]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.15, 0.9, 0.02]} />
        <meshStandardMaterial color="#8b6914" />
      </mesh>
      {/* Tails face (back, -Z) */}
      <mesh position={[0, 0, -0.13]} rotation={[0, Math.PI, 0]}>
        <circleGeometry args={[1.45, 64]} />
        <meshStandardMaterial color={materials.tails.color} metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0, -0.14]}>
        <torusGeometry args={[0.9, 0.08, 16, 64]} />
        <meshStandardMaterial color="#6b4e0f" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* T marker */}
      <mesh position={[0, 0.25, -0.14]}>
        <boxGeometry args={[0.9, 0.15, 0.02]} />
        <meshStandardMaterial color="#6b4e0f" />
      </mesh>
      <mesh position={[0, -0.1, -0.14]}>
        <boxGeometry args={[0.15, 0.7, 0.02]} />
        <meshStandardMaterial color="#6b4e0f" />
      </mesh>
    </group>
  )
}

export function GameScene() {
  return (
    <>
      <Coin />
    </>
  )
}
