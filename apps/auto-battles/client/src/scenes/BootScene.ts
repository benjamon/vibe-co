import * as Phaser from 'phaser'
import { HERO_POOL } from '../data'

const GOD_COLORS: Record<string, number> = {
  zeus: 0xf1c40f,
  athena: 0x9b59b6,
  ares: 0xe94560,
  artemis: 0x2ecc71,
  poseidon: 0x3498db,
  hermes: 0x4ecdc4,
  hephaestus: 0xe67e22,
  apollo: 0xf39c12,
}

export class BootScene extends Phaser.Scene {
  /** Hero ids whose PNG load failed (404, decode error, LFS pointer file). */
  private readonly failedSprites = new Set<string>()

  constructor() {
    super('Boot')
  }

  preload() {
    // Some sprite PNGs may be missing or stored as Git LFS pointer files
    // (which fail to decode). Track failures so we can replace them with a
    // generated fallback below — leaving the texture entry around would
    // otherwise leak Phaser's "missing texture" placeholder onto cards.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      if (file.type === 'image') this.failedSprites.add(file.key)
    })

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
    for (const hero of HERO_POOL) {
      // Replace fallbacks for sprites whose load failed even if the texture
      // key was registered, so we never render Phaser's missing-texture
      // placeholder for a hero card.
      if (this.failedSprites.has(hero.id) && this.textures.exists(hero.id)) {
        this.textures.remove(hero.id)
      }
      if (this.textures.exists(hero.id)) continue

      const color = GOD_COLORS[hero.id] ?? 0x888888
      const w = 64
      const h = 80
      const gfx = this.add.graphics()
      gfx.fillStyle(color, 1)
      gfx.fillCircle(w / 2, w / 2 - 4, 26)
      gfx.fillRoundedRect(w / 2 - 18, h - 30, 36, 22, 5)
      gfx.lineStyle(2, 0x000000, 0.35)
      gfx.strokeCircle(w / 2, w / 2 - 4, 26)
      gfx.generateTexture(hero.id, w, h)
      gfx.destroy()

      // Bake the hero's first initial into the texture so each fallback is
      // distinguishable on a shop card without relying on the colour alone.
      const initial = (hero.name?.[0] ?? '?').toUpperCase()
      const text = this.add.text(w / 2, w / 2 - 6, initial, {
        fontFamily: 'monospace',
        fontStyle: 'bold',
        fontSize: '28px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      }).setOrigin(0.5)
      const rt = this.add.renderTexture(0, 0, w, h).setVisible(false)
      rt.draw(hero.id, 0, 0)
      rt.draw(text, 0, 0)
      this.textures.remove(hero.id)
      rt.saveTexture(hero.id)
      text.destroy()
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
