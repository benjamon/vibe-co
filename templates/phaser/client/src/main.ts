import { AUTO, Game, Scale } from 'phaser'
import {
  enableAutoReload,
  enableMobileFullscreen,
  enablePauseOnHidden,
} from 'shared'
import { BootScene } from './scenes/BootScene'
import { GameScene } from './scenes/GameScene'
import { gameStore } from './store'

declare const __APP_VERSION__: string

const config = {
  type: AUTO,
  width: 800,
  height: 600,
  parent: document.body,
  backgroundColor: '#1a1a2e',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 300 },
      debug: false,
    },
  },
  scene: [BootScene, GameScene],
  scale: {
    mode: Scale.FIT,
    autoCenter: Scale.CENTER_BOTH,
  },
}

const game = new Game(config)

enableMobileFullscreen()

enablePauseOnHidden({
  onPause: () => {
    game.sound?.pauseAll?.()
    game.loop.sleep()
  },
  onResume: () => {
    game.loop.wake()
    game.sound?.resumeAll?.()
  },
})

enableAutoReload({
  version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
  baseUrl: import.meta.env.BASE_URL,
})

// Expose game state for Playwright testing
;(window as any).__gameState = gameStore.getState()
gameStore.subscribe((state) => {
  ;(window as any).__gameState = state
})
;(window as any).__phaserGame = game
