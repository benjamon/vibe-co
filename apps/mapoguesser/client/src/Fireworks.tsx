import { useEffect, useRef } from 'react'
import { sfxFirework } from './sfx'

// Full-screen fireworks for a perfect score. Shells launch from the bottom,
// arc up, and burst into a ring of fading sparks at apex. Pure canvas +
// requestAnimationFrame (same approach as Confetti) so it costs nothing when
// unmounted, and self-terminates (calling onDone) once the last spark fades.

const COLORS = [
  '#ffd93b',
  '#ff5e5e',
  '#5ec8ff',
  '#7cff8a',
  '#c98bff',
  '#ff8fd0',
  '#ffffff',
]

interface Shell {
  x: number
  y: number
  vy: number
  burstY: number // explode once the shell rises past this height
  color: string
  exploded: boolean
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  color: string
  life: number // 1 → 0
  decay: number
}

const GRAVITY = 320 // px/s²

export function Fireworks({ onDone }: { onDone?: () => void }) {
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

    const shells: Shell[] = []
    const sparks: Spark[] = []

    // Schedule a handful of shells over the first ~2.6s, staggered and spread
    // across the width so the bursts don't all stack in one spot.
    const LAUNCHES = 7
    const launchTimes: number[] = []
    for (let i = 0; i < LAUNCHES; i++) {
      launchTimes.push(0.15 + i * 0.35 + Math.random() * 0.18)
    }
    let launchIdx = 0

    const launchShell = () => {
      const color = COLORS[(Math.random() * COLORS.length) | 0]
      // Burst somewhere in the upper 15–55% of the screen.
      const burstY = H * (0.15 + Math.random() * 0.4)
      shells.push({
        x: W * (0.15 + Math.random() * 0.7),
        y: H,
        vy: -(620 + Math.random() * 220),
        burstY,
        color,
        exploded: false,
      })
    }

    const explode = (s: Shell) => {
      sfxFirework()
      const count = 46 + ((Math.random() * 24) | 0)
      const baseSpeed = 130 + Math.random() * 90
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.12
        const speed = baseSpeed * (0.55 + Math.random() * 0.6)
        sparks.push({
          x: s.x,
          y: s.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: s.color,
          life: 1,
          decay: 0.45 + Math.random() * 0.5,
        })
      }
    }

    let raf = 0
    let prev = 0
    let elapsed = 0

    const frame = (t: number) => {
      if (!prev) prev = t
      const dt = Math.min((t - prev) / 1000, 0.05)
      prev = t
      elapsed += dt

      while (launchIdx < launchTimes.length && elapsed >= launchTimes[launchIdx]) {
        launchShell()
        launchIdx++
      }

      // Trails: erase a little alpha from the previous frame so sparks leave a
      // fading comet tail. 'destination-out' fades the canvas toward
      // transparent (revealing the globe behind it) rather than painting black
      // over the page — the fill colour is irrelevant, only its alpha matters.
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0, 0, 0, 0.30)'
      ctx.fillRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'lighter'

      for (const s of shells) {
        if (s.exploded) continue
        s.vy += GRAVITY * dt
        s.y += s.vy * dt
        if (s.y <= s.burstY || s.vy >= 0) {
          s.exploded = true
          explode(s)
          continue
        }
        ctx.fillStyle = s.color
        ctx.beginPath()
        ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }

      let aliveSparks = 0
      for (const p of sparks) {
        if (p.life <= 0) continue
        aliveSparks++
        p.vy += GRAVITY * dt
        p.vx *= 0.985
        p.vy *= 0.985
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.life -= p.decay * dt
        const a = Math.max(0, p.life)
        ctx.globalAlpha = a
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      const pending = launchIdx < launchTimes.length || shells.some((s) => !s.exploded)
      // Done once nothing is left to launch or animate (hard 7s cap as backstop).
      if ((!pending && aliveSparks === 0) || elapsed > 7) {
        ctx.globalCompositeOperation = 'source-over'
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
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 51,
      }}
    />
  )
}
