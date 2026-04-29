import { useEffect } from 'react'
import { WorldViewer } from './WorldViewer'
import { useGameStore } from './store'

export function App() {
  useEffect(() => {
    ;(window as any).__gameState = useGameStore.getState()
    return useGameStore.subscribe((state) => {
      ;(window as any).__gameState = state
    })
  }, [])

  return (
    <>
      <WorldViewer />
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
          pointerEvents: 'none',
          userSelect: 'none',
          textShadow: '0 1px 2px rgba(0,0,0,0.85)',
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700 }}>mapoguesser</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
          Drag to spin the world
        </div>
      </div>
    </>
  )
}
