import { useEffect } from 'react'
import { WorldViewer } from './WorldViewer'
import { useGameStore, ROUNDS, type AttemptResult } from './store'

const overlayBase = {
  position: 'absolute',
  color: 'white',
  fontFamily: 'system-ui, sans-serif',
  pointerEvents: 'none',
  userSelect: 'none',
  textShadow: '0 1px 2px rgba(0,0,0,0.85)',
} as const

const CHECK_COLORS: Record<AttemptResult, string> = {
  pending: 'rgba(255,255,255,0.85)',
  correct: '#7eff8e',
  wrong: '#ff7e7e',
}

const Checkbox = ({ result }: { result: AttemptResult }) => (
  <div
    style={{
      width: 36,
      height: 36,
      border: '2px solid rgba(255,255,255,0.9)',
      borderRadius: 6,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 22,
      fontWeight: 700,
      lineHeight: 1,
      color: CHECK_COLORS[result],
      background: 'rgba(0,0,0,0.45)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.6)',
    }}
  >
    {result === 'correct' ? '✓' : result === 'wrong' ? '✗' : ''}
  </div>
)

export function App() {
  const phase = useGameStore((s) => s.phase)
  const target = useGameStore((s) => s.target)
  const revealTarget = useGameStore((s) => s.revealTarget)
  const attempts = useGameStore((s) => s.attempts)
  const ready = useGameStore((s) => s.countries.length > 0)
  const startGame = useGameStore((s) => s.startGame)
  const guess = useGameStore((s) => s.country)

  useEffect(() => {
    ;(window as any).__gameState = useGameStore.getState()
    return useGameStore.subscribe((state) => {
      ;(window as any).__gameState = state
    })
  }, [])

  const correctCount = attempts.filter((a) => a === 'correct').length

  return (
    <>
      <WorldViewer />

      {phase !== 'idle' && (
        <div
          style={{
            ...overlayBase,
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            {attempts.map((a, i) => (
              <Checkbox key={i} result={a} />
            ))}
          </div>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: 0.3 }}>
            {revealTarget ? (
              <>
                <span style={{ opacity: 0.7, marginRight: 8 }}>Was:</span>
                {revealTarget}
              </>
            ) : phase === 'playing' && target ? (
              <>
                <span style={{ opacity: 0.7, marginRight: 8 }}>Find:</span>
                {target}
              </>
            ) : phase === 'finished' ? (
              <span>
                Score: {correctCount} / {ROUNDS}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {(phase === 'idle' || phase === 'finished') && (
        <button
          type="button"
          onClick={startGame}
          disabled={!ready}
          style={{
            position: 'absolute',
            top: phase === 'finished' ? '62%' : '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '14px 32px',
            fontSize: 22,
            fontWeight: 700,
            color: 'white',
            background: ready
              ? 'rgba(20, 60, 110, 0.85)'
              : 'rgba(60, 60, 60, 0.7)',
            border: '2px solid rgba(255,255,255,0.85)',
            borderRadius: 10,
            cursor: ready ? 'pointer' : 'wait',
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: 0.4,
            boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          }}
        >
          {phase === 'idle'
            ? ready
              ? 'Start Game'
              : 'Loading…'
            : 'Play Again'}
        </button>
      )}

      {phase !== 'idle' && guess && (
        <div
          style={{
            ...overlayBase,
            bottom: 22,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 20,
            fontWeight: 500,
            letterSpacing: 0.3,
          }}
        >
          <span style={{ opacity: 0.75, marginRight: 8 }}>Guessed:</span>
          {guess}
        </div>
      )}

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
