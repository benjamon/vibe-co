import { useEffect, useRef } from 'react'

// Full-screen confetti that sprays up from the bottom corners and flutters
// back down under gravity. Pure canvas + requestAnimationFrame so it costs
// nothing when not mounted; self-terminates (and calls onDone) once every
// piece has fallen off the bottom of the screen.

const COLORS = [
  '#3fb84e',
  '#e64545',
  '#f5c542',
  '#4a90e2',
  '#9b59b6',
  '#ff7fb0',
  '#ffffff',
]

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  rot: number
  vrot: number
  swayPhase: number
  swayAmp: number
}

export function Confetti({
  onDone,
  intensity = 'full',
}: {
  onDone?: () => void
  // 'small' is a lighter burst (fewer pieces) for a good-but-not-great score;
  // 'full' is the celebratory blast.
  intensity?: 'small' | 'full'
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let W = window.innerWidth
    let H = window.innerHeight
    const resize = () => {
      W = window.innerWidth
      H = window.innerHeight
      canvas.width = W * dpr
      canvas.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    // Launch from the two bottom corners, each fountain aimed up and inward.
    const pieces: Piece[] = []
    const PER_SIDE = intensity === 'small' ? 28 : 90
    const spawnSide = (originX: number, inward: number) => {
      for (let i = 0; i < PER_SIDE; i++) {
        // Speed 650–1150 px/s; angle within ~35° of straight up, biased toward
        // screen centre by `inward` (+1 from the left, -1 from the right).
        const speed = 650 + Math.random() * 500
        const angle = (Math.random() - 0.5) * 0.6 * Math.PI * 0.4
        const dir = -Math.PI / 2 + angle + inward * 0.35
        pieces.push({
          x: originX + (Math.random() - 0.5) * 80,
          y: H + Math.random() * 20,
          vx: Math.cos(dir) * speed,
          vy: Math.sin(dir) * speed,
          size: 6 + Math.random() * 7,
          color: COLORS[(Math.random() * COLORS.length) | 0],
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 12,
          swayPhase: Math.random() * Math.PI * 2,
          swayAmp: 12 + Math.random() * 24,
        })
      }
    }
    spawnSide(W * 0.08, 1)
    spawnSide(W * 0.92, -1)

    const GRAVITY = 900 // px/s²
    const DRAG = 0.98
    let raf = 0
    let prev = 0
    let elapsed = 0

    const frame = (t: number) => {
      if (!prev) prev = t
      const dt = Math.min((t - prev) / 1000, 0.05)
      prev = t
      elapsed += dt

      ctx.clearRect(0, 0, W, H)
      let alive = 0
      for (const p of pieces) {
        p.vy += GRAVITY * dt
        p.vx *= DRAG
        p.vy *= DRAG
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.swayPhase += dt * 4
        p.rot += p.vrot * dt
        const sway = Math.sin(p.swayPhase) * p.swayAmp * dt

        // Still on screen (or hasn't peaked yet) → keep animating.
        if (p.y < H + 40) alive++

        ctx.save()
        ctx.translate(p.x + sway, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        // Flutter: scale width by the sway so pieces look like spinning flakes.
        const w = p.size * (0.5 + 0.5 * Math.abs(Math.cos(p.swayPhase)))
        ctx.fillRect(-w / 2, -p.size / 2, w, p.size)
        ctx.restore()
      }

      // Stop once everything has fallen past the bottom (or a hard 8s cap).
      if (alive === 0 || elapsed > 8) {
        ctx.clearRect(0, 0, W, H)
        onDoneRef.current?.()
        return
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [intensity])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    />
  )
}
