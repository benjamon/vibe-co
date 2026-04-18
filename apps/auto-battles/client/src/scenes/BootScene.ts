import * as Phaser from 'phaser'
import { HERO_POOL } from '../data'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  preload() {
    // Attempt to load each hero's sprite PNG
    for (const hero of HERO_POOL) {
      if (hero.sprite) {
        this.load.image(hero.id, hero.sprite)
      }
    }
  }

  create() {
    this.generateFallbackTextures()
    this.generateUITextures()
    this.scene.start('Menu')
  }

  private generateFallbackTextures() {
    const godColors: Record<string, number> = {
      zeus: 0xf1c40f,
      athena: 0x9b59b6,
      ares: 0xe94560,
      artemis: 0x2ecc71,
      poseidon: 0x3498db,
      hermes: 0x4ecdc4,
      hephaestus: 0xe67e22,
      apollo: 0xf39c12,
    }

    for (const hero of HERO_POOL) {
      // Skip if the real sprite loaded successfully
      if (this.textures.exists(hero.id)) continue

      const color = godColors[hero.id] ?? 0x888888
      const gfx = this.add.graphics()
      gfx.fillStyle(color)
      gfx.fillCircle(20, 20, 18)
      gfx.fillRoundedRect(8, 36, 24, 16, 4)
      gfx.generateTexture(hero.id, 40, 52)
      gfx.destroy()
    }
  }

  private generateUITextures() {
    const btnGfx = this.add.graphics()
    btnGfx.fillStyle(0x16213e)
    btnGfx.fillRoundedRect(0, 0, 200, 50, 8)
    btnGfx.lineStyle(2, 0x0f3460)
    btnGfx.strokeRoundedRect(0, 0, 200, 50, 8)
    btnGfx.generateTexture('button', 200, 50)
    btnGfx.destroy()

    const smBtnGfx = this.add.graphics()
    smBtnGfx.fillStyle(0x16213e)
    smBtnGfx.fillRoundedRect(0, 0, 140, 40, 6)
    smBtnGfx.lineStyle(2, 0x0f3460)
    smBtnGfx.strokeRoundedRect(0, 0, 140, 40, 6)
    smBtnGfx.generateTexture('button-sm', 140, 40)
    smBtnGfx.destroy()

    const heartGfx = this.add.graphics()
    heartGfx.fillStyle(0xe94560)
    heartGfx.fillCircle(8, 8, 7)
    heartGfx.fillCircle(20, 8, 7)
    heartGfx.fillTriangle(1, 12, 27, 12, 14, 26)
    heartGfx.generateTexture('heart', 28, 28)
    heartGfx.destroy()

    const emptyHeartGfx = this.add.graphics()
    emptyHeartGfx.fillStyle(0x333333)
    emptyHeartGfx.fillCircle(8, 8, 7)
    emptyHeartGfx.fillCircle(20, 8, 7)
    emptyHeartGfx.fillTriangle(1, 12, 27, 12, 14, 26)
    emptyHeartGfx.generateTexture('heart-empty', 28, 28)
    emptyHeartGfx.destroy()

    const coinGfx = this.add.graphics()
    coinGfx.fillStyle(0xf1c40f)
    coinGfx.fillCircle(10, 10, 9)
    coinGfx.fillStyle(0xe2b607)
    coinGfx.fillCircle(10, 10, 6)
    coinGfx.generateTexture('coin', 20, 20)
    coinGfx.destroy()
  }
}
