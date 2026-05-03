import { Canvas } from '@react-three/fiber'
import { GameScene } from './GameScene'
import { HUD } from './HUD'
import { useGameStore } from './store'
import { useEffect } from 'react'
import { unlockAudio } from './audio'

export function App() {
  const started = useGameStore((s) => s.started)
  const gameOver = useGameStore((s) => s.gameOver)
  const score = useGameStore((s) => s.score)
  const highScore = useGameStore((s) => s.highScore)
  const startRaw = useGameStore((s) => s.start)
  const start = () => {
    unlockAudio()
    startRaw()
  }

  useEffect(() => {
    ;(window as any).__gameState = useGameStore.getState()
    return useGameStore.subscribe((state) => {
      ;(window as any).__gameState = state
    })
  }, [])

  return (
    <>
      <Canvas
        orthographic
        camera={{ position: [0, 0, 10], zoom: 38, near: 0.1, far: 100 }}
      >
        <color attach="background" args={['#0a0820']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 8]} intensity={0.9} />
        <GameScene />
      </Canvas>
      <HUD />
      {!started && !gameOver && (
        <Overlay onClick={start}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={titleStyle}>SKY STRIKE</h1>
            <p style={subtitleStyle}>Tap / click left or right side to move</p>
            <p style={subtitleStyle}>Auto-fire engaged. Survive the swarm.</p>
            <button style={buttonStyle}>Start</button>
          </div>
        </Overlay>
      )}
      {gameOver && (
        <Overlay onClick={start}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ ...titleStyle, color: '#ff5577' }}>GAME OVER</h1>
            <p style={subtitleStyle}>Score: {score}</p>
            <p style={subtitleStyle}>Best: {highScore}</p>
            <button style={buttonStyle}>Play Again</button>
          </div>
        </Overlay>
      )}
    </>
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
        fontFamily: 'system-ui, sans-serif',
        userSelect: 'none',
      }}
    >
      {children}
    </div>
  )
}

const titleStyle: React.CSSProperties = {
  margin: '0 0 1rem',
  fontSize: 'clamp(2rem, 8vw, 4rem)',
  letterSpacing: '0.2em',
  color: '#33ddff',
  textShadow: '0 0 16px rgba(51, 221, 255, 0.6)',
}

const subtitleStyle: React.CSSProperties = {
  margin: '0.4rem 0',
  fontSize: 'clamp(0.9rem, 3vw, 1.2rem)',
  color: '#cccccc',
}

const buttonStyle: React.CSSProperties = {
  marginTop: '1.5rem',
  padding: '0.8rem 2rem',
  fontSize: '1.2rem',
  background: '#33ddff',
  color: '#08203a',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: 'bold',
  letterSpacing: '0.1em',
}
