import { useFrame } from '@react-three/fiber'
import { RigidBody } from '@react-three/rapier'
import { useRef } from 'react'
import { Mesh } from 'three'
import { useGameStore } from './store'

function Floor() {
  return (
    <RigidBody type="fixed" colliders="cuboid">
      <mesh position={[0, -0.5, 0]} receiveShadow>
        <boxGeometry args={[20, 1, 20]} />
        <meshStandardMaterial color="#2d4a3e" />
      </mesh>
    </RigidBody>
  )
}

function Player() {
  const meshRef = useRef<Mesh>(null)
  const started = useGameStore((s) => s.started)

  useFrame((_state, delta) => {
    if (!meshRef.current || !started) return
    meshRef.current.rotation.y += delta * 0.5
  })

  return (
    <RigidBody colliders="cuboid" position={[0, 2, 0]}>
      <mesh ref={meshRef} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#e94560" />
      </mesh>
    </RigidBody>
  )
}

function Obstacle({ position }: { position: [number, number, number] }) {
  return (
    <RigidBody colliders="cuboid" position={position}>
      <mesh castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#0f3460" />
      </mesh>
    </RigidBody>
  )
}

export function GameScene() {
  return (
    <>
      <Floor />
      <Player />
      <Obstacle position={[-3, 3, -2]} />
      <Obstacle position={[3, 5, 1]} />
      <Obstacle position={[0, 7, -4]} />
    </>
  )
}
