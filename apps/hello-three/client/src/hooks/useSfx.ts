import { useRef, useCallback } from 'react'
import * as Tone from 'tone'

export function useSfx() {
  const synthRef = useRef<Tone.Synth | null>(null)

  const jump = useCallback(async () => {
    // Ensure audio context is started (browser autoplay policy)
    if (Tone.getContext().state !== 'running') {
      await Tone.start()
    }

    if (!synthRef.current) {
      synthRef.current = new Tone.Synth({
        oscillator: { type: 'square' },
        envelope: { attack: 0.01, decay: 0.15, sustain: 0, release: 0.1 },
        volume: -12,
      }).toDestination()
    }

    // Quick ascending chirp
    synthRef.current.triggerAttackRelease('C5', '0.08')
    setTimeout(() => {
      synthRef.current?.triggerAttackRelease('E5', '0.08')
    }, 50)
  }, [])

  return { jump }
}
