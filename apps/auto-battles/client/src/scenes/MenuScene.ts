import * as Phaser from 'phaser'
import { gameStore } from '../store'
import { computeLayout } from '../layout'

export class MenuScene extends Phaser.Scene {
  constructor() { super('Menu') }

  private resizeTimer: ReturnType<typeof setTimeout> | null = null

  create() {
    this.events.once('shutdown', () => { this.tweens.killAll(); this.scale.off('resize'); if (this.resizeTimer) clearTimeout(this.resizeTimer) })
    this.scale.on('resize', () => { if (this.resizeTimer) clearTimeout(this.resizeTimer); this.resizeTimer = setTimeout(() => { if (this.scene.isActive('Menu')) this.scene.restart() }, 200) })
    const { width, height } = this.scale
    const L = computeLayout(width, height)

    this.cameras.main.setAlpha(0)
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 400 })

    this.add.text(L.cx, L.h * 0.25, 'AUTO-BATTLES', {
      fontSize: L.fs(48), color: '#e94560', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5)

    this.add.text(L.cx, L.h * 0.25 + L.s * 50, 'Buy heroes. Fight battles. Survive!', {
      fontSize: L.fs(14), color: '#aaaaaa', fontFamily: 'monospace',
    }).setOrigin(0.5)

    const rules = [
      'Start with 7 gold, then 10 each round',
      'Heroes cost 3 gold, rerolls cost 1 gold',
      'Buy the same hero twice to merge and combine stats',
      'Your team fights the enemy team one-by-one',
      'Lose a fight = lose a heart. 0 hearts = game over',
      'Your team is revived after each battle',
    ]
    for (let i = 0; i < rules.length; i++) {
      this.add.text(L.cx, L.h * 0.5 - L.s * 20 + i * L.s * 22, rules[i], {
        fontSize: L.fs(12), color: '#666666', fontFamily: 'monospace',
      }).setOrigin(0.5)
    }

    const btn = this.add.image(L.cx, L.h - L.s * 100, 'button').setInteractive({ useHandCursor: true })
    this.add.text(L.cx, L.h - L.s * 100, 'START GAME', {
      fontSize: L.fs(20), color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5)

    btn.on('pointerover', () => btn.setTint(0x3a7bd5))
    btn.on('pointerout', () => btn.clearTint())
    btn.on('pointerdown', () => {
      gameStore.getState().startGame()
      this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 300, onComplete: () => this.scene.start('Shop') })
    })
  }
}
