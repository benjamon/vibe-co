import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RigidBody, CuboidCollider, type RapierRigidBody } from '@react-three/rapier'
import { Vector3 } from 'three'
import { useGameStore } from './store'
import { useKeyboard } from './hooks/useKeyboard'

const MOVE_SPEED = 5
const JUMP_FORCE = 5
const CAMERA_HEIGHT = 8
const CAMERA_DISTANCE = 12

// Temp vectors to avoid allocations in the game loop
const _moveDir = new Vector3()
const _cameraTarget = new Vector3()
const _cameraPos = new Vector3()

function Ground() {
  return (
    <RigidBody type="fixed" colliders="cuboid">
      <mesh position={[0, -0.5, 0]} receiveShadow>
        <boxGeometry args={[40, 1, 40]} />
        <meshStandardMaterial color="#3a5a40" />
      </mesh>
      <gridHelper args={[40, 40, '#4a6a50', '#4a6a50']} position={[0, 0.01, 0]} />
    </RigidBody>
  )
}

function Platforms() {
  const data: [number, number, number, number, number, number][] = [
    [5, 1, -3, 4, 0.5, 4],
    [-6, 2.5, 2, 3, 0.5, 3],
    [0, 4, -8, 5, 0.5, 3],
    [-4, 5.5, -5, 3, 0.5, 3],
    [7, 3.5, 5, 3, 0.5, 3],
  ]

  return (
    <>
      {data.map(([x, y, z, w, h, d], i) => (
        <RigidBody key={i} type="fixed" colliders="cuboid">
          <mesh position={[x, y, z]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial color="#5a3a2a" />
          </mesh>
        </RigidBody>
      ))}
    </>
  )
}

function Player() {
  const bodyRef = useRef<RapierRigidBody>(null)
  const keys = useKeyboard()
  const camera = useThree((s) => s.camera)
  const started = useGameStore((s) => s.started)

  useFrame((_state, delta) => {
    const body = bodyRef.current
    if (!body || !started) return

    useGameStore.getState().tick(delta)

    const vel = body.linvel()
    const pos = body.translation()

    // Grounded check: low vertical velocity and near a surface
    const grounded = Math.abs(vel.y) < 0.5 && pos.y < 1.2

    // Movement
    _moveDir.set(0, 0, 0)
    if (keys.has('KeyW') || keys.has('ArrowUp')) _moveDir.z -= 1
    if (keys.has('KeyS') || keys.has('ArrowDown')) _moveDir.z += 1
    if (keys.has('KeyA') || keys.has('ArrowLeft')) _moveDir.x -= 1
    if (keys.has('KeyD') || keys.has('ArrowRight')) _moveDir.x += 1

    if (_moveDir.lengthSq() > 0) {
      _moveDir.normalize().multiplyScalar(MOVE_SPEED)
    }

    body.setLinvel({ x: _moveDir.x, y: vel.y, z: _moveDir.z }, true)

    // Jump
    if (keys.has('Space') && grounded) {
      body.setLinvel({ x: vel.x, y: JUMP_FORCE, z: vel.z }, true)
    }

    // Camera follow
    _cameraTarget.set(pos.x, pos.y + 1, pos.z)
    _cameraPos.set(pos.x, pos.y + CAMERA_HEIGHT, pos.z + CAMERA_DISTANCE)
    camera.position.lerp(_cameraPos, 5 * delta)
    camera.lookAt(_cameraTarget)
  })

  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      position={[0, 2, 0]}
      enabledRotations={[false, false, false]}
      linearDamping={0.5}
    >
      <CuboidCollider args={[0.4, 0.5, 0.4]} />
      {/* Body */}
      <mesh castShadow>
        <boxGeometry args={[0.8, 1, 0.8]} />
        <meshStandardMaterial color="#e94560" />
      </mesh>
      {/* Head */}
      <mesh castShadow position={[0, 0.75, 0]}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial color="#ffb3b3" />
      </mesh>
      {/* Eyes */}
      <mesh position={[0.12, 0.8, -0.25]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>
      <mesh position={[-0.12, 0.8, -0.25]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>
    </RigidBody>
  )
}

export function GameScene() {
  return (
    <>
      <Ground />
      <Platforms />
      <Player />
    </>
  )
}
