let ctx: AudioContext | null = null
let masterGainNode: GainNode | null = null
let sfxGainNode: GainNode | null = null
let musicGainNode: GainNode | null = null

const MASTER_HEADROOM = 0.35
let masterVolume = 1.0
let sfxVolume = 0.8
let musicVolume = 0.5

function getCtx(): AudioContext | null {
  if (ctx) return ctx
  const Ctor =
    typeof window !== 'undefined'
      ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined
  if (!Ctor) return null
  ctx = new Ctor()
  masterGainNode = ctx.createGain()
  masterGainNode.gain.value = masterVolume * MASTER_HEADROOM
  masterGainNode.connect(ctx.destination)
  sfxGainNode = ctx.createGain()
  sfxGainNode.gain.value = sfxVolume
  sfxGainNode.connect(masterGainNode)
  musicGainNode = ctx.createGain()
  musicGainNode.gain.value = musicVolume
  musicGainNode.connect(masterGainNode)
  return ctx
}

export function unlockAudio() {
  const c = getCtx()
  if (c && c.state === 'suspended') void c.resume()
}

export function setMasterVolume(v: number) {
  masterVolume = Math.max(0, Math.min(1, v))
  if (masterGainNode) masterGainNode.gain.value = masterVolume * MASTER_HEADROOM
}

export function setSfxVolume(v: number) {
  sfxVolume = Math.max(0, Math.min(1, v))
  if (sfxGainNode) sfxGainNode.gain.value = sfxVolume
}

export function setMusicVolume(v: number) {
  musicVolume = Math.max(0, Math.min(1, v))
  if (musicGainNode) musicGainNode.gain.value = musicVolume
}

let musicStarted = false
export function startMusic() {
  const c = getCtx()
  if (!c || !musicGainNode || musicStarted) return
  musicStarted = true
  const droneGain = c.createGain()
  droneGain.gain.value = 0.22
  droneGain.connect(musicGainNode)
  // Three-voice ambient pad on a low minor chord with detune & slow vibrato.
  const freqs = [110, 146.83, 220] // A2, D3, A3
  for (let i = 0; i < freqs.length; i++) {
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freqs[i]
    osc.detune.value = (Math.random() - 0.5) * 6
    const oscGain = c.createGain()
    oscGain.gain.value = 0.32
    osc.connect(oscGain).connect(droneGain)
    const lfo = c.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = 0.07 + Math.random() * 0.1
    const lfoGain = c.createGain()
    lfoGain.gain.value = 0.6 + Math.random() * 0.8
    lfo.connect(lfoGain).connect(osc.frequency)
    osc.start()
    lfo.start()
    // Higher harmonic shimmer
    if (i === 2) {
      const shimmer = c.createOscillator()
      shimmer.type = 'triangle'
      shimmer.frequency.value = freqs[i] * 2
      const shimmerGain = c.createGain()
      shimmerGain.gain.value = 0.05
      const shimmerLfo = c.createOscillator()
      shimmerLfo.type = 'sine'
      shimmerLfo.frequency.value = 0.18
      const shimmerLfoGain = c.createGain()
      shimmerLfoGain.gain.value = 0.05
      shimmerLfo.connect(shimmerLfoGain).connect(shimmerGain.gain)
      shimmer.connect(shimmerGain).connect(droneGain)
      shimmer.start()
      shimmerLfo.start()
    }
  }
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
  if (!c || !sfxGainNode) return
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
  osc.connect(gain).connect(sfxGainNode)
  osc.start(start)
  osc.stop(start + duration + 0.02)
  osc.onended = () => {
    osc.disconnect()
    gain.disconnect()
  }
}

interface NoiseOpts {
  duration: number
  volume?: number
  filterFreq?: number
  filterType?: BiquadFilterType
}

const NOISE_BUFFER_SECONDS = 1.0
let sharedNoiseBuffer: AudioBuffer | null = null

function getNoiseBuffer(c: AudioContext): AudioBuffer {
  if (sharedNoiseBuffer && sharedNoiseBuffer.sampleRate === c.sampleRate) return sharedNoiseBuffer
  const len = Math.floor(c.sampleRate * NOISE_BUFFER_SECONDS)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  sharedNoiseBuffer = buf
  return buf
}

