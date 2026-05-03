export interface Particle {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
  drag: number
  shape: 'spark' | 'puff' | 'ring'
}

let nextParticleId = 1
const particles: Particle[] = []
let shakeIntensity = 0
let shakeTime = 0
let shakeDuration = 0
let shakeX = 0
let shakeY = 0

export function getParticles(): Particle[] {
  return particles
}

export function clearEffects() {
  particles.length = 0
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

function emit(p: Omit<Particle, 'id'>) {
  particles.push({ id: nextParticleId++, ...p })
}

export function addMuzzleFlash(x: number, y: number) {
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 2 + (Math.random() - 0.5) * 0.6
    const speed = 3 + Math.random() * 3
    emit({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.12,
      maxLife: 0.12,
      size: 0.15 + Math.random() * 0.1,
      color: '#aaffdd',
      drag: 6,
      shape: 'spark',
    })
  }
  emit({
    x,
    y,
    vx: 0,
    vy: 0,
    life: 0.08,
    maxLife: 0.08,
    size: 0.45,
    color: '#ffffff',
    drag: 0,
    shape: 'puff',
  })
}

export function addHitSparks(x: number, y: number, color: string) {
  for (let i = 0; i < 8; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 4 + Math.random() * 4
    emit({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.25 + Math.random() * 0.1,
      maxLife: 0.35,
      size: 0.12 + Math.random() * 0.08,
      color,
      drag: 4,
      shape: 'spark',
    })
  }
  emit({
    x,
    y,
    vx: 0,
    vy: 0,
    life: 0.12,
    maxLife: 0.12,
    size: 0.5,
    color: '#ffffff',
    drag: 0,
    shape: 'puff',
  })
}

export function addExplosion(x: number, y: number, color: string) {
  for (let i = 0; i < 22; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 3 + Math.random() * 8
    emit({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.45 + Math.random() * 0.35,
      maxLife: 0.8,
      size: 0.18 + Math.random() * 0.18,
      color: Math.random() < 0.5 ? color : '#ffcc44',
      drag: 2.2,
      shape: 'spark',
    })
  }
  for (let i = 0; i < 6; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 1 + Math.random() * 2
    emit({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.6 + Math.random() * 0.3,
      maxLife: 0.9,
      size: 0.4 + Math.random() * 0.3,
      color: '#882211',
      drag: 1.5,
      shape: 'puff',
    })
  }
  emit({
    x,
    y,
    vx: 0,
    vy: 0,
    life: 0.18,
    maxLife: 0.18,
    size: 1.0,
    color: '#ffffff',
    drag: 0,
    shape: 'puff',
  })
}

export function addPlayerHit(x: number, y: number) {
  for (let i = 0; i < 16; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 3 + Math.random() * 6
    emit({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.4 + Math.random() * 0.3,
      maxLife: 0.7,
      size: 0.15 + Math.random() * 0.15,
      color: Math.random() < 0.5 ? '#33ddff' : '#ffffff',
      drag: 2.5,
      shape: 'spark',
    })
  }
  emit({
    x,
    y,
    vx: 0,
    vy: 0,
    life: 0.2,
    maxLife: 0.2,
    size: 1.2,
    color: '#33ddff',
    drag: 0,
    shape: 'puff',
  })
}

export function addSpawnRing(x: number, y: number, color: string) {
  emit({
    x,
    y,
    vx: 0,
    vy: 0,
    life: 0.35,
    maxLife: 0.35,
    size: 0.3,
    color,
    drag: 0,
    shape: 'ring',
  })
  for (let i = 0; i < 6; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 1 + Math.random() * 2
    emit({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.3,
      maxLife: 0.3,
      size: 0.1 + Math.random() * 0.06,
      color,
      drag: 3,
      shape: 'spark',
    })
  }
}

export function updateEffects(dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.life -= dt
    if (p.life <= 0) {
      particles.splice(i, 1)
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
