import { AUTO, Game, Scale } from 'phaser'
import { BootScene } from './scenes/BootScene'
import { GameScene } from './scenes/GameScene'
import { gameStore } from './store'

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

// Expose game state for Playwright testing
;(window as any).__gameState = gameStore.getState()
gameStore.subscribe((state) => {
  ;(window as any).__gameState = state
})
;(window as any).__phaserGame = game
