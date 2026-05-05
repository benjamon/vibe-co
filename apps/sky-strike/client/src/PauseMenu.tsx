import { useEffect } from 'react'
import { useGameStore } from './store'
import { setMasterVolume, setMusicVolume, setSfxVolume } from './audio'

export function PauseControls() {
  const started = useGameStore((s) => s.started)
  const gameOver = useGameStore((s) => s.gameOver)
  const userPaused = useGameStore((s) => s.userPaused)
  const setUserPaused = useGameStore((s) => s.setUserPaused)
  const toggleUserPaused = useGameStore((s) => s.toggleUserPaused)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'p' && e.key !== 'P') return
      const s = useGameStore.getState()
      if (!s.started || s.gameOver) return
      toggleUserPaused()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleUserPaused])

  useEffect(() => {
    return useGameStore.subscribe((state, prev) => {
      if (state.masterVolume !== prev.masterVolume) setMasterVolume(state.masterVolume)
      if (state.sfxVolume !== prev.sfxVolume) setSfxVolume(state.sfxVolume)
      if (state.musicVolume !== prev.musicVolume) setMusicVolume(state.musicVolume)
    })
  }, [])

  useEffect(() => {
    const s = useGameStore.getState()
    setMasterVolume(s.masterVolume)
    setSfxVolume(s.sfxVolume)
    setMusicVolume(s.musicVolume)
  }, [])

  const showGear = started && !gameOver

  return (
    <>
      {showGear && (
        <button
          aria-label="Pause and open settings"
          onClick={() => setUserPaused(true)}
          style={gearButtonStyle}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      )}
      {userPaused && <PauseMenu onResume={() => setUserPaused(false)} />}
    </>
  )
}

function PauseMenu({ onResume }: { onResume: () => void }) {
  const master = useGameStore((s) => s.masterVolume)
  const sfx = useGameStore((s) => s.sfxVolume)
  const music = useGameStore((s) => s.musicVolume)
  const setMaster = useGameStore((s) => s.setMasterVolume)
  const setSfx = useGameStore((s) => s.setSfxVolume)
  const setMusic = useGameStore((s) => s.setMusicVolume)

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <div style={titleStyle}>PAUSED</div>
        <Slider label="Master" value={master} onChange={setMaster} />
        <Slider label="SFX" value={sfx} onChange={setSfx} />
        <Slider label="Music" value={music} onChange={setMusic} />
        <button onClick={onResume} style={resumeButtonStyle}>
          RESUME
        </button>
        <div style={hintStyle}>Press P to resume</div>
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div style={sliderRowStyle}>
      <div style={sliderLabelStyle}>{label}</div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={sliderInputStyle}
      />
      <div style={sliderValueStyle}>{Math.round(value * 100)}</div>
    </div>
  )
}

const gearButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 14,
  right: 14,
  width: 38,
  height: 38,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(8, 14, 38, 0.85)',
  border: '2px solid rgba(51, 221, 255, 0.6)',
  borderRadius: 8,
  color: '#33ddff',
  cursor: 'pointer',
  padding: 0,
  zIndex: 12,
  boxShadow: '0 0 12px rgba(51, 221, 255, 0.35)',
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(5, 8, 24, 0.78)',
  zIndex: 20,
  fontFamily: "'Orbitron', system-ui, sans-serif",
}

const panelStyle: React.CSSProperties = {
  background: 'rgba(8, 14, 38, 0.95)',
  border: '2px solid #33ddff',
  borderRadius: 12,
  padding: '28px 32px',
  minWidth: 320,
  maxWidth: 'min(420px, 90vw)',
  boxShadow: '0 0 32px rgba(51, 221, 255, 0.35)',
  color: '#cceeff',
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 18,
  letterSpacing: '0.3em',
  color: '#33ddff',
  textAlign: 'center',
  marginBottom: 22,
  textShadow: '0 0 10px rgba(51, 221, 255, 0.6)',
}

const sliderRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  margin: '12px 0',
}

const sliderLabelStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 10,
  letterSpacing: '0.18em',
  color: '#aaccdd',
  width: 64,
}

const sliderInputStyle: React.CSSProperties = {
  flex: 1,
  accentColor: '#33ddff',
  cursor: 'pointer',
}

const sliderValueStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 10,
  color: '#33ddff',
  width: 28,
  textAlign: 'right',
}

const resumeButtonStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 22,
  padding: '12px 0',
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 12,
  letterSpacing: '0.2em',
  background: '#33ddff',
  color: '#08203a',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 'bold',
}

const hintStyle: React.CSSProperties = {
  marginTop: 12,
  textAlign: 'center',
  fontSize: 11,
  color: 'rgba(170, 200, 220, 0.55)',
  letterSpacing: '0.15em',
}
