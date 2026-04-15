import * as Phaser from 'phaser'
import { gameStore } from '../store'

export class GameScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite
  private platforms!: Phaser.Physics.Arcade.StaticGroup
  private obstacles!: Phaser.Physics.Arcade.Group
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private hudText!: Phaser.GameObjects.Text

  constructor() {
    super('Game')
  }

  create() {
    gameStore.getState().start()

    // Platforms
    this.platforms = this.physics.add.staticGroup()

    // Ground
    for (let x = 0; x < 800; x += 64) {
      this.platforms.create(x + 32, 592, 'platform').setScale(1, 1).refreshBody()
    }

    // Floating platforms
    this.platforms.create(300, 450, 'platform').setScale(2, 1).refreshBody()
    this.platforms.create(600, 350, 'platform').setScale(2, 1).refreshBody()
    this.platforms.create(150, 250, 'platform').setScale(2, 1).refreshBody()

    // Player
    this.player = this.physics.add.sprite(100, 500, 'player')
    this.player.setCollideWorldBounds(true)
    this.player.setBounce(0.1)
    this.physics.add.collider(this.player, this.platforms)

    // Obstacles
    this.obstacles = this.physics.add.group()
    this.spawnObstacle(500, 300)
    this.spawnObstacle(350, 150)
    this.physics.add.collider(this.obstacles, this.platforms)

    // Input
    this.cursors = this.input.keyboard!.createCursorKeys()

    // HUD
    this.hudText = this.add
      .text(16, 16, 'Game Running', {
        fontSize: '14px',
        color: '#ffffff',
        fontFamily: 'monospace',
      })
      .setScrollFactor(0)
  }

  update(_time: number, delta: number) {
    gameStore.getState().tick(delta / 1000)

    // Movement
    if (this.cursors.left.isDown) {
      this.player.setVelocityX(-200)
    } else if (this.cursors.right.isDown) {
      this.player.setVelocityX(200)
    } else {
      this.player.setVelocityX(0)
    }

    // Jump
    if (this.cursors.up.isDown && this.player.body!.touching.down) {
      this.player.setVelocityY(-350)
    }

    // Update HUD
    const elapsed = gameStore.getState().elapsed.toFixed(1)
    this.hudText.setText(`Time: ${elapsed}s`)
  }

  private spawnObstacle(x: number, y: number) {
    const obstacle = this.obstacles.create(x, y, 'obstacle') as Phaser.Physics.Arcade.Sprite
    obstacle.setBounce(0.5)
    obstacle.setCollideWorldBounds(true)
  }
}
