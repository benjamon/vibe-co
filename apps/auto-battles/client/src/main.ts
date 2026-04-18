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

;(window as any).__gameState = gameStore.getState()
gameStore.subscribe((state) => {
  ;(window as any).__gameState = state
})
;(window as any).__phaserGame = game
