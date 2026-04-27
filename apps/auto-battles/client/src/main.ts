import { AUTO, Game, Scale } from 'phaser'
import { BootScene } from './scenes/BootScene'
import { MenuScene } from './scenes/MenuScene'
import { ShopScene } from './scenes/ShopScene'
import { BattleScene } from './scenes/BattleScene'
import { GameOverScene } from './scenes/GameOverScene'
import { gameStore } from './store'

const config = {
  type: AUTO,
  parent: document.body,
  backgroundColor: '#1a1a2e',
  width: window.innerWidth,
  height: window.innerHeight,
  scene: [BootScene, MenuScene, ShopScene, BattleScene, GameOverScene],
  scale: {
    mode: Scale.RESIZE,
  },
}

const game = new Game(config)

function handleResize() {
  const w = window.innerWidth
  const h = window.innerHeight
  // Resize both the scale manager and the underlying renderer
  game.scale.resize(w, h)
  game.renderer.resize(w, h)
}

window.addEventListener('resize', handleResize)
window.addEventListener('orientationchange', () => setTimeout(handleResize, 100))

const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

function tryRequestFullscreen() {
  if (!isMobile) return
  if (document.fullscreenElement) return
  if (game.scale.isFullscreen) return
  try {
    game.scale.startFullscreen()
  } catch {
    // Some browsers (notably iOS Safari on iPhone) don't support fullscreen;
    // fail silently rather than break the game.
  }
}

if (isMobile) {
  const onFirstTouch = () => tryRequestFullscreen()
  window.addEventListener('pointerdown', onFirstTouch, { once: true })
  window.addEventListener('touchend', onFirstTouch, { once: true })
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
