import { useGameStore } from './store'

export function HUD() {
  const started = useGameStore((s) => s.started)
  const score = useGameStore((s) => s.score)
  const lives = useGameStore((s) => s.lives)
  const level = useGameStore((s) => s.level)
  const xp = useGameStore((s) => s.xp)
  const xpToNext = useGameStore((s) => s.xpToNext)

  if (!started) return null

  const xpPct = Math.max(0, Math.min(1, xp / xpToNext)) * 100

  return (
    <>
      <div style={hudTop}>
        <div>SCORE</div>
        <div style={scoreStyle}>{score.toString().padStart(6, '0')}</div>
        <div style={xpRow}>
          <div style={levelStyle}>LV {level}</div>
          <div style={xpBar}>
            <div style={{ ...xpFill, width: `${xpPct}%` }} />
          </div>
        </div>
      </div>
      <div style={hudLives}>
        {Array.from({ length: lives }).map((_, i) => (
          <div key={i} style={lifeIcon} />
        ))}
      </div>
      <div style={touchHint}>
        <div style={touchZoneLeft}>◄</div>
        <div style={touchZoneRight}>►</div>
      </div>
    </>
  )
}

const hudTop: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  color: '#cceeff',
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 11,
  textAlign: 'center',
  pointerEvents: 'none',
  userSelect: 'none',
  letterSpacing: '0.2em',
}

const scoreStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 22,
  marginTop: 6,
  fontWeight: 'normal',
  color: '#33ddff',
  textShadow: '0 0 8px rgba(51, 221, 255, 0.6)',
}

const xpRow: React.CSSProperties = {
  marginTop: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
}

const levelStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 10,
  color: '#aaffdd',
  letterSpacing: '0.15em',
}

const xpBar: React.CSSProperties = {
  width: 140,
  height: 6,
  background: 'rgba(51, 221, 255, 0.15)',
  border: '1px solid rgba(51, 221, 255, 0.4)',
  borderRadius: 3,
  overflow: 'hidden',
}

const xpFill: React.CSSProperties = {
  height: '100%',
  background: 'linear-gradient(90deg, #33ddff, #aaffdd)',
  boxShadow: '0 0 8px rgba(51, 221, 255, 0.6)',
  transition: 'width 0.15s ease-out',
}

const hudLives: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  display: 'flex',
  gap: 6,
  pointerEvents: 'none',
}

const lifeIcon: React.CSSProperties = {
  width: 18,
  height: 18,
  background: '#33ddff',
  clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
  boxShadow: '0 0 8px rgba(51, 221, 255, 0.6)',
}

const touchHint: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  pointerEvents: 'none',
  zIndex: -1,
}

const touchZoneLeft: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  paddingBottom: 24,
  fontSize: 32,
  color: 'rgba(255,255,255,0.08)',
  borderRight: '1px dashed rgba(255,255,255,0.05)',
}

const touchZoneRight: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  paddingBottom: 24,
  fontSize: 32,
  color: 'rgba(255,255,255,0.08)',
}
