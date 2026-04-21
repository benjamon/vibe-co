import { useGameStore } from './store'

export function HUD() {
  const flipping = useGameStore((s) => s.flipping)
  const result = useGameStore((s) => s.result)
  const flips = useGameStore((s) => s.flips)
  const headsCount = useGameStore((s) => s.headsCount)
  const tailsCount = useGameStore((s) => s.tailsCount)

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        userSelect: 'none',
        color: 'white',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          fontSize: 14,
          fontFamily: 'monospace',
          background: 'rgba(0,0,0,0.35)',
          padding: '8px 12px',
          borderRadius: 8,
        }}
      >
        <div>flips: {flips}</div>
        <div>heads: {headsCount}</div>
        <div>tails: {tailsCount}</div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 32,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 28,
          textShadow: '0 2px 8px rgba(0,0,0,0.7)',
        }}
      >
        {flipping ? (
          <span>flipping…</span>
        ) : result ? (
          <span>
            {result === 'heads' ? 'HEADS' : 'TAILS'} — tap to flip again
          </span>
        ) : (
          <span>tap anywhere to flip the coin</span>
        )}
      </div>
    </div>
  )
}
