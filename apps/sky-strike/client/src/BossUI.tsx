import { useGameStore } from './store'

export function BossUI() {
  const started = useGameStore((s) => s.started)
  const warning = useGameStore((s) => s.bossWarning)
  const hp = useGameStore((s) => s.bossHp)
  const maxHp = useGameStore((s) => s.bossMaxHp)
  const progress = useGameStore((s) => s.bossProgress)
  const dangerMessage = useGameStore((s) => s.dangerMessage)

  const pct = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) * 100 : 0
  const showCountdown = started && maxHp <= 0 && !warning

  return (
    <>
      <style>{KEYFRAMES}</style>
      {warning && <div style={warningStyle}>⚠ ANOMALY APPROACHING ⚠</div>}
      {dangerMessage && (
        <div key={dangerMessage} style={dangerStyle}>
          {dangerMessage}
        </div>
      )}
      {maxHp > 0 && hp > 0 && (
        <div style={hpRowStyle}>
          <div style={hpLabelStyle}>BOSS</div>
          <div style={hpBarContainer}>
            <div style={{ ...hpBarFill, width: `${pct}%` }} />
          </div>
        </div>
      )}
      {showCountdown && (
        <div style={countdownRowStyle}>
          <div style={countdownLabelStyle}>NEXT BOSS</div>
          <div style={countdownBarContainer}>
            <div style={{ ...countdownBarFill, width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} />
          </div>
        </div>
      )}
    </>
  )
}

const KEYFRAMES = `
@keyframes bossWarn {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
@keyframes dangerPulse {
  0% { opacity: 0; letter-spacing: 0.7em; filter: blur(5px); transform: translateY(-10px); }
  17% { opacity: 1; letter-spacing: 0.32em; filter: blur(0); transform: translateY(0); }
  83% { opacity: 1; letter-spacing: 0.32em; filter: blur(0); transform: translateY(0); }
  100% { opacity: 0; letter-spacing: 0.5em; filter: blur(3px); transform: translateY(0); }
}
`

const dangerStyle: React.CSSProperties = {
  position: 'absolute',
  top: '28%',
  left: 0,
  right: 0,
  textAlign: 'center',
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 'clamp(10px, 1.8vw, 16px)',
  color: '#cc3344',
  letterSpacing: '0.25em',
  textShadow: '0 0 12px rgba(180, 30, 50, 0.85), 0 0 2px rgba(0, 0, 0, 0.9)',
  pointerEvents: 'none',
  userSelect: 'none',
  zIndex: 4,
  animation: 'dangerPulse 3s ease-out forwards',
}

const warningStyle: React.CSSProperties = {
  position: 'absolute',
  top: '38%',
  left: 0,
  right: 0,
  textAlign: 'center',
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 'clamp(13px, 2.8vw, 24px)',
  color: '#ff3344',
  letterSpacing: '0.25em',
  textShadow: '0 0 18px rgba(255, 50, 80, 0.9)',
  pointerEvents: 'none',
  userSelect: 'none',
  zIndex: 5,
  animation: 'bossWarn 0.55s linear infinite',
}

const hpRowStyle: React.CSSProperties = {
  position: 'absolute',
  top: 90,
  left: '8%',
  right: '8%',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  pointerEvents: 'none',
  zIndex: 4,
}

const hpLabelStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 12,
  letterSpacing: '0.25em',
  color: '#ff8899',
  textShadow: '0 0 8px rgba(255, 50, 80, 0.7)',
}

const hpBarContainer: React.CSSProperties = {
  flex: 1,
  height: 10,
  background: 'rgba(40, 0, 12, 0.5)',
  border: '1px solid rgba(255, 50, 80, 0.6)',
  borderRadius: 5,
  overflow: 'hidden',
}

const hpBarFill: React.CSSProperties = {
  height: '100%',
  background: 'linear-gradient(90deg, #ff3344, #ff8866)',
  boxShadow: '0 0 12px rgba(255, 80, 100, 0.8)',
  transition: 'width 0.15s ease-out',
}

const countdownRowStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 14,
  left: '14%',
  right: '14%',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  pointerEvents: 'none',
  zIndex: 4,
}

const countdownLabelStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 11,
  letterSpacing: '0.25em',
  color: 'rgba(255, 120, 140, 0.65)',
  textShadow: '0 0 6px rgba(255, 50, 80, 0.4)',
}

const countdownBarContainer: React.CSSProperties = {
  flex: 1,
  height: 4,
  background: 'rgba(40, 0, 12, 0.4)',
  border: '1px solid rgba(255, 50, 80, 0.35)',
  borderRadius: 2,
  overflow: 'hidden',
}

const countdownBarFill: React.CSSProperties = {
  height: '100%',
  background: 'linear-gradient(90deg, rgba(255,80,100,0.6), #ff3344)',
  boxShadow: '0 0 6px rgba(255, 60, 90, 0.6)',
  transition: 'width 1.5s linear',
}
