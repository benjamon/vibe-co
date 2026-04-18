import * as Phaser from 'phaser'
import { gameStore } from '../store'
import { computeLayout } from '../layout'

export class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOver') }

  private resizeTimer: ReturnType<typeof setTimeout> | null = null

  create() {
    this.events.once('shutdown', () => { this.tweens.killAll(); this.scale.off('resize'); if (this.resizeTimer) clearTimeout(this.resizeTimer) })
    this.scale.on('resize', () => { if (this.resizeTimer) clearTimeout(this.resizeTimer); this.resizeTimer = setTimeout(() => { if (this.scene.isActive('GameOver')) this.scene.restart() }, 200) })
    const { width, height } = this.scale
    const L = computeLayout(width, height)
    const state = gameStore.getState()

    this.cameras.main.setAlpha(0)
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 400 })

    this.add.text(L.cx, L.h * 0.25, 'GAME OVER', {
      fontSize: L.fs(48), color: '#e94560', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5)

    this.add.text(L.cx, L.h * 0.25 + L.s * 60, `You survived ${state.round} rounds`, {
      fontSize: L.fs(18), color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5)

    this.add.text(L.cx, L.h * 0.25 + L.s * 90, `Final team: ${state.team.length} heroes`, {
      fontSize: L.fs(14), color: '#aaaaaa', fontFamily: 'monospace',
    }).setOrigin(0.5)

    for (let i = 0; i < 5; i++) {
      this.add.image(L.cx - L.s * 60 + i * L.s * 30, L.cy, 'heart-empty').setScale(0.9 * L.s)
    }

    const startX = L.cx - (state.team.length - 1) * L.s * 28
    for (let i = 0; i < state.team.length; i++) {
      const h = state.team[i]
      this.add.image(startX + i * L.s * 56, L.cy + L.s * 60, h.hero.id).setScale(0.8 * L.s).setAlpha(0.5)
      this.add.text(startX + i * L.s * 56, L.cy + L.s * 90, h.hero.name, {
        fontSize: L.fs(8), color: '#666666', fontFamily: 'monospace',
      }).setOrigin(0.5)
    }

    const btn = this.add.image(L.cx, L.h - L.s * 80, 'button').setInteractive({ useHandCursor: true })
    this.add.text(L.cx, L.h - L.s * 80, 'PLAY AGAIN', {
      fontSize: L.fs(18), color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5)

    btn.on('pointerover', () => btn.setTint(0x3a7bd5))
    btn.on('pointerout', () => btn.clearTint())
    btn.on('pointerdown', () => {
      gameStore.getState().reset()
      this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 300, onComplete: () => this.scene.start('Menu') })
    })
  }
}
