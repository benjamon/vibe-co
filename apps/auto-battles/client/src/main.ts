import { AUTO, Game, Scale } from 'phaser'
import { BootScene } from './scenes/BootScene'
import { MenuScene } from './scenes/MenuScene'
import { ShopScene } from './scenes/ShopScene'
import { BattleScene } from './scenes/BattleScene'
import { GameOverScene } from './scenes/GameOverScene'
import { gameStore } from './store'

declare const __APP_VERSION__: string
const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

let reloading = false
async function checkForUpdate() {
  if (reloading) return
  try {
    const url = `${import.meta.env.BASE_URL}version.json?_=${Date.now()}`
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    })
    if (!res.ok) return
    const data = (await res.json()) as { version?: string }
    if (data.version && data.version !== APP_VERSION) {
      reloading = true
      // Force a non-cached reload of the document.
      location.reload()
    }
  } catch {
    // Network error — try again on the next tick.
  }
}

checkForUpdate()
setInterval(checkForUpdate, 60_000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkForUpdate()
})
window.addEventListener('focus', checkForUpdate)
window.addEventListener('pageshow', (e) => {
  // bfcache restores can serve a stale page — force-check on restore.
  if ((e as PageTransitionEvent).persisted) checkForUpdate()
})

// Clean up any service workers that may have been registered previously,
// since they can pin Firefox to a stale bundle.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {})
}

function viewportSize() {
  const vv = window.visualViewport
  return {
    w: vv ? vv.width : window.innerWidth,
    h: vv ? vv.height : window.innerHeight,
  }
}

const initial = viewportSize()

const config = {
  type: AUTO,
  parent: document.body,
  backgroundColor: '#1a1a2e',
  width: initial.w,
  height: initial.h,
  scene: [BootScene, MenuScene, ShopScene, BattleScene, GameOverScene],
  scale: {
    mode: Scale.RESIZE,
    autoRound: true,
  },
}

const game = new Game(config)

function handleResize() {
  const { w, h } = viewportSize()
  game.scale.resize(w, h)
  syncSceneCameras(w, h)
  game.scale.refresh()
}

function syncSceneCameras(w: number, h: number) {
  // Phaser updates its scale manager + canvas size, but a scene's main
  // camera viewport can stay at the pre-resize rectangle (especially right
  // after a scene start, before the camera has reacted to the resize event).
  // Push the new size into every scene's main camera so the WebGL viewport
  // matches the canvas. We sync inactive scenes too so the next scene that
  // becomes active doesn't inherit a stale viewport.
  for (const scene of game.scene.scenes) {
    const cam = scene.cameras?.main
    if (!cam) continue
    cam.setViewport(0, 0, w, h)
    cam.setSize(w, h)
  }
}

function syncAfterSceneEvent() {
  const { w, h } = viewportSize()
  game.scale.resize(w, h)
  syncSceneCameras(w, h)
  game.scale.refresh()
  // The WebGL viewport state can land a frame behind a scene start, so
  // re-sync on the next two animation frames to catch the new camera once
  // it's attached.
  requestAnimationFrame(() => syncSceneCameras(game.scale.width, game.scale.height))
  requestAnimationFrame(() =>
    requestAnimationFrame(() => syncSceneCameras(game.scale.width, game.scale.height)),
  )
}

// Hook every scene's lifecycle so a transition (Menu → Shop → Battle → …)
// always starts with a camera viewport that matches the current canvas.
// Without this, rotating the device and then triggering the first scene
// change leaves the new scene rendering only the upper portion of the
// canvas until something else forces a resize.
function attachSceneSyncListeners() {
  for (const scene of game.scene.scenes) {
    const events = scene.events
    if (!events) continue
    events.off('start', syncAfterSceneEvent)
    events.off('create', syncAfterSceneEvent)
    events.off('wake', syncAfterSceneEvent)
    events.off('resume', syncAfterSceneEvent)
    events.off('transitioncomplete', syncAfterSceneEvent)
    events.on('start', syncAfterSceneEvent)
    events.on('create', syncAfterSceneEvent)
    events.on('wake', syncAfterSceneEvent)
    events.on('resume', syncAfterSceneEvent)
    events.on('transitioncomplete', syncAfterSceneEvent)
  }
}

// Game emits 'ready' once all scenes have been added to the SceneManager.
game.events.once('ready', attachSceneSyncListeners)

// Mobile browsers report the post-rotation viewport over several hundred ms,
// so re-resize at a series of delays after orientation change to make sure
// we land on the final dimensions.
function scheduleResizeRetries() {
  ;[0, 50, 150, 350, 700, 1200].forEach((delay) => setTimeout(handleResize, delay))
}

