import { useEffect, useMemo, useState } from 'react'
import { WorldViewer } from './WorldViewer'
import { Confetti } from './Confetti'
import { Fireworks } from './Fireworks'
import { sfxEndJingle, installAudioUnlock } from './sfx'
import { useGameStore, ROUNDS, type AttemptResult } from './store'
import {
  fetchStats,
  releaseStats,
  subscribeStats,
  subscribeCountryGuesses,
  type CountryAgg,
} from './stats'

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
      // 40px on desktop, but shrink to fit 9 boxes (+ 8×4px gaps) across the
      // viewport on a narrow portrait phone. aspectRatio keeps the 40:32 shape
      // as the width shrinks; the flag inside scales with it.
      width: 'min(40px, calc((96vw - 32px) / 9))',
      aspectRatio: '40 / 32',
      boxSizing: 'border-box',
      flex: 'none',
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
        style={{ display: 'block', width: '70%', height: 'auto', borderRadius: 2 }}
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
  const statsMode = useGameStore((s) => s.statsMode)
  const setStatsMode = useGameStore((s) => s.setStatsMode)
  const globalStats = useGameStore((s) => s.globalStats)
  const myStats = useGameStore((s) => s.myStats)
  const ready = useGameStore((s) => s.countries.length > 0)
  const startGame = useGameStore((s) => s.startGame)
  const resetGame = useGameStore((s) => s.resetGame)
  const guess = useGameStore((s) => s.country)
  const seed = useGameStore((s) => s.seed)
  const perfectStreak = useGameStore((s) => s.perfectStreak)

  const [menuOpen, setMenuOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)
  const [confettiIntensity, setConfettiIntensity] = useState<'small' | 'full'>(
    'full',
  )
  const [showFireworks, setShowFireworks] = useState(false)

  // Reverse lookup ID → name so we can fold the local guess history into the
  // "mine" aggregate. Recompute only when the (grow-only) ID map changes.
  const idToName = useMemo(() => {
    const m: Record<number, string> = {}
    for (const [name, id] of Object.entries(countryIds)) m[id] = name
    return m
  }, [countryIds])

  // "Mine" aggregate keyed by country NAME: the server's per-user totals
  // (retrieved by the local random id) merged with this device's local history.
  // Local overlays the server when it holds at least as many samples, so the
  // view never shows fewer guesses than the player has actually made here.
  const mineAgg = useMemo(() => {
    const out: Record<string, CountryAgg> = {}
    for (const [name, a] of Object.entries(myStats)) {
      out[name] = { correct: a.correct, total: a.total }
    }
    for (const [idStr, s] of Object.entries(stats)) {
      const id = Number(idStr)
      const name = idToName[id]
      if (!name) continue
      let correct = 0
      for (const g of s.guesses) if (g.id === id) correct += 1
      const total = s.guesses.length
      const prev = out[name]
      if (!prev || total >= prev.total) out[name] = { correct, total }
    }
    return out
  }, [myStats, stats, idToName])

  // The dataset the sidebar is currently showing.
  const activeAgg = statsMode === 'global' ? globalStats : mineAgg

  // Flatten the active aggregate into a sorted, render-ready array. Only
  // countries with at least one recorded guess appear — an alphabetical wall of
  // every country in the dataset would be mostly noise. `sum` is the net score
  // (correct − wrong); selection is keyed by the local country ID.
  const statsRows = useMemo(() => {
    const rows: { id: number; name: string; sum: number; code?: string }[] = []
    for (const [name, a] of Object.entries(activeAgg)) {
      const id = countryIds[name]
      if (id === undefined) continue
      rows.push({
        id,
        name,
        sum: a.correct - (a.total - a.correct),
        code: countryCodes[name],
      })
    }
    rows.sort((a, b) => a.name.localeCompare(b.name))
    return rows
  }, [activeAgg, countryIds, countryCodes])

  // Totals across every country, for the synthetic "All" row at the top.
  const statsTotals = useMemo(() => {
    let correct = 0
    let total = 0
    for (const a of Object.values(activeAgg)) {
      correct += a.correct
      total += a.total
    }
    return { correct, wrong: total - correct, total }
  }, [activeAgg])

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

  // Pipe SpacetimeDB snapshots into the store: aggregate per-country stats
  // (global + this user's) and the on-demand guess dots for a selected global
  // country. The connection itself is opened lazily (on the first guess or when
  // the stats panel opens), not here — visitors who only look hold nothing.
  useEffect(() => {
    const unsubStats = subscribeStats((snap) => {
      useGameStore.getState().setServerStats(snap.global, snap.mine)
    })
    const unsubGuesses = subscribeCountryGuesses((country, dots) => {
      useGameStore.getState().setGlobalGuesses(country, dots)
    })
    return () => {
      unsubStats()
      unsubGuesses()
    }
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

  // When a match wraps up, play the score-appropriate jingle and fire the
  // matching visual celebration. Keyed on `phase` so it runs once per
  // transition into 'finished'. Tiers:
  //   7/9 → small confetti
  //   8/9 → full confetti
  //   9/9 → full confetti + fireworks
  useEffect(() => {
    if (phase !== 'finished') {
      setShowConfetti(false)
      setShowFireworks(false)
      return
    }
    sfxEndJingle(correctCount)
    if (correctCount >= ROUNDS) {
      setConfettiIntensity('full')
      setShowConfetti(true)
      setShowFireworks(true)
    } else if (correctCount === ROUNDS - 1) {
      setConfettiIntensity('full')
      setShowConfetti(true)
    } else if (correctCount === ROUNDS - 2) {
      setConfettiIntensity('small')
      setShowConfetti(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Prime Web Audio on the first user interaction so end-game sounds reliably
  // play on iOS/Safari (which keeps the audio context suspended until then).
  useEffect(() => installAudioUnlock(), [])

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
  // Drop ?seed= from the URL so the auto-start effect doesn't immediately
  // re-launch the just-ended match the moment resetGame() flips us to 'idle'.
  const clearSeedFromUrl = () => {
    const url = new URL(window.location.href)
    if (url.searchParams.has('seed')) {
      url.searchParams.delete('seed')
      window.history.replaceState(null, '', url.toString())
    }
  }
  const handleMainMenu = () => {
    setMenuOpen(false)
    // Back to the unseeded URL + the idle main-menu screen. Without clearing the
    // seed, the auto-start effect would just replay the same match.
    clearSeedFromUrl()
    resetGame()
  }
  const handleOpenStats = () => {
    clearSeedFromUrl()
    // Wipe the last game's pins/labels so the stats dots aren't drawn on
    // top of leftover correct/wrong markers from the previous round.
    resetGame()
    setStatsOpen(true)
    // Pull a fresh one-time snapshot of the server aggregates. There's no live
    // subscription; this is the only point the global/your stats are fetched.
    fetchStats()
  }
  const handleCloseStats = () => {
    // Drop the transient stats + per-country subscriptions, and clear the dot
    // layer so stale highlights don't linger on the globe.
    selectStatsCountry(null)
    releaseStats()
    setStatsOpen(false)
  }

  return (
    <>
      <WorldViewer />

      {showConfetti && (
        <Confetti
          intensity={confettiIntensity}
          onDone={() => setShowConfetti(false)}
        />
      )}
      {showFireworks && <Fireworks onDone={() => setShowFireworks(false)} />}

      {phase !== 'idle' && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
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
              fontSize: 26,
              fontWeight: 700,
              color: 'white',
              // Clear, borderless toggle — just the glyph over the globe, with a
              // shadow so it stays legible against bright map tiles.
              background: 'transparent',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: 'system-ui, sans-serif',
              textShadow: '0 1px 4px rgba(0,0,0,0.9)',
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
              {seed && (
                <button
                  type="button"
                  // Don't close the menu — keep it open so the "Copied!"
                  // confirmation is visible after a clipboard copy.
                  onClick={handleShareSeed}
                  style={menuButtonStyle}
                >
                  {shareLabel === 'copied' ? 'Copied!' : 'Share Seed'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {phase !== 'idle' && (
        <div
          style={{
            ...overlayBase,
            // Sit below the 44px hamburger (top:16 → bottom:60) so the centred
            // flag boxes never overlap it on narrow screens.
            top: 64,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 4 }}>
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
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span>
                  Score: {correctCount} / {ROUNDS}
                </span>
                {correctCount >= ROUNDS && (
                  <span
                    style={{
                      fontSize: 19,
                      fontWeight: 800,
                      color: '#ffd93b',
                      letterSpacing: 0.5,
                      textShadow: '0 1px 4px rgba(0,0,0,0.9)',
                    }}
                  >
                    {perfectStreak >= 2
                      ? `${perfectStreak}X Perfect Game Streak`
                      : 'Perfect Game!'}
                  </span>
                )}
              </div>
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
            // Lifted clear of the bottom footers (the "mapoguesser" label and
            // the map-tile attribution credits).
            bottom: 56,
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
              {statsMode === 'global' ? 'Global stats' : 'My stats'}
            </div>
            <button
              type="button"
              onClick={handleCloseStats}
              style={{ ...menuButtonStyle, padding: '6px 14px', fontSize: 14 }}
            >
              Close
            </button>
          </div>
          {/* Segmented My / Global toggle. Switching wipes the current
              selection (handled in setStatsMode) so dots from one dataset don't
              linger when viewing the other. */}
          <div
            style={{
              display: 'flex',
              gap: 0,
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {(['mine', 'global'] as const).map((mode) => {
              const active = statsMode === mode
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    if (statsMode !== mode) setStatsMode(mode)
                  }}
                  style={{
                    flex: 1,
                    padding: '8px 0',
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: 0.3,
                    color: 'white',
                    background: active
                      ? 'rgba(60, 130, 220, 0.55)'
                      : 'rgba(255,255,255,0.05)',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {mode === 'mine' ? 'My stats' : 'Global stats'}
                </button>
              )
            })}
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
                {statsMode === 'global'
                  ? 'No global guesses yet — or still connecting.'
                  : 'No guesses yet — play a round to start filling this in.'}
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
