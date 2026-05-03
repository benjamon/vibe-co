export type ParticleShape = 0 | 1 | 2 // 0 = spark, 1 = puff, 2 = ring

export interface Particle {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  r: number
  g: number
  b: number
  drag: number
  shape: ParticleShape
}

const POOL_SIZE = 600

const particles: Particle[] = []
for (let i = 0; i < POOL_SIZE; i++) {
  particles.push({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 0,
    size: 0,
    r: 0,
    g: 0,
    b: 0,
    drag: 0,
    shape: 0,
  })
}

let nextSlot = 0
let shakeIntensity = 0
let shakeTime = 0
let shakeDuration = 0
let shakeX = 0
let shakeY = 0

const colorCache = new Map<string, [number, number, number]>()

function colorRGB(hex: string): [number, number, number] {
  let cached = colorCache.get(hex)
  if (cached) return cached
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  cached = [r, g, b]
  colorCache.set(hex, cached)
  return cached
}

function emit(
  x: number,
  y: number,
  vx: number,
  vy: number,
  life: number,
  maxLife: number,
  size: number,
  hex: string,
  drag: number,
  shape: ParticleShape,
) {
  for (let i = 0; i < POOL_SIZE; i++) {
    const idx = (nextSlot + i) % POOL_SIZE
    const p = particles[idx]
    if (!p.active) {
      p.active = true
      p.x = x
      p.y = y
      p.vx = vx
      p.vy = vy
      p.life = life
      p.maxLife = maxLife
      p.size = size
      const rgb = colorRGB(hex)
      p.r = rgb[0]
      p.g = rgb[1]
      p.b = rgb[2]
      p.drag = drag
      p.shape = shape
      nextSlot = (idx + 1) % POOL_SIZE
      return
    }
  }
}

export function getParticles(): Particle[] {
  return particles
}

export function clearEffects() {
  for (let i = 0; i < POOL_SIZE; i++) particles[i].active = false
  shakeIntensity = 0
  shakeTime = 0
  shakeDuration = 0
  shakeX = 0
  shakeY = 0
}

export function addShake(intensity: number, duration: number) {
  if (intensity > shakeIntensity * (shakeTime / Math.max(0.0001, shakeDuration))) {
    shakeIntensity = intensity
    shakeDuration = duration
    shakeTime = duration
  }
}

export function getShake(): [number, number] {
  return [shakeX, shakeY]
}

export function addMuzzleFlash(x: number, y: number) {
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 2 + (Math.random() - 0.5) * 0.6
    const speed = 3 + Math.random() * 3
    emit(
      x,
      y,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      0.12,
      0.12,
      0.15 + Math.random() * 0.1,
      '#aaffdd',
      6,
      0,
    )
  }
  emit(x, y, 0, 0, 0.08, 0.08, 0.45, '#ffffff', 0, 1)
}

export function addHitSparks(x: number, y: number, color: string) {
  for (let i = 0; i < 8; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 4 + Math.random() * 4
    emit(
      x,
      y,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      0.25 + Math.random() * 0.1,
      0.35,
      0.12 + Math.random() * 0.08,
      color,
      4,
      0,
    )
  }
  emit(x, y, 0, 0, 0.12, 0.12, 0.5, '#ffffff', 0, 1)
}

export function addExplosion(x: number, y: number, color: string) {
  for (let i = 0; i < 22; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 3 + Math.random() * 8
    emit(
      x,
      y,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      0.45 + Math.random() * 0.35,
      0.8,
      0.18 + Math.random() * 0.18,
      Math.random() < 0.5 ? color : '#ffcc44',
      2.2,
      0,
    )
  }
  for (let i = 0; i < 6; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 1 + Math.random() * 2
    emit(
      x,
      y,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      0.6 + Math.random() * 0.3,
      0.9,
      0.4 + Math.random() * 0.3,
      '#882211',
      1.5,
      1,
    )
  }
  emit(x, y, 0, 0, 0.18, 0.18, 1.0, '#ffffff', 0, 1)
}

export function addPlayerHit(x: number, y: number) {
  for (let i = 0; i < 16; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 3 + Math.random() * 6
    emit(
      x,
      y,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      0.4 + Math.random() * 0.3,
      0.7,
      0.15 + Math.random() * 0.15,
      Math.random() < 0.5 ? '#33ddff' : '#ffffff',
      2.5,
      0,
    )
  }
  emit(x, y, 0, 0, 0.2, 0.2, 1.2, '#33ddff', 0, 1)
}

export function addSpawnRing(x: number, y: number, color: string) {
  emit(x, y, 0, 0, 0.35, 0.35, 0.3, color, 0, 2)
  for (let i = 0; i < 6; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 1 + Math.random() * 2
    emit(
      x,
      y,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      0.3,
      0.3,
      0.1 + Math.random() * 0.06,
      color,
      3,
      0,
    )
  }
}

export function updateEffects(dt: number) {
  for (let i = 0; i < POOL_SIZE; i++) {
    const p = particles[i]
    if (!p.active) continue
    p.life -= dt
    if (p.life <= 0) {
      p.active = false
      continue
    }
    p.x += p.vx * dt
    p.y += p.vy * dt
    if (p.drag > 0) {
      const k = Math.max(0, 1 - p.drag * dt)
      p.vx *= k
      p.vy *= k
    }
  }

  if (shakeTime > 0) {
    shakeTime -= dt
    if (shakeTime <= 0) {
      shakeTime = 0
      shakeX = 0
      shakeY = 0
    } else {
      const t = shakeIntensity * (shakeTime / shakeDuration)
      shakeX = (Math.random() * 2 - 1) * t
      shakeY = (Math.random() * 2 - 1) * t
    }
  }
}
