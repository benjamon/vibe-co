import { useGameStore } from './store'

export function HUD() {
  const started = useGameStore((s) => s.started)
  const elapsed = useGameStore((s) => s.elapsed)
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
        lineHeight: '1.6',
      }}
    >
      <div>WASD / Arrows: Move</div>
      <div>Space: Jump</div>
      <div style={{ marginTop: 8, opacity: 0.6 }}>Time: {elapsed.toFixed(1)}s</div>
    </div>
  )
}
