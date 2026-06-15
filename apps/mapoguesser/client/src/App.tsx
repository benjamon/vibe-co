import { useEffect, useState } from 'react'
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

// Background colour encodes the round outcome (green = correct, red = wrong,
// dark = pending). Replaces the older ✓/✗ glyph — the flag now lives in the
// box, so the colour is the only thing carrying right/wrong.
const CHECK_BG: Record<AttemptResult, string> = {
  pending: 'rgba(0,0,0,0.45)',
  correct: 'rgba(63, 184, 78, 0.9)',
  wrong: 'rgba(230, 69, 69, 0.9)',
}

// flagcdn.com serves free, CORS-friendly PNGs at 4:3 (w40 = 40×30). Using
// images instead of emoji because Windows browsers render regional-indicator
// flag emojis as ISO letters, which looks broken.
const FlagIcon = ({
  code,
  height,
}: {
  code: string | undefined
  height: number
}) => {
  if (!code) return null
  return (
    <img
      src={`https://flagcdn.com/w80/${code}.png`}
      alt=""
      width={Math.round((height * 4) / 3)}
      height={height}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        borderRadius: 2,
        boxShadow: '0 1px 2px rgba(0,0,0,0.55)',
      }}
    />
  )
}

const Checkbox = ({
  result,
  code,
}: {
  result: AttemptResult
  code: string | undefined
}) => (
  <div
    style={{
      width: 40,
      height: 32,
      border: '2px solid rgba(255,255,255,0.9)',
      borderRadius: 6,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: CHECK_BG[result],
      boxShadow: '0 1px 3px rgba(0,0,0,0.6)',
      overflow: 'hidden',
    }}
  >
    {result !== 'pending' && code && (
      <img
        src={`https://flagcdn.com/w80/${code}.png`}
        alt=""
        width={28}
        height={21}
        style={{ display: 'block', borderRadius: 2 }}
      />
    )}
  </div>
)

export function App() {
  const phase = useGameStore((s) => s.phase)
  const target = useGameStore((s) => s.target)
  const revealTarget = useGameStore((s) => s.revealTarget)
  const attempts = useGameStore((s) => s.attempts)
  const markers = useGameStore((s) => s.markers)
  const countryCodes = useGameStore((s) => s.countryCodes)
  const ready = useGameStore((s) => s.countries.length > 0)
  const startGame = useGameStore((s) => s.startGame)
  const guess = useGameStore((s) => s.country)
  const seed = useGameStore((s) => s.seed)

  // Pair each resolved attempt with what the user actually clicked. Click
  // markers (kind 'correct' | 'wrong') are appended 1:1 with resolved attempts
  // in chronological order; reveal markers are interleaved separately and must
  // be filtered out. We need this — not targets[i] — because a wrong guess
  // should show the flag of the country the player picked, not the answer.
  const clickMarkers = markers.filter((m) => m.kind !== 'reveal')
  let clickCursor = 0
  const guessByAttempt = attempts.map((a) => {
    if (a === 'pending') return null
    return clickMarkers[clickCursor++]?.label ?? null
  })

  const [shareLabel, setShareLabel] = useState<'idle' | 'copied'>('idle')

  useEffect(() => {
    ;(window as any).__gameState = useGameStore.getState()
    return useGameStore.subscribe((state) => {
      ;(window as any).__gameState = state
    })
  }, [])

  // Auto-start a match if the URL carries a ?seed=. Runs once countries have
  // loaded, and only while we're still on the start screen — clicking
  // 'Play Again' later generates a fresh seed instead of replaying this one.
  useEffect(() => {
    if (!ready || phase !== 'idle') return
    const urlSeed = new URLSearchParams(window.location.search).get('seed')
    if (urlSeed) startGame(urlSeed)
  }, [ready, phase, startGame])

  // Mirror the active match seed into the URL so a refresh / link share
  // reproduces the same draw. replaceState avoids polluting browser history.
  useEffect(() => {
    if (!seed) return
    const url = new URL(window.location.href)
    if (url.searchParams.get('seed') === seed) return
    url.searchParams.set('seed', seed)
    window.history.replaceState(null, '', url.toString())
  }, [seed])

  const correctCount = attempts.filter((a) => a === 'correct').length

  const handleShareSeed = async () => {
    if (!seed) return
    const url = new URL(window.location.href)
    url.searchParams.set('seed', seed)
    const shareUrl = url.toString()
    try {
      // Prefer the native share sheet on mobile; fall back to clipboard so
      // desktop users still get a working "copy link" affordance.
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'mapoguesser', url: shareUrl })
      } else {
        await navigator.clipboard.writeText(shareUrl)
      }
      setShareLabel('copied')
      window.setTimeout(() => setShareLabel('idle'), 2000)
    } catch {
      // User cancelled the share sheet, or clipboard is blocked.
    }
  }

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
            {attempts.map((a, i) => {
              const g = guessByAttempt[i]
              return (
                <Checkbox
                  key={i}
                  result={a}
                  code={g ? countryCodes[g] : undefined}
                />
              )
            })}
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: 0.3,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            {revealTarget ? (
              <>
                <span style={{ opacity: 0.7 }}>Was:</span>
                <FlagIcon code={countryCodes[revealTarget]} height={22} />
                <span>{revealTarget}</span>
              </>
            ) : phase === 'playing' && target ? (
              <>
                <span style={{ opacity: 0.7 }}>Find:</span>
                <FlagIcon code={countryCodes[target]} height={22} />
                <span>{target}</span>
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
        <div
          style={{
            position: 'absolute',
            top: phase === 'finished' ? '62%' : '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <button
            type="button"
            onClick={() => startGame()}
            disabled={!ready}
            style={{
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
          {phase === 'finished' && seed && (
            <button
              type="button"
              onClick={handleShareSeed}
              style={{
                padding: '10px 22px',
                fontSize: 16,
                fontWeight: 600,
                color: 'white',
                background: 'rgba(20, 60, 110, 0.55)',
                border: '2px solid rgba(255,255,255,0.7)',
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: 'system-ui, sans-serif',
                letterSpacing: 0.3,
                boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              }}
            >
              {shareLabel === 'copied' ? 'Copied!' : `Share seed: ${seed}`}
            </button>
          )}
        </div>
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
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ opacity: 0.75 }}>Guessed:</span>
          <FlagIcon code={countryCodes[guess]} height={18} />
          <span>{guess}</span>
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
