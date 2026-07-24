// Procedural sound effects, synthesised with the Web Audio API so the game
// ships zero audio assets. A single lazily-created AudioContext is reused for
// every blip; it's resumed on demand because browsers start it suspended until
// a user gesture (the first globe click counts, so by the time anything plays
// we're already inside a gesture-driven call stack).

type Ctx = { c: AudioContext; master: GainNode }

let cached: Ctx | null = null
let unavailable = false

// Master volume (0–1), persisted so the Settings menu's slider survives
// reloads. Applied to the master gain node immediately if the AudioContext
// already exists; otherwise it's picked up as the initial gain the first
// time ac() creates one.
const VOLUME_KEY = 'mapoguesser:volume'
const DEFAULT_VOLUME = 0.5
let currentVolume = DEFAULT_VOLUME
try {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(VOLUME_KEY)
    if (raw !== null) {
      const v = Number(raw)
      if (Number.isFinite(v) && v >= 0 && v <= 1) currentVolume = v
    }
  }
} catch {
  // localStorage unavailable (private browsing, etc.) — stick with the default.
}

export const getVolume = (): number => currentVolume

export const setVolume = (v: number): void => {
  currentVolume = Math.min(1, Math.max(0, v))
  if (cached) cached.master.gain.value = currentVolume
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(VOLUME_KEY, String(currentVolume))
    }
  } catch {
    // quota exceeded / private browsing — the in-memory value still applies.
  }
}

const ac = (): Ctx | null => {
  if (unavailable) return null
  if (cached) {
    if (cached.c.state === 'suspended') void cached.c.resume()
    return cached
  }
  try {
    const Ctor =
      typeof window !== 'undefined'
        ? window.AudioContext ?? (window as any).webkitAudioContext
        : undefined
    if (!Ctor) {
      unavailable = true
      return null
    }
    const c: AudioContext = new Ctor()
    const master = c.createGain()
    master.gain.value = currentVolume
    master.connect(c.destination)
    cached = { c, master }
    if (c.state === 'suspended') void c.resume()
    return cached
  } catch {
    // No audio device / blocked context (e.g. jsdom in unit tests).
    unavailable = true
    return null
  }
}

// MIDI note number → frequency in Hz. C4 = 60, A4 = 69 = 440Hz.
const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

interface Tone {
  midi: number
  start: number // seconds from now
  dur: number
  wave?: OscillatorType
  gain?: number
  slideFrom?: number // glide up/down from this midi at the note's onset
  bendTo?: number // glide to this midi by the note's end (falls/scoops)
}

const play = (tones: Tone[], filterHz?: number): void => {
  const a = ac()
  if (!a) return
  const { c, master } = a
  const now = c.currentTime
  for (const t of tones) {
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = t.wave ?? 'triangle'
    const s = now + t.start
    const f = hz(t.midi)
    if (t.slideFrom != null) {
      osc.frequency.setValueAtTime(hz(t.slideFrom), s)
      osc.frequency.exponentialRampToValueAtTime(f, s + t.dur * 0.5)
    } else {
      osc.frequency.setValueAtTime(f, s)
    }
    if (t.bendTo != null) {
      osc.frequency.exponentialRampToValueAtTime(hz(t.bendTo), s + t.dur)
    }
    // Quick attack, exponential decay. exponentialRamp can't hit 0, so we
    // floor at 0.0001 and start from there.
    const peak = t.gain ?? 0.25
    g.gain.setValueAtTime(0.0001, s)
    g.gain.exponentialRampToValueAtTime(peak, s + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, s + t.dur)
    if (filterHz) {
      const lp = c.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = filterHz
      osc.connect(lp)
      lp.connect(g)
    } else {
      osc.connect(g)
    }
    g.connect(master)
    osc.start(s)
    osc.stop(s + t.dur + 0.05)
  }
}

// --- Per-guess feedback -----------------------------------------------------

// Bright rising two-note "bing" for a correct placement.
export const sfxCorrect = (): void =>
  play([
    { midi: 79, start: 0, dur: 0.13, wave: 'triangle', gain: 0.3 }, // G5
    { midi: 84, start: 0.09, dur: 0.22, wave: 'triangle', gain: 0.32 }, // C6
  ])

