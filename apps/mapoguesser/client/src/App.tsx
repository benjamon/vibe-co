import { useEffect } from 'react'
import { WorldViewer } from './WorldViewer'
import { useGameStore } from './store'

const overlayBase = {
  position: 'absolute',
  color: 'white',
  fontFamily: 'system-ui, sans-serif',
  pointerEvents: 'none',
  userSelect: 'none',
  textShadow: '0 1px 2px rgba(0,0,0,0.85)',
} as const

export function App() {
  const country = useGameStore((s) => s.country)

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
          ...overlayBase,
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: 0.3,
        }}
      >
        {country ?? ''}
      </div>
      <div
        style={{
          ...overlayBase,
          bottom: 16,
          right: 16,
          fontSize: 22,
          fontWeight: 700,
        }}
      >
        mapoguesser
      </div>
    </>
  )
}
