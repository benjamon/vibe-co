// Browser platform helpers shared across templates: mobile fullscreen,
// background pause, and version-driven auto reload.
//
// All functions are no-ops in non-browser environments so they're safe to
// import from code that may also run under SSR or unit tests.

const noop = () => {}

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'

const isMobile = () =>
  isBrowser && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

export interface MobileFullscreenOptions {
  /** Element (or accessor) to request fullscreen on. Defaults to document.documentElement. */
  target?: HTMLElement | (() => HTMLElement | null)
  /** Called after each fullscreen attempt, regardless of success. */
  onAttempt?: () => void
}

/**
 * Wires up tap-to-fullscreen on mobile. Re-attempts on every gesture since
 * the browser may reject the request, and nudges the URL bar into hiding on
 * Android Chrome via window.scrollTo.
 *
 * Note: iPhone Safari does not support the Fullscreen API at all; the only
 * way to be truly chromeless there is for the user to "Add to Home Screen".
 * The PWA-capable meta tags in index.html make that path work.
 */
export function enableMobileFullscreen(opts: MobileFullscreenOptions = {}): () => void {
  if (!isBrowser || !isMobile()) return noop

  const resolveTarget = (): HTMLElement => {
    if (typeof opts.target === 'function') return opts.target() ?? document.documentElement
    return opts.target ?? document.documentElement
  }

  const inFullscreen = () =>
    Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement)

  const tryFullscreen = () => {
    if (inFullscreen()) return
    const el = resolveTarget() as any
    const req = el.requestFullscreen || el.webkitRequestFullscreen
    if (typeof req !== 'function') return
    try {
      const result = req.call(el)
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        ;(result as Promise<unknown>).catch(() => {})
      }
    } catch {
      // Older iOS Safari throws — caller will retry on the next gesture.
    }
  }

  const nudgeAddressBar = () => {
    if (inFullscreen()) return
    window.scrollTo(0, 1)
  }

  const onGesture = () => {
    tryFullscreen()
    nudgeAddressBar()
    opts.onAttempt?.()
  }

  const onVisibility = () => {
    if (!document.hidden) nudgeAddressBar()
  }

  const onLoad = () => nudgeAddressBar()

  window.addEventListener('pointerdown', onGesture)
  window.addEventListener('touchstart', onGesture, { passive: true })
  window.addEventListener('click', onGesture)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('load', onLoad)

  return () => {
    window.removeEventListener('pointerdown', onGesture)
    window.removeEventListener('touchstart', onGesture)
    window.removeEventListener('click', onGesture)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('load', onLoad)
  }
}

export interface PauseOnHiddenOptions {
  onPause?: () => void
  onResume?: () => void
}

/**
 * Calls onPause when the document becomes hidden (visibility change, tab
 * switch, page hide, blur) and onResume when it returns. Each callback is
 * invoked at most once per state transition, so it's safe to plug game
 * loops or audio managers in directly.
 */
export function enablePauseOnHidden(opts: PauseOnHiddenOptions = {}): () => void {
  if (!isBrowser) return noop

  let paused = false
  const pause = () => {
    if (paused) return
    paused = true
    opts.onPause?.()
  }
  const resume = () => {
    if (!paused) return
    paused = false
    opts.onResume?.()
  }
  const onVisibility = () => {
    if (document.hidden) pause()
    else resume()
  }

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', pause)
  window.addEventListener('pageshow', resume)
  window.addEventListener('blur', pause)
  window.addEventListener('focus', resume)

  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', pause)
    window.removeEventListener('pageshow', resume)
    window.removeEventListener('blur', pause)
    window.removeEventListener('focus', resume)
  }
}

export interface AutoReloadOptions {
  /** Build version baked into the bundle (e.g. injected via vite's `define`). */
  version: string
  /** Base URL prefix for fetching the version file. Defaults to '/'. */
  baseUrl?: string
  /** Filename to fetch. Defaults to 'version.json'. */
  versionFile?: string
  /** Polling interval in ms while the tab stays open. Defaults to 60_000. */
  intervalMs?: number
}

/**
 * Polls a version.json shipped alongside the bundle and reloads the page
 * when the deployed version no longer matches the bundle's version. Also
 * unregisters any leftover service workers, which can otherwise pin
 * Firefox to a stale bundle indefinitely.
 */
export function enableAutoReload(opts: AutoReloadOptions): () => void {
  if (!isBrowser) return noop

  const base = opts.baseUrl ?? '/'
  const file = opts.versionFile ?? 'version.json'
  const interval = opts.intervalMs ?? 60_000
  let reloading = false

  const check = async () => {
    if (reloading) return
    try {
      const res = await fetch(`${base}${file}?_=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      })
      if (!res.ok) return
      const data = (await res.json()) as { version?: string }
      if (data.version && data.version !== opts.version) {
        reloading = true
        location.reload()
      }
    } catch {
      // Network error — try again on the next tick.
    }
  }

  void check()
  const id = window.setInterval(check, interval)

  const onVisibility = () => {
    if (!document.hidden) void check()
  }
  const onFocus = () => void check()
  const onPageshow = (e: PageTransitionEvent) => {
    if (e.persisted) void check()
  }

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onFocus)
  window.addEventListener('pageshow', onPageshow)

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {})
  }

  return () => {
    clearInterval(id)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('pageshow', onPageshow)
  }
}
