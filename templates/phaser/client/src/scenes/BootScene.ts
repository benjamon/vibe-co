import * as Phaser from 'phaser'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create() {
    // Generate placeholder textures procedurally (no asset files needed)
    this.generateTextures()

    // Show "Click to Start" text
    const text = this.add
      .text(400, 300, 'Click to Start', {
        fontSize: '32px',
        color: '#ffffff',
        fontFamily: 'monospace',
      })
      .setOrigin(0.5)

    this.input.once('pointerdown', () => {
      this.scene.start('Game')
    })
  }

  private generateTextures() {
    // Player: red rectangle
    const playerGfx = this.add.graphics()
    playerGfx.fillStyle(0xe94560)
    playerGfx.fillRect(0, 0, 32, 32)
    playerGfx.generateTexture('player', 32, 32)
    playerGfx.destroy()

    // Platform: green rectangle
    const platformGfx = this.add.graphics()
    platformGfx.fillStyle(0x2d4a3e)
    platformGfx.fillRect(0, 0, 64, 16)
    platformGfx.generateTexture('platform', 64, 16)
    platformGfx.destroy()

    // Obstacle: blue rectangle
    const obstacleGfx = this.add.graphics()
    obstacleGfx.fillStyle(0x0f3460)
    obstacleGfx.fillRect(0, 0, 32, 32)
    obstacleGfx.generateTexture('obstacle', 32, 32)
    obstacleGfx.destroy()
  }
}
