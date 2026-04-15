import * as Phaser from 'phaser'
import { gameStore } from '../store'
import { connectToServer, sendPosition, getLocalIdentity, setOnPlayersChanged, type RemotePlayer } from '../network'
import { Identity } from 'spacetimedb'

// Level layout: # = platform, . = empty, C = coin, S = spike, P = player start
const LEVEL = [
  '.........................',
  '.........................',
  '..............C..........',
  '.............###.........',
  '.........................',
  '......C..................',
  '.....###.........C.......',
  '................###......',
  '..C......................',
  '.###..........C..........',
  '...............###..C....',
  '...................###...',
  'P.......C................',
  '####..........####.......',
  '.........................',
  '...C.....C.....C....C....',
  '..###...###...###..###...',
  '.........................',
  '#########################',
]

const TILE = 32
const SEND_INTERVAL = 50 // ms between position updates

export class GameScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite
  private platforms!: Phaser.Physics.Arcade.StaticGroup
  private coins!: Phaser.Physics.Arcade.Group
  private spikes!: Phaser.Physics.Arcade.StaticGroup
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key }
  private scoreText!: Phaser.GameObjects.Text
  private winText!: Phaser.GameObjects.Text
  private connectionText!: Phaser.GameObjects.Text
  private spawnX = 0
  private spawnY = 0

  // Multiplayer
  private remotePlayers = new Map<string, Phaser.GameObjects.Container>()
  private lastSendTime = 0
  private lastDirection = 0
  private connected = false

  constructor() {
    super('Game')
  }

  create() {
    gameStore.getState().start()

    this.platforms = this.physics.add.staticGroup()
    this.coins = this.physics.add.group()
    this.spikes = this.physics.add.staticGroup()

    let coinCount = 0

    // Build level from layout
    for (let row = 0; row < LEVEL.length; row++) {
      for (let col = 0; col < LEVEL[row].length; col++) {
        const x = col * TILE + TILE / 2
        const y = row * TILE + TILE / 2
        const ch = LEVEL[row][col]

        if (ch === '#') {
          this.platforms.create(x, y, 'ground')
        } else if (ch === 'C') {
          const coin = this.coins.create(x, y, 'coin') as Phaser.Physics.Arcade.Sprite
          coin.setData('baseY', y)
          coin.body!.setAllowGravity(false)
          coinCount++
        } else if (ch === 'S') {
          this.spikes.create(x, y, 'spike')
        } else if (ch === 'P') {
          this.spawnX = x
          this.spawnY = y
        }
      }
    }

    gameStore.getState().setTotalCoins(coinCount)

    // Player
    this.player = this.physics.add.sprite(this.spawnX, this.spawnY, 'player')
    this.player.setCollideWorldBounds(true)
    this.player.setBounce(0.1)
    this.player.setDepth(10)

    // Collisions
    this.physics.add.collider(this.player, this.platforms)
    this.physics.add.overlap(this.player, this.coins, this.collectCoin, undefined, this)

    // World bounds
    this.physics.world.setBounds(0, 0, LEVEL[0].length * TILE, LEVEL.length * TILE)
    this.cameras.main.setBounds(0, 0, LEVEL[0].length * TILE, LEVEL.length * TILE)
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1)

    // Input
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.wasd = {
      W: this.input.keyboard!.addKey('W'),
      A: this.input.keyboard!.addKey('A'),
      S: this.input.keyboard!.addKey('S'),
      D: this.input.keyboard!.addKey('D'),
    }

    // HUD (fixed to camera)
    this.scoreText = this.add
      .text(16, 16, '', {
        fontSize: '18px',
        color: '#ffd700',
        fontFamily: 'monospace',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setScrollFactor(0)
      .setDepth(100)

    this.winText = this.add
      .text(400, 200, '', {
        fontSize: '36px',
        color: '#00ff88',
        fontFamily: 'monospace',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false)

    // Connection status
    this.connectionText = this.add
      .text(800 - 16, 16, 'Connecting...', {
        fontSize: '14px',
        color: '#ffaa00',
        fontFamily: 'monospace',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100)

    this.updateScoreText()

    // Connect to SpacetimeDB
    setOnPlayersChanged((players) => this.onPlayersChanged(players))
    connectToServer()
      .then(() => {
        this.connected = true
        this.connectionText.setText('Online').setColor('#00ff88')
      })
      .catch((err) => {
        console.error('Failed to connect:', err)
        this.connectionText.setText('Offline').setColor('#ff4444')
      })
  }

  update(time: number, delta: number) {
    gameStore.getState().tick(delta / 1000)

    const left = this.cursors.left.isDown || this.wasd.A.isDown
    const right = this.cursors.right.isDown || this.wasd.D.isDown
    const jump = this.cursors.up.isDown || this.wasd.W.isDown || this.input.keyboard!.addKey('SPACE').isDown

    // Movement
    let direction = 0
    if (left) {
      this.player.setVelocityX(-200)
      this.player.setFlipX(true)
      direction = -1
    } else if (right) {
      this.player.setVelocityX(200)
      this.player.setFlipX(false)
      direction = 1
    } else {
      this.player.setVelocityX(0)
    }
    this.lastDirection = direction

    // Jump
    if (jump && this.player.body!.touching.down) {
      this.player.setVelocityY(-400)
    }

    // Animate coins (bob up and down)
    this.coins.getChildren().forEach((c) => {
      const coin = c as Phaser.Physics.Arcade.Sprite
      const baseY = coin.getData('baseY') as number
      coin.y = baseY + Math.sin(time * 0.005) * 4
    })

    // Fall off the bottom — respawn
    if (this.player.y > LEVEL.length * TILE + 50) {
      this.player.setPosition(this.spawnX, this.spawnY)
      this.player.setVelocity(0, 0)
    }

    // Send position to server
    if (this.connected && time - this.lastSendTime > SEND_INTERVAL) {
      sendPosition(this.player.x, this.player.y, this.lastDirection)
      this.lastSendTime = time
    }
  }

  private onPlayersChanged(players: RemotePlayer[]) {
    const localId = getLocalIdentity()
    const activeIds = new Set<string>()

    for (const p of players) {
      // Skip local player
      if (localId && p.identity.toHexString() === localId.toHexString()) continue

      const id = p.identity.toHexString()
      activeIds.add(id)

      let container = this.remotePlayers.get(id)
      if (!container) {
        container = this.createRemotePlayer(p.color)
        this.remotePlayers.set(id, container)
      }

      // Smoothly lerp to target position
      this.tweens.add({
        targets: container,
        x: p.x,
        y: p.y,
        duration: SEND_INTERVAL,
        ease: 'Linear',
      })

      // Flip based on direction
      const body = container.getAt(0) as Phaser.GameObjects.Rectangle
      if (p.directionX < 0) {
        body.setScale(-1, 1)
      } else if (p.directionX > 0) {
        body.setScale(1, 1)
      }
    }

    // Remove disconnected players
    for (const [id, container] of this.remotePlayers) {
      if (!activeIds.has(id)) {
        container.destroy()
        this.remotePlayers.delete(id)
      }
    }

    // Update player count in connection text
    if (this.connected) {
      const total = players.length
      this.connectionText.setText(`Online (${total} player${total !== 1 ? 's' : ''})`)
    }
  }

  private createRemotePlayer(color: number): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0)
    container.setDepth(5)

    // Body — colored rectangle
    const hexStr = '#' + color.toString(16).padStart(6, '0')
    const body = this.add.rectangle(0, 0, 28, 32, color)
    body.setStrokeStyle(2, 0xffffff, 0.5)

    // Name tag
    const label = this.add.text(0, -24, 'Player', {
      fontSize: '10px',
      color: hexStr,
      fontFamily: 'monospace',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5)

    container.add([body, label])
    return container
  }

  private collectCoin(_player: any, coinObj: any) {
    const coin = coinObj as Phaser.Physics.Arcade.Sprite
    coin.destroy()

    gameStore.getState().collectCoin()
    this.updateScoreText()

    const { coins, totalCoins } = gameStore.getState()
    if (coins >= totalCoins) {
      this.winText.setText('You Win!').setVisible(true)
    }
  }

  private updateScoreText() {
    const { coins, totalCoins } = gameStore.getState()
    this.scoreText.setText(`Coins: ${coins} / ${totalCoins}`)
  }
}
