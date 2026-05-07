import { Canvas, useThree } from '@react-three/fiber'
import { GameScene } from './GameScene'
import { HUD } from './HUD'
import { LevelUpOverlay } from './LevelUpOverlay'
import { BossUI } from './BossUI'
import { PauseControls } from './PauseMenu'
import { HighscorePanel } from './HighscorePanel'
import { getUpgrade, getUpgradeByCode, useGameStore, type RunBuild, type UpgradeId } from './store'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { startMusic, unlockAudio } from './audio'
import {
  connectToHighscoreServer,
  getUserId,
  subscribeHighscores,
  submitHighscore,
  type HighScoreEntry,
} from './highscore'

const CAMERA_CONFIG = { position: [0, 0, 10] as [number, number, number], zoom: 38, near: 0.1, far: 100 }
const FIT_WIDTH = 14.6
const FIT_HEIGHT = 20.6
const MAX_ZOOM = 38

function CameraFit() {
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera)
  useLayoutEffect(() => {
    if (!('isOrthographicCamera' in camera) || !camera.isOrthographicCamera) return
    const z = Math.min(MAX_ZOOM, size.width / FIT_WIDTH, size.height / FIT_HEIGHT)
    if (camera.zoom !== z) {
      camera.zoom = z
      camera.updateProjectionMatrix()
    }
  }, [size, camera])
  return null
}

export function App() {
  const started = useGameStore((s) => s.started)
  const gameOver = useGameStore((s) => s.gameOver)
  const startRaw = useGameStore((s) => s.start)
  const start = () => {
    unlockAudio()
    startMusic()
    startRaw()
  }

  useEffect(() => {
    ;(window as any).__gameState = useGameStore.getState()
    return useGameStore.subscribe((state) => {
      ;(window as any).__gameState = state
    })
  }, [])

  useEffect(() => {
    void connectToHighscoreServer()
  }, [])

  // Submit on each transition into gameOver (using the score/build snapshot in
  // store at that moment).
  const wasGameOverRef = useRef(false)
  useEffect(() => {
    return useGameStore.subscribe((state) => {
      if (state.gameOver && !wasGameOverRef.current) {
        submitHighscore(state.score, state.runBuild)
      }
      wasGameOverRef.current = state.gameOver
    })
  }, [])

  return (
    <>
      <Canvas orthographic camera={CAMERA_CONFIG}>
        <color attach="background" args={['#0a0820']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 8]} intensity={0.9} />
        <CameraFit />
        <GameScene />
      </Canvas>
      <HUD />
      <BossUI />
      <LevelUpOverlay />
      <PauseControls />
      {!started && !gameOver && <StartOverlay onStart={start} />}
      {gameOver && <GameOverOverlay onRestart={start} />}
    </>
  )
}

function StartOverlay({ onStart }: { onStart: () => void }) {
  return (
    <Overlay onClick={onStart}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <h1 style={titleStyle}>SKY STRIKE</h1>
        <p style={subtitleStyle}>Tap / click left or right side to move</p>
        <p style={subtitleStyle}>Auto-fire engaged. Survive the swarm.</p>
        <button style={buttonStyle}>Start</button>
        <HighscorePanel />
      </div>
    </Overlay>
  )
}

function GameOverOverlay({ onRestart }: { onRestart: () => void }) {
  const score = useGameStore((s) => s.score)
  const highScore = useGameStore((s) => s.highScore)
  const runBuild = useGameStore((s) => s.runBuild)
  const [scores, setScores] = useState<HighScoreEntry[]>([])
  useEffect(() => subscribeHighscores(setScores), [])

  const myId = getUserId()
  const better = scores.filter((s) => s.score > score && s.userId !== myId).length
  const rank = 1 + better
  const total = Math.max(scores.length, rank)

  return (
    <Overlay onClick={onRestart}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <h1 style={{ ...titleStyle, color: '#ff5577', marginBottom: '0.6rem' }}>GAME OVER</h1>
        <button style={{ ...buttonStyle, marginTop: 0 }} onClick={onRestart}>
          Play Again
        </button>
        <HighscorePanel />
        <div style={statRowStyle}>
          <StatBlock label="SCORE" value={formatStatNumber(score)} />
          <StatBlock label="RANK" value={`#${rank} / ${total}`} accent />
          <StatBlock label="BEST" value={formatStatNumber(highScore)} />
        </div>
        <BuildSummary build={runBuild} />
      </div>
    </Overlay>
  )
}

