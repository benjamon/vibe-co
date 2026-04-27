import { createRoot } from 'react-dom/client'
import {
  enableAutoReload,
  enableMobileFullscreen,
  enablePauseOnHidden,
} from 'shared'
import { App } from './App'

declare const __APP_VERSION__: string

enableMobileFullscreen()

// R3F throttles its render loop when the tab is hidden via the browser's
// requestAnimationFrame throttling, so visually rendering already pauses.
// We additionally suspend any Web Audio context so sound stops on mobile.
enablePauseOnHidden({
  onPause: () => {
    document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => el.pause())
    const ctx = (window as any).__audioContext as AudioContext | undefined
    void ctx?.suspend?.()
  },
  onResume: () => {
    const ctx = (window as any).__audioContext as AudioContext | undefined
    void ctx?.resume?.()
  },
})

enableAutoReload({
  version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
  baseUrl: import.meta.env.BASE_URL,
})

createRoot(document.getElementById('root')!).render(<App />)
