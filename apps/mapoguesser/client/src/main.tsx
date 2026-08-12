import { createRoot } from 'react-dom/client'
import { App } from './App'

// Dev-only: forward uncaught errors/rejections to the Vite terminal (see the
// matching server-side plugin in vite.config.ts) — a render crash otherwise
// only shows up in the browser's devtools console, easy to miss when you're
// just watching `npm run dev` output.
if (import.meta.hot) {
  const report = (message: string, stack?: string) => {
    import.meta.hot?.send('mapoguesser:browser-error', { message, stack })
  }
  window.addEventListener('error', (e) => {
    report(e.message, e.error?.stack)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as { message?: string; stack?: string } | undefined
    report(reason?.message ?? String(e.reason), reason?.stack)
  })
}

createRoot(document.getElementById('root')!).render(<App />)
