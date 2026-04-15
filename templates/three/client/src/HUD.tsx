import { useGameStore } from './store'

export function HUD() {
  const started = useGameStore((s) => s.started)
  if (!started) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        color: 'white',
        fontFamily: 'monospace',
        fontSize: '14px',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <div>Game Running</div>
    </div>
  )
}
