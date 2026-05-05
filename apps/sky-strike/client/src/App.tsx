import { Canvas, useThree } from '@react-three/fiber'
import { GameScene } from './GameScene'
import { HUD } from './HUD'
import { LevelUpOverlay } from './LevelUpOverlay'
import { BossUI } from './BossUI'
import { PauseControls } from './PauseMenu'
import { HighscorePanel } from './HighscorePanel'
import { useGameStore } from './store'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { startMusic, unlockAudio } from './audio'
import { connectToHighscoreServer, submitHighscore } from './highscore'

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
  return (
    <Overlay onClick={onRestart}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <h1 style={{ ...titleStyle, color: '#ff5577' }}>GAME OVER</h1>
        <p style={subtitleStyle}>Score: {score}</p>
        <p style={subtitleStyle}>Best: {highScore}</p>
        <button style={buttonStyle}>Play Again</button>
        <HighscorePanel />
      </div>
    </Overlay>
  )
}

function Overlay({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(5, 5, 20, 0.75)',
        color: 'white',
        cursor: 'pointer',
        fontFamily: "'Orbitron', system-ui, sans-serif",
        userSelect: 'none',
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