function StatBlock({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={statBlockStyle}>
      <div style={statLabelStyle}>{label}</div>
      <div style={accent ? statValueAccentStyle : statValueStyle}>{value}</div>
    </div>
  )
}

function BuildSummary({ build }: { build: RunBuild }) {
  const items = Object.entries(build).sort((a, b) => b[1] - a[1])
  if (items.length === 0) return null
  return (
    <div style={buildPanelStyle}>
      <div style={buildGridStyle}>
        {items.map(([key, count]) => {
          const def = getUpgradeByCode(key) ?? safeGetUpgrade(key)
          const label = def?.name ?? key
          return (
            <div key={key} style={buildBadgeStyle}>
              <span style={buildBadgeNameStyle}>{label}</span>
              <span style={buildBadgeCountStyle}>×{count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function safeGetUpgrade(key: string) {
  try {
    return getUpgrade(key as UpgradeId) ?? null
  } catch {
    return null
  }
}

function formatStatNumber(n: number): string {
  return n.toString().padStart(6, '0')
}

function Overlay({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        background: 'rgba(5, 5, 20, 0.75)',
        color: 'white',
        cursor: 'pointer',
        fontFamily: "'Orbitron', system-ui, sans-serif",
        userSelect: 'none',
        overflowY: 'auto',
        padding: '24px 12px',
      }}
    >
      {children}
    </div>
  )
}

const titleStyle: React.CSSProperties = {
  margin: '0 0 1.2rem',
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 'clamp(1.4rem, 6vw, 3rem)',
  letterSpacing: '0.18em',
  color: '#33ddff',
  textShadow: '0 0 16px rgba(51, 221, 255, 0.6)',
  lineHeight: 1.2,
}

const subtitleStyle: React.CSSProperties = {
  margin: '0.4rem 0',
  fontFamily: "'Orbitron', system-ui, sans-serif",
  fontSize: 'clamp(0.85rem, 2.5vw, 1.1rem)',
  letterSpacing: '0.05em',
  color: '#cccccc',
}

const buttonStyle: React.CSSProperties = {
  marginTop: '1.5rem',
  padding: '0.85rem 2rem',
  fontSize: '1rem',
  fontFamily: "'Press Start 2P', monospace",
  background: '#33ddff',
  color: '#08203a',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: 'bold',
  letterSpacing: '0.1em',
}

const cardStyle: React.CSSProperties = {
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  cursor: 'default',
  width: 'min(440px, 96vw)',
}

const statRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  width: '100%',
  marginTop: '0.4rem',
  marginBottom: '0.8rem',
}

const statBlockStyle: React.CSSProperties = {
  flex: 1,
  background: 'rgba(8, 14, 38, 0.78)',
  border: '1.5px solid rgba(51, 221, 255, 0.55)',
  borderRadius: 8,
  padding: '8px 6px',
  boxShadow: '0 0 14px rgba(51, 221, 255, 0.18)',
}

const statLabelStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 9,
  color: '#88aabb',
  letterSpacing: '0.18em',
  marginBottom: 6,
}

const statValueStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 14,
  color: '#cceeff',
  letterSpacing: '0.05em',
}

const statValueAccentStyle: React.CSSProperties = {
  ...statValueStyle,
  color: '#aaffdd',
  textShadow: '0 0 10px rgba(170, 255, 221, 0.55)',
}

const buildPanelStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(8, 14, 38, 0.78)',
  border: '1.5px solid rgba(51, 221, 255, 0.55)',
  borderRadius: 10,
  padding: '12px 14px',
  boxShadow: '0 0 18px rgba(51, 221, 255, 0.2)',
  marginBottom: '0.4rem',
}

const buildGridStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 6,
}

const buildBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 6,
  padding: '4px 8px',
  borderRadius: 4,
  background: 'rgba(51, 221, 255, 0.08)',
  border: '1px solid rgba(51, 221, 255, 0.3)',
  fontSize: 12,
  color: '#cceeff',
}

const buildBadgeNameStyle: React.CSSProperties = {
  fontFamily: "'Orbitron', system-ui, sans-serif",
  letterSpacing: '0.04em',
}

const buildBadgeCountStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 9,
  color: '#33ddff',
}
