import * as Phaser from 'phaser'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create() {
    this.generateTextures()

    this.add
      .text(400, 260, 'Coin Collector', {
        fontSize: '48px',
        color: '#ffd700',
        fontFamily: 'monospace',
      })
      .setOrigin(0.5)

    this.add
      .text(400, 340, 'Click to Start', {
        fontSize: '24px',
        color: '#ffffff',
        fontFamily: 'monospace',
      })
      .setOrigin(0.5)

    this.add
      .text(400, 400, 'Arrow Keys / WASD to move, Up / W / Space to jump', {
        fontSize: '14px',
        color: '#aaaaaa',
        fontFamily: 'monospace',
      })
      .setOrigin(0.5)

    this.input.once('pointerdown', () => {
      this.scene.start('Game')
    })
  }

  private generateTextures() {
    // Player: red square with face
    const pg = this.add.graphics()
    pg.fillStyle(0xe94560)
    pg.fillRoundedRect(0, 0, 28, 32, 4)
    // Eyes
    pg.fillStyle(0xffffff)
    pg.fillCircle(9, 10, 4)
    pg.fillCircle(19, 10, 4)
    pg.fillStyle(0x1a1a2e)
    pg.fillCircle(10, 10, 2)
    pg.fillCircle(20, 10, 2)
    pg.generateTexture('player', 28, 32)
    pg.destroy()

    // Platform tile
    const plat = this.add.graphics()
    plat.fillStyle(0x5a3a2a)
    plat.fillRect(0, 0, 32, 32)
    plat.lineStyle(1, 0x7a5a4a)
    plat.strokeRect(0, 0, 32, 32)
    plat.lineBetween(16, 0, 16, 32)
    plat.lineBetween(0, 16, 32, 16)
    plat.generateTexture('platform', 32, 32)
    plat.destroy()

    // Ground tile
    const ground = this.add.graphics()
    ground.fillStyle(0x3a5a40)
    ground.fillRect(0, 0, 32, 32)
    ground.lineStyle(1, 0x4a6a50)
    ground.strokeRect(0, 0, 32, 32)
    ground.generateTexture('ground', 32, 32)
    ground.destroy()

    // Coin
    const coin = this.add.graphics()
    coin.fillStyle(0xffd700)
    coin.fillCircle(8, 8, 8)
    coin.fillStyle(0xffaa00)
    coin.fillCircle(8, 8, 5)
    coin.fillStyle(0xffd700)
    coin.fillCircle(7, 7, 3)
    coin.generateTexture('coin', 16, 16)
    coin.destroy()

    // Spike
    const spike = this.add.graphics()
    spike.fillStyle(0xcc3333)
    spike.fillTriangle(0, 16, 8, 0, 16, 16)
    spike.generateTexture('spike', 16, 16)
    spike.destroy()
  }
}
