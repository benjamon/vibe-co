import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { GameScene } from './GameScene'
import { HUD } from './HUD'
import { useGameStore } from './store'
import { useEffect } from 'react'

export function App() {
  const started = useGameStore((s) => s.started)
  const start = useGameStore((s) => s.start)

  // Expose game state for Playwright testing
  useEffect(() => {
    ;(window as any).__gameState = useGameStore.getState()
    return useGameStore.subscribe((state) => {
      ;(window as any).__gameState = state
    })
  }, [])

  return (
    <>
      <Canvas camera={{ position: [0, 8, 12], fov: 50 }}>
        <color attach="background" args={['#1a1a2e']} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <Physics gravity={[0, -9.81, 0]}>
          <GameScene />
        </Physics>
      </Canvas>
      <HUD />
      {!started && (
        <div
          onClick={start}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)',
            color: 'white',
            fontSize: '2rem',
            cursor: 'pointer',
            fontFamily: 'sans-serif',
          }}
        >
          Click to Start
        </div>
      )}
    </>
  )
}
