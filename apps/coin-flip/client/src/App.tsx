import { Canvas } from '@react-three/fiber'
import { GameScene } from './GameScene'
import { HUD } from './HUD'
import { useGameStore } from './store'
import { useEffect } from 'react'

export function App() {
  const startFlip = useGameStore((s) => s.startFlip)
  const flipping = useGameStore((s) => s.flipping)

  useEffect(() => {
    ;(window as any).__gameState = useGameStore.getState()
    return useGameStore.subscribe((state) => {
      ;(window as any).__gameState = state
    })
  }, [])

  return (
    <div
      onPointerDown={() => startFlip()}
      style={{
        position: 'fixed',
        inset: 0,
        cursor: flipping ? 'progress' : 'pointer',
        touchAction: 'manipulation',
      }}
    >
      <Canvas camera={{ position: [0, 4, 4.5], fov: 45 }}>
        <color attach="background" args={['#0f1020']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 6, 5]} intensity={1.2} />
        <directionalLight position={[-4, 2, -3]} intensity={0.4} color="#88aaff" />
        <GameScene />
      </Canvas>
      <HUD />
    </div>
  )
}
