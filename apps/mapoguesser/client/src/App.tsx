import { useEffect, useMemo, useState } from 'react'
import { WorldViewer } from './WorldViewer'
import { Confetti } from './Confetti'
import { sfxEndJingle } from './sfx'
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

// Stats sum colour: green for net-positive, red for net-negative, neutral
// otherwise. A zero result still gets shown but uses the muted style so the
// strong colours stay reserved for clear signal.
const scoreColour = (sum: number): string => {
  if (sum > 0) return '#7eff8e'
  if (sum < 0) return '#ff7e7e'
  return 'rgba(255,255,255,0.85)'
}

// Hamburger / menu / stats / start-screen all share this button look so the
// HUD reads as one consistent UI rather than a pile of bespoke styles.
const menuButtonStyle = {
  padding: '10px 22px',
  fontSize: 16,
  fontWeight: 600,
  color: 'white',
  background: 'rgba(20, 60, 110, 0.85)',
  border: '2px solid rgba(255,255,255,0.85)',
  borderRadius: 8,
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
  letterSpacing: 0.3,
  boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
  pointerEvents: 'auto',
} as const

export function App() {
  const phase = useGameStore((s) => s.phase)
  const target = useGameStore((s) => s.target)
  const revealTarget = useGameStore((s) => s.revealTarget)
  const attempts = useGameStore((s) => s.attempts)
  const markers = useGameStore((s) => s.markers)
  const countryCodes = useGameStore((s) => s.countryCodes)
  const countryIds = useGameStore((s) => s.countryIds)
  const stats = useGameStore((s) => s.stats)
  const selectedStatsCountryId = useGameStore((s) => s.selectedStatsCountryId)
  const selectStatsCountry = useGameStore((s) => s.selectStatsCountry)
  const ready = useGameStore((s) => s.countries.length > 0)
  const startGame = useGameStore((s) => s.startGame)
  const resetGame = useGameStore((s) => s.resetGame)
  const guess = useGameStore((s) => s.country)
  const seed = useGameStore((s) => s.seed)

  const [menuOpen, setMenuOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)

  // Reverse lookup ID → name so the stats list can label its rows. Recompute
  // only when the (grow-only) ID map changes, which is once per app load.
  const idToName = useMemo(() => {
    const m: Record<number, string> = {}
    for (const [name, id] of Object.entries(countryIds)) m[id] = name
    return m
  }, [countryIds])

  // Flatten the stats map into a sorted, render-ready array. Only countries
  // that have been attempted at least once show up — an alphabetical wall of
  // every country in the dataset would be mostly noise.
  const statsRows = useMemo(() => {
    const rows: { id: number; name: string; sum: number; code?: string }[] = []
    for (const [idStr, s] of Object.entries(stats)) {
      const id = Number(idStr)
      const name = idToName[id]
      if (!name) continue
      rows.push({ id, name, sum: s.score, code: countryCodes[name] })
    }
    rows.sort((a, b) => a.name.localeCompare(b.name))
    return rows
  }, [stats, idToName, countryCodes])

  // Totals across every target, for the synthetic "All" row at the top of the
  // list. A guess is correct when the country clicked matches the target it
  // was recorded under.
  const statsTotals = useMemo(() => {
    let correct = 0
    let total = 0
    for (const [idStr, s] of Object.entries(stats)) {
      const targetId = Number(idStr)
      for (const g of s.guesses) {
        total += 1
        if (g.id === targetId) correct += 1
      }
    }
    return { correct, wrong: total - correct, total }
  }, [stats])

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

  // When a match wraps up, play the score-appropriate jingle and — only on a
  // flawless 9/9 — let the confetti fly. Keyed on `phase` so it fires once per
  // transition into 'finished'.
  useEffect(() => {
    if (phase !== 'finished') {
      setShowConfetti(false)
      return
    }
    sfxEndJingle(correctCount)
    if (correctCount >= ROUNDS) setShowConfetti(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

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

  const handleNewGame = () => {
    setMenuOpen(false)
    startGame()
  }
  const handleMainMenu = () => {
    setMenuOpen(false)
    resetGame()
  }
  const handleOpenStats = () => {
    // Strip ?seed= first so the auto-start effect doesn't immediately
    // re-launch the same match once resetGame() flips us back to 'idle'.
    const url = new URL(window.location.href)
    if (url.searchParams.has('seed')) {
      url.searchParams.delete('seed')
      window.history.replaceState(null, '', url.toString())
    }
    // Wipe the last game's pins/labels so the stats dots aren't drawn on
    // top of leftover correct/wrong markers from the previous round.
    resetGame()
    setStatsOpen(true)
  }

  return (
    <>
      <WorldViewer />

      {showConfetti && <Confetti onDone={() => setShowConfetti(false)} />}

      {phase !== 'idle' && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 8,
            pointerEvents: 'auto',
          }}
        >
          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              fontSize: 22,
              fontWeight: 700,
              color: 'white',
              background: 'rgba(20, 60, 110, 0.85)',
              border: '2px solid rgba(255,255,255,0.85)',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: 'system-ui, sans-serif',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              lineHeight: 1,
            }}
          >
            {menuOpen ? '×' : '☰'}
          </button>
          {menuOpen && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={handleMainMenu}
                style={menuButtonStyle}
              >
                Main Menu
              </button>
              <button
                type="button"
                onClick={handleNewGame}
                style={menuButtonStyle}
              >
                New Game
              </button>
            </div>
          )}
        </div>
      )}

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

      {!statsOpen && (phase === 'idle' || phase === 'finished') && (
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
          <button
            type="button"
            onClick={handleOpenStats}
            style={menuButtonStyle}
          >
            View Stats
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

      {statsOpen && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            bottom: 16,
            left: 16,
            width: 'min(340px, 92vw)',
            background: 'rgba(8, 18, 32, 0.92)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 12,
            pointerEvents: 'auto',
            fontFamily: 'system-ui, sans-serif',
            color: 'white',
            boxShadow: '0 6px 24px rgba(0,0,0,0.55)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 0.3 }}>
              Total score per country
            </div>
            <button
              type="button"
              onClick={() => {
                // Closing the panel also clears the dot layer — leaving stale
                // highlights on the globe after the list is gone would be
                // confusing with nothing visible to tie them back to.
                selectStatsCountry(null)
                setStatsOpen(false)
              }}
              style={{ ...menuButtonStyle, padding: '6px 14px', fontSize: 14 }}
            >
              Close
            </button>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 8,
            }}
          >
            {statsRows.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: 'center',
                  opacity: 0.75,
                  fontSize: 14,
                }}
              >
                No guesses yet — play a round to start filling this in.
              </div>
            ) : (
              <>
                {(() => {
                  const active = selectedStatsCountryId === 'all'
                  return (
                    <button
                      type="button"
                      onClick={() =>
                        selectStatsCountry(active ? null : 'all')
                      }
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        width: '100%',
                        background: active
                          ? 'rgba(60, 130, 220, 0.35)'
                          : 'rgba(255,255,255,0.05)',
                        border: 'none',
                        borderBottom: '1px solid rgba(255,255,255,0.18)',
                        color: 'white',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          fontSize: 15,
                          fontWeight: 700,
                          letterSpacing: 0.3,
                        }}
                      >
                        All ({statsTotals.total})
                      </span>
                      <span
                        style={{
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: 700,
                          fontSize: 15,
                          color: '#3fb84e',
                        }}
                      >
                        {statsTotals.correct}
                      </span>
                      <span style={{ opacity: 0.4 }}>/</span>
                      <span
                        style={{
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: 700,
                          fontSize: 15,
                          color: '#e64545',
                        }}
                      >
                        {statsTotals.wrong}
                      </span>
                    </button>
                  )
                })()}
                {statsRows.map((row) => {
                const active = selectedStatsCountryId === row.id
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() =>
                      selectStatsCountry(active ? null : row.id)
                    }
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      width: '100%',
                      background: active
                        ? 'rgba(60, 130, 220, 0.35)'
                        : 'transparent',
                      border: 'none',
                      borderBottom: '1px solid rgba(255,255,255,0.08)',
                      color: 'white',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                    }}
                  >
                    <FlagIcon code={row.code} height={20} />
                    <span style={{ flex: 1, fontSize: 15 }}>{row.name}</span>
                    <span
                      style={{
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 700,
                        fontSize: 16,
                        color: scoreColour(row.sum),
                        minWidth: 32,
                        textAlign: 'right',
                      }}
                    >
                      {row.sum > 0 ? `+${row.sum}` : row.sum}
                    </span>
                  </button>
                )
                })}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