window.addEventListener('resize', handleResize)
window.addEventListener('orientationchange', scheduleResizeRetries)
if (typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(orientation: landscape)')
  // Older Safari uses addListener; modern browsers use addEventListener.
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', scheduleResizeRetries)
  } else if (typeof (mq as any).addListener === 'function') {
    ;(mq as any).addListener(scheduleResizeRetries)
  }
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', handleResize)
  window.visualViewport.addEventListener('scroll', handleResize)
}

const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
const supportsFullscreen =
  typeof document !== 'undefined' &&
  (document.fullscreenEnabled ||
    (document as any).webkitFullscreenEnabled === true)

function isInFullscreen() {
  return Boolean(
    document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      game.scale.isFullscreen,
  )
}

function tryLockLandscape() {
  // The Screen Orientation lock API only works in fullscreen on most
  // browsers, and isn't supported at all on iOS Safari. Try, ignore
  // failure, and let the rotate-prompt overlay handle the rest.
  const orientation = (screen as any).orientation as ScreenOrientation | undefined
  if (!orientation || typeof (orientation as any).lock !== 'function') return
  try {
    const result = (orientation as any).lock('landscape')
    if (result && typeof result.then === 'function') {
      ;(result as Promise<unknown>).catch(() => {})
    }
  } catch {
    // Some browsers throw synchronously when not in fullscreen. Ignore.
  }
}

function tryRequestFullscreen() {
  if (!isMobile) return
  if (!supportsFullscreen) return
  if (isInFullscreen()) {
    tryLockLandscape()
    return
  }
  try {
    game.scale.startFullscreen()
    // Lock orientation as soon as we're in fullscreen — schedule a retry
    // since the lock API may need a tick after fullscreen takes effect.
    requestAnimationFrame(tryLockLandscape)
    setTimeout(tryLockLandscape, 200)
  } catch {
    // Older iOS Safari throws — caller will retry on the next gesture.
  }
}

// Collapses the address bar on mobile browsers that hide chrome on scroll.
// Harmless on browsers that don't.
function nudgeHideAddressBar() {
  if (!isMobile) return
  if (isInFullscreen()) return
  window.scrollTo(0, 1)
  // Force a resize so the canvas picks up the new visible area.
  requestAnimationFrame(handleResize)
}

if (isMobile) {
  // Re-attempt the orientation lock whenever fullscreen state flips —
  // the lock can only be acquired while fullscreen on most browsers.
  document.addEventListener('fullscreenchange', tryLockLandscape)
  document.addEventListener('webkitfullscreenchange' as any, tryLockLandscape)

  // Try fullscreen on every pointer/touch interaction until it sticks.
  // Browsers require a user gesture, so we can't request it on load.
  const onUserGesture = () => {
    tryRequestFullscreen()
    nudgeHideAddressBar()
  }
  window.addEventListener('pointerdown', onUserGesture)
  window.addEventListener('touchstart', onUserGesture, { passive: true })
  window.addEventListener('click', onUserGesture)

  // Also re-attempt when the page becomes visible again.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) nudgeHideAddressBar()
  })

  // Initial nudge to collapse the URL bar even without a tap (Android Chrome).
  window.addEventListener('load', () => {
    nudgeHideAddressBar()
    setTimeout(handleResize, 300)
  })

  // iOS Safari leaves the home indicator and chrome visible, so just keep
  // the canvas filling the visual viewport — the CSS + handleResize already do.
  if (isIOS) {
    // Fix the layout when iOS Safari shows/hides its bottom toolbar.
    setInterval(() => {
      const { h } = viewportSize()
      if (Math.abs(game.scale.height - h) > 1) handleResize()
    }, 500)
  }
}

function pauseGame() {
  if (game.sound && typeof game.sound.pauseAll === 'function') game.sound.pauseAll()
  game.loop.sleep()
}

function resumeGame() {
  game.loop.wake()
  if (game.sound && typeof game.sound.resumeAll === 'function') game.sound.resumeAll()
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame()
  else resumeGame()
})
window.addEventListener('pagehide', pauseGame)
window.addEventListener('pageshow', resumeGame)
window.addEventListener('blur', pauseGame)
window.addEventListener('focus', resumeGame)

;(window as any).__gameState = gameStore.getState()
gameStore.subscribe((state) => {
  ;(window as any).__gameState = state
})
;(window as any).__phaserGame = game
