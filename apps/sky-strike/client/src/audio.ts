let ctx: AudioContext | null = null
let masterGain: GainNode | null = null

function getCtx(): AudioContext | null {
  if (ctx) return ctx
  const Ctor =
    typeof window !== 'undefined'
      ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined
  if (!Ctor) return null
  ctx = new Ctor()
  masterGain = ctx.createGain()
  masterGain.gain.value = 0.35
  masterGain.connect(ctx.destination)
  return ctx
}

export function unlockAudio() {
  const c = getCtx()
  if (c && c.state === 'suspended') void c.resume()
}

interface ToneOpts {
  type?: OscillatorType
  freq: number
  freqEnd?: number
  duration: number
  attack?: number
  volume?: number
  detune?: number
  delay?: number
}

function tone({ type = 'square', freq, freqEnd, duration, attack = 0.005, volume = 0.5, detune = 0, delay = 0 }: ToneOpts) {
  const c = getCtx()
  if (!c || !masterGain) return
  const start = c.currentTime + delay
  const osc = c.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), start + duration)
  }
  if (detune) osc.detune.setValueAtTime(detune, start)
  const gain = c.createGain()
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(volume, start + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain).connect(masterGain)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

interface NoiseOpts {
  duration: number
  volume?: number
  filterFreq?: number
  filterType?: BiquadFilterType
}

function noise({ duration, volume = 0.4, filterFreq = 1200, filterType = 'lowpass' }: NoiseOpts) {
  const c = getCtx()
  if (!c || !masterGain) return
  const now = c.currentTime
  const len = Math.max(1, Math.floor(c.sampleRate * duration))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buf
  const filt = c.createBiquadFilter()
  filt.type = filterType
  filt.frequency.value = filterFreq
  const gain = c.createGain()
  gain.gain.setValueAtTime(volume, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  src.connect(filt).connect(gain).connect(masterGain)
  src.start(now)
  src.stop(now + duration + 0.02)
}

let lastShoot = 0
export function playShoot() {
  const c = getCtx()
  if (!c) return
  if (c.currentTime - lastShoot < 0.04) return
  lastShoot = c.currentTime
  tone({ type: 'square', freq: 880, freqEnd: 320, duration: 0.08, volume: 0.18 })
  tone({ type: 'sawtooth', freq: 440, freqEnd: 160, duration: 0.06, volume: 0.08, detune: 8 })
}

export function playHit() {
  tone({ type: 'square', freq: 220, freqEnd: 90, duration: 0.08, volume: 0.22 })
  noise({ duration: 0.05, volume: 0.18, filterFreq: 2000, filterType: 'highpass' })
}

export function playKill() {
  tone({ type: 'sawtooth', freq: 180, freqEnd: 40, duration: 0.35, volume: 0.3 })
  tone({ type: 'square', freq: 360, freqEnd: 60, duration: 0.25, volume: 0.18 })
  noise({ duration: 0.3, volume: 0.4, filterFreq: 800, filterType: 'lowpass' })
}

export function playDamage() {
  tone({ type: 'sawtooth', freq: 140, freqEnd: 50, duration: 0.5, volume: 0.4 })
  tone({ type: 'square', freq: 90, freqEnd: 30, duration: 0.45, volume: 0.3 })
  noise({ duration: 0.4, volume: 0.35, filterFreq: 600, filterType: 'lowpass' })
}

export function playSpawn() {
  tone({ type: 'triangle', freq: 200, freqEnd: 600, duration: 0.12, volume: 0.1 })
}

export function playLevelUp() {
  tone({ type: 'triangle', freq: 523, duration: 0.14, volume: 0.18, delay: 0.0 })
  tone({ type: 'triangle', freq: 659, duration: 0.14, volume: 0.18, delay: 0.1 })
  tone({ type: 'triangle', freq: 784, duration: 0.2, volume: 0.22, delay: 0.2 })
  tone({ type: 'square', freq: 1047, duration: 0.32, volume: 0.18, delay: 0.32 })
  tone({ type: 'sawtooth', freq: 261, freqEnd: 130, duration: 0.4, volume: 0.12, delay: 0.0 })
}
