import { useGameStore } from './store'

export function HUD() {
  const started = useGameStore((s) => s.started)
  const score = useGameStore((s) => s.score)
  const lives = useGameStore((s) => s.lives)

  if (!started) return null

  return (
    <>
      <div style={hudTop}>
        <div>SCORE</div>
        <div style={scoreStyle}>{score.toString().padStart(6, '0')}</div>
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
  fontFamily: 'monospace',
  fontSize: '14px',
  textAlign: 'center',
  pointerEvents: 'none',
  userSelect: 'none',
  letterSpacing: '0.2em',
}

const scoreStyle: React.CSSProperties = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#33ddff',
  textShadow: '0 0 8px rgba(51, 221, 255, 0.6)',
}

const hudLives: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  display: 'flex',
  gap: '6px',
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
  fontSize: '32px',
  color: 'rgba(255,255,255,0.08)',
  borderRight: '1px dashed rgba(255,255,255,0.05)',
}

const touchZoneRight: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  paddingBottom: 24,
  fontSize: '32px',
  color: 'rgba(255,255,255,0.08)',
}