// Low descending buzz that bends further down — a clear "nope".
export const sfxWrong = (): void =>
  play(
    [
      { midi: 52, start: 0, dur: 0.16, wave: 'sawtooth', gain: 0.22 }, // E3
      { midi: 47, start: 0.1, dur: 0.3, wave: 'sawtooth', gain: 0.22, bendTo: 43 }, // B2 → G2
    ],
    1200,
  )

// A firework burst: a short filtered-noise crackle over a low boom thump.
// Slightly randomised per call so a volley of bursts doesn't sound identical.
export const sfxFirework = (): void => {
  const a = ac()
  if (!a) return
  const { c, master } = a
  const now = c.currentTime
  const dur = 0.34 + Math.random() * 0.12

  // Crackle: white-noise burst swept downward through a lowpass.
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buf
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(1800 + Math.random() * 1200, now)
  lp.frequency.exponentialRampToValueAtTime(380, now + dur)
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(0.32, now + 0.012)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  src.connect(lp)
  lp.connect(ng)
  ng.connect(master)
  src.start(now)
  src.stop(now + dur + 0.02)

  // Boom: a quick low sine drop for the chest-thump of the explosion.
  const osc = c.createOscillator()
  const og = c.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(130 + Math.random() * 30, now)
  osc.frequency.exponentialRampToValueAtTime(42, now + 0.25)
  og.gain.setValueAtTime(0.0001, now)
  og.gain.exponentialRampToValueAtTime(0.3, now + 0.01)
  og.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
  osc.connect(og)
  og.connect(master)
  osc.start(now)
  osc.stop(now + 0.32)
}

// --- End-of-match jingles ---------------------------------------------------

// <= 1/9 : the classic "wah-wah-wah-waaah" sad trombone — four descending
// brass notes, each scooping in, with a long downward bend on the last.
const jingleSadTrombone = (): void =>
  play(
    [
      { midi: 58, start: 0.0, dur: 0.34, wave: 'sawtooth', gain: 0.26, slideFrom: 60 },
      { midi: 57, start: 0.32, dur: 0.34, wave: 'sawtooth', gain: 0.26, slideFrom: 58 },
      { midi: 56, start: 0.64, dur: 0.34, wave: 'sawtooth', gain: 0.26, slideFrom: 57 },
      { midi: 55, start: 0.96, dur: 0.75, wave: 'sawtooth', gain: 0.28, slideFrom: 56, bendTo: 49 },
    ],
    1300,
  )

// <= 3/9 : "oh well" — a plain descending A-G-F, not sad but not a win.
const jingleOhWell = (): void =>
  play([
    { midi: 69, start: 0.0, dur: 0.22, wave: 'triangle', gain: 0.26 }, // A4
    { midi: 67, start: 0.26, dur: 0.22, wave: 'triangle', gain: 0.26 }, // G4
    { midi: 65, start: 0.52, dur: 0.5, wave: 'triangle', gain: 0.26 }, // F4
    { midi: 53, start: 0.52, dur: 0.5, wave: 'sine', gain: 0.18 }, // F3 pad
  ])

// 4–5/9 : a neutral "that's a wrap" — a calm C5→G4 settle over a soft root pad.
// Deliberately low-key: no arpeggio climb or fanfare, so a middling score lands
// as "complete" rather than "you won".
const jingleNeutral = (): void =>
  play([
    { midi: 72, start: 0.0, dur: 0.2, wave: 'triangle', gain: 0.24 }, // C5
    { midi: 67, start: 0.2, dur: 0.45, wave: 'triangle', gain: 0.24 }, // G4 settle
    { midi: 60, start: 0.2, dur: 0.5, wave: 'sine', gain: 0.14 }, // C4 pad (root)
  ])

// 6/9 : a cheerful C-major arpeggio climbing to the octave.
const jingleHappy = (): void =>
  play([
    { midi: 72, start: 0.0, dur: 0.18, gain: 0.28 }, // C5
    { midi: 76, start: 0.19, dur: 0.18, gain: 0.28 }, // E5
    { midi: 79, start: 0.38, dur: 0.18, gain: 0.28 }, // G5
    { midi: 84, start: 0.58, dur: 0.5, gain: 0.3 }, // C6
  ])

