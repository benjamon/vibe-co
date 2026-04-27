import { AUTO, Game, Scale } from 'phaser'
import { BootScene } from './scenes/BootScene'
import { MenuScene } from './scenes/MenuScene'
import { ShopScene } from './scenes/ShopScene'
import { BattleScene } from './scenes/BattleScene'
import { GameOverScene } from './scenes/GameOverScene'
import { gameStore } from './store'

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
  game.renderer.resize(w, h)
}

window.addEventListener('resize', handleResize)
window.addEventListener('orientationchange', () => setTimeout(handleResize, 100))
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

function tryRequestFullscreen() {
  if (!isMobile) return
  if (!supportsFullscreen) return
  if (isInFullscreen()) return
  try {
    game.scale.startFullscreen()
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
