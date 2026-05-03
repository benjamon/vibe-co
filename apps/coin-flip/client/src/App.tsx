import { Canvas } from '@react-three/fiber'
import { PerspectiveCamera } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import { GameScene } from './GameScene'
import { HUD } from './HUD'
import { autoFlipIntervalMs, useGameStore } from './store'

function cameraPosition(coinCount: number): [number, number, number] {
  const cols = Math.ceil(Math.sqrt(Math.max(coinCount, 1)))
  const dist = 14 + cols * 4
  return [0, dist * 0.7, dist]
}

export function App() {
  const tap = useGameStore((s) => s.tap)
  const autoFlippers = useGameStore((s) => s.autoFlippers)
  const coinCount = useGameStore((s) => s.coins.length)

  useEffect(() => {
    ;(window as any).__gameState = useGameStore.getState()
    return useGameStore.subscribe((state) => {
      ;(window as any).__gameState = state
    })
  }, [])

  useEffect(() => {
    if (autoFlippers === 0) return
    const interval = autoFlipIntervalMs(autoFlippers)
    const id = window.setInterval(() => {
      useGameStore.getState().autoFlipOne()
    }, interval)
    return () => window.clearInterval(id)
  }, [autoFlippers])

  const camPos = useMemo(() => cameraPosition(coinCount), [coinCount])

  return (
    <div
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-hud]')) return
        tap()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        cursor: 'pointer',
        touchAction: 'manipulation',
      }}
    >
      <Canvas>
        <PerspectiveCamera makeDefault position={camPos} fov={45} />
        <color attach="background" args={['#0f1020']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[8, 14, 10]} intensity={1.2} />
        <directionalLight position={[-8, 4, -6]} intensity={0.4} color="#88aaff" />
        <GameScene />
      </Canvas>
      <HUD />
    </div>
  )
}