// <= 8/9 : a "ta-ta-ta-taaa" fanfare landing on a held C-major chord.
const jingleTriumphant = (): void =>
  play([
    { midi: 79, start: 0.0, dur: 0.13, wave: 'triangle', gain: 0.26 },
    { midi: 79, start: 0.2, dur: 0.13, wave: 'triangle', gain: 0.26 },
    { midi: 79, start: 0.4, dur: 0.13, wave: 'triangle', gain: 0.26 },
    { midi: 84, start: 0.62, dur: 0.6, wave: 'triangle', gain: 0.3 }, // C6 hold
    { midi: 76, start: 0.62, dur: 0.6, wave: 'sine', gain: 0.18 }, // E5
    { midi: 72, start: 0.62, dur: 0.6, wave: 'sine', gain: 0.16 }, // C5
  ])

// 9/9 : an epic ascending fanfare crowned by a big sustained triad + sparkle.
const jingleEpic = (): void =>
  play([
    { midi: 67, start: 0.0, dur: 0.16, wave: 'sawtooth', gain: 0.22 }, // G4
    { midi: 72, start: 0.2, dur: 0.16, wave: 'sawtooth', gain: 0.24 }, // C5
    { midi: 76, start: 0.4, dur: 0.16, wave: 'sawtooth', gain: 0.24 }, // E5
    { midi: 79, start: 0.6, dur: 0.24, wave: 'sawtooth', gain: 0.26 }, // G5
    { midi: 84, start: 0.86, dur: 0.9, wave: 'sawtooth', gain: 0.3 }, // C6 hold
    { midi: 72, start: 0.86, dur: 0.9, wave: 'triangle', gain: 0.2 }, // C5
    { midi: 76, start: 0.86, dur: 0.9, wave: 'triangle', gain: 0.2 }, // E5
    { midi: 79, start: 0.86, dur: 0.9, wave: 'triangle', gain: 0.2 }, // G5
    { midi: 88, start: 1.16, dur: 0.6, wave: 'triangle', gain: 0.18 }, // E6 sparkle
  ])

// Pick the jingle for a final score (correct guesses out of ROUNDS = 9).
export const sfxEndJingle = (correct: number): void => {
  if (correct <= 1) jingleSadTrombone()
  else if (correct <= 3) jingleOhWell()
  else if (correct <= 5) jingleNeutral() // 4–5: neutral "complete", not a win
  else if (correct <= 6) jingleHappy() // 6
  else if (correct <= 8) jingleTriumphant() // 7–8
  else jingleEpic() // 9
}

// --- iOS / mobile audio unlock ----------------------------------------------

// Web Audio starts suspended until a user gesture, and iOS Safari is especially
// strict: it wants the context resumed *and* a (silent) buffer played from
// inside the first touch. We resume on first guess anyway, but priming the
// context on the very first interaction makes later programmatic playback
// reliable on iPhone/iPad.
//
// NOTE: this does NOT defeat the iPhone hardware ring/silent switch — iOS
// silences all Web Audio when the switch is set to silent, and there's no
// web API to override that. If a tester reports "no sound on iPhone", the
// silent switch is the first thing to check.
let primed = false
export const unlockAudio = (): void => {
  const a = ac()
  if (!a) return
  const { c } = a
  if (c.state === 'suspended') void c.resume()
  if (primed) return
  primed = true
  try {
    // One sample of silence — enough to flip the context into a playable state
    // on iOS without making a sound.
    const buf = c.createBuffer(1, 1, 22050)
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(c.destination)
    src.start(0)
  } catch {
    // createBuffer unsupported / context died — the resume() above still helps.
  }
}

// Install one-time listeners that unlock audio on the first user interaction.
// Kept for the session (not removed after first fire) so audio is re-resumed
// if iOS suspends the context on backgrounding. Returns a cleanup for unmount.
export const installAudioUnlock = (): (() => void) => {
  if (typeof window === 'undefined') return () => {}
  const events = ['pointerdown', 'touchend', 'keydown'] as const
  const handler = () => unlockAudio()
  for (const e of events) window.addEventListener(e, handler, { passive: true })
  return () => {
    for (const e of events) window.removeEventListener(e, handler)
  }
}