function noise({ duration, volume = 0.4, filterFreq = 1200, filterType = 'lowpass' }: NoiseOpts) {
  const c = getCtx()
  if (!c || !sfxGainNode) return
  const now = c.currentTime
  const buf = getNoiseBuffer(c)
  const src = c.createBufferSource()
  src.buffer = buf
  const offset = Math.random() * Math.max(0, NOISE_BUFFER_SECONDS - duration - 0.05)
  const filt = c.createBiquadFilter()
  filt.type = filterType
  filt.frequency.value = filterFreq
  const gain = c.createGain()
  gain.gain.setValueAtTime(volume, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  src.connect(filt).connect(gain).connect(sfxGainNode)
  src.start(now, offset)
  src.stop(now + duration + 0.02)
  src.onended = () => {
    src.disconnect()
    filt.disconnect()
    gain.disconnect()
  }
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

let lastHit = 0
export function playHit() {
  const c = getCtx()
  if (!c) return
  if (c.currentTime - lastHit < 0.05) return
  lastHit = c.currentTime
  tone({ type: 'square', freq: 220, freqEnd: 90, duration: 0.08, volume: 0.22 })
  noise({ duration: 0.05, volume: 0.18, filterFreq: 2000, filterType: 'highpass' })
}

let lastKill = 0
export function playKill() {
  const c = getCtx()
  if (!c) return
  if (c.currentTime - lastKill < 0.06) return
  lastKill = c.currentTime
  tone({ type: 'sawtooth', freq: 180, freqEnd: 40, duration: 0.35, volume: 0.3 })
  tone({ type: 'square', freq: 360, freqEnd: 60, duration: 0.25, volume: 0.18 })
  noise({ duration: 0.3, volume: 0.4, filterFreq: 800, filterType: 'lowpass' })
}

let lastMissileHit = 0
export function playMissileHit() {
  const c = getCtx()
  if (!c) return
  if (c.currentTime - lastMissileHit < 0.07) return
  lastMissileHit = c.currentTime
  tone({ type: 'sine', freq: 80, freqEnd: 28, duration: 0.45, volume: 0.55 })
  tone({ type: 'sawtooth', freq: 160, freqEnd: 40, duration: 0.28, volume: 0.3 })
  tone({ type: 'square', freq: 240, freqEnd: 60, duration: 0.18, volume: 0.18 })
  noise({ duration: 0.32, volume: 0.5, filterFreq: 480, filterType: 'lowpass' })
  noise({ duration: 0.08, volume: 0.35, filterFreq: 3200, filterType: 'highpass' })
}

let lastDamage = 0
export function playDamage() {
  const c = getCtx()
  if (!c) return
  if (c.currentTime - lastDamage < 0.1) return
  lastDamage = c.currentTime
  tone({ type: 'sawtooth', freq: 140, freqEnd: 50, duration: 0.5, volume: 0.4 })
  tone({ type: 'square', freq: 90, freqEnd: 30, duration: 0.45, volume: 0.3 })
  noise({ duration: 0.4, volume: 0.35, filterFreq: 600, filterType: 'lowpass' })
}

let lastSpawn = 0
export function playSpawn() {
  const c = getCtx()
  if (!c) return
  if (c.currentTime - lastSpawn < 0.04) return
  lastSpawn = c.currentTime
  tone({ type: 'triangle', freq: 200, freqEnd: 600, duration: 0.12, volume: 0.1 })
}

const DORIAN_OFFSETS = [0, 2, 3, 5, 7, 9, 10, 12]
const PICKUP_ROOT = 880

let lastPickup = 0
export function playPickup() {
  const c = getCtx()
  if (!c) return
  if (c.currentTime - lastPickup < 0.04) return
  lastPickup = c.currentTime
  const semitone = DORIAN_OFFSETS[Math.floor(Math.random() * DORIAN_OFFSETS.length)]
  const note = PICKUP_ROOT * Math.pow(2, semitone / 12)
  tone({ type: 'sine', freq: note * 0.55, freqEnd: note, duration: 0.1, volume: 0.09, attack: 0.001 })
  tone({ type: 'sine', freq: note * 1.0, freqEnd: note * 1.6, duration: 0.05, volume: 0.04, attack: 0.001 })
}

export function playConfirm() {
  tone({ type: 'sine', freq: 1320, duration: 0.1, volume: 0.2 })
  tone({ type: 'sine', freq: 1760, duration: 0.16, volume: 0.18, delay: 0.06 })
  tone({ type: 'triangle', freq: 660, duration: 0.18, volume: 0.1 })
}

export function playLevelUp() {
  tone({ type: 'triangle', freq: 523, duration: 0.14, volume: 0.18, delay: 0.0 })
  tone({ type: 'triangle', freq: 659, duration: 0.14, volume: 0.18, delay: 0.1 })
  tone({ type: 'triangle', freq: 784, duration: 0.2, volume: 0.22, delay: 0.2 })
  tone({ type: 'square', freq: 1047, duration: 0.32, volume: 0.18, delay: 0.32 })
  tone({ type: 'sawtooth', freq: 261, freqEnd: 130, duration: 0.4, volume: 0.12, delay: 0.0 })
}
