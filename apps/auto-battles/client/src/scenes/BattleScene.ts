import * as Phaser from 'phaser'
import { gameStore, generateOpponentTeam } from '../store'
import { simulateBattle } from '../battle-sim'
import type {
  AbilityBlock,
  AtomicEvent,
  AttackEvent,
  BattleEventBlock,
  BattleResult,
  CombatRoundBlock,
  OwnedHero,
  UnitRef,
} from '../types'
import { computeLayout, type Layout } from '../layout'

// ── Tunables ──────────────────────────────────────────────────────────────

const SLIDE_IN_DURATION = 2200
const CASTER_DOT_DURATION = 250
const ATOM_DELAY_MS = 600
const COMBAT_LUNGE_MS = 140
const COMBAT_RESOLVE_MS = 700
const DEATH_FADE_MS = 280
const REARRANGE_MS = 480
const STAT_POPUP_MS = 750
const DAMAGE_POPUP_MS = 600

// ── Sprite-side state ─────────────────────────────────────────────────────

interface UnitSprite {
  ref: UnitRef
  /** Logical front-to-back index in the side's queue. */
  queueIndex: number
  container: Phaser.GameObjects.Container
  hpText: Phaser.GameObjects.Text
  atkText: Phaser.GameObjects.Text
  hpBar: Phaser.GameObjects.Graphics
  // Live mirror of state shown on screen.
  hp: number
  maxHp: number
  attack: number
  alive: boolean
}

function refKey(ref: UnitRef): string {
  return `${ref.side}-${ref.originalIndex}`
}

function delay(scene: Phaser.Scene, ms: number): Promise<void> {
  return new Promise((resolve) => scene.time.delayedCall(ms, () => resolve()))
}

// ── Scene ─────────────────────────────────────────────────────────────────

function starsString(n: number): string {
  return '★'.repeat(n)
}

export class BattleScene extends Phaser.Scene {
  private L!: Layout
  private result!: BattleResult
  private statusText!: Phaser.GameObjects.Text
  private sprites = new Map<string, UnitSprite>()
  private playerOrder: string[] = [] // refKeys, front-to-back
  private opponentOrder: string[] = []
  private casterDot: Phaser.GameObjects.Graphics | null = null

  constructor() {
    super('Battle')
  }

  create() {
    this.events.once('shutdown', () => {
      this.tweens.killAll()
      this.time.removeAllEvents()
      this.sprites.clear()
    })

    const { width, height } = this.scale
    this.L = computeLayout(width, height)
    const L = this.L
    const state = gameStore.getState()

    this.cameras.main.setAlpha(0)
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 300 })

    const rawPlayerTeam: OwnedHero[] = state.team.map((h) => ({
      hero: { ...h.hero },
      currentHp: h.hero.hp,
      stars: h.stars,
    }))
    const rawOpponentTeam = generateOpponentTeam(state.round)
    this.result = simulateBattle(rawPlayerTeam, rawOpponentTeam)

    this.drawHud(state.round, state.hearts)
    this.spawnTeams(this.result.initialPlayerTeam, this.result.initialOpponentTeam)

    this.statusText = this.add.text(L.cx, L.battle.statusY, '', {
      fontSize: L.fs(14),
      color: '#ffffff',
      fontFamily: 'monospace',
    }).setOrigin(0.5)

    this.time.delayedCall(SLIDE_IN_DURATION + 200, () => this.playBlocks())
  }

  // ── Setup helpers ──────────────────────────────────────────────────────

  private drawHud(round: number, hearts: number) {
    const L = this.L
    const b = L.battle
    this.add.text(L.cx, b.titleY, `ROUND ${round} — BATTLE`, {
      fontSize: L.fs(22), color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5)
    for (let i = 0; i < 5; i++) {
      this.add.image(L.s * 20 + i * L.s * 28, b.heartsY, i < hearts ? 'heart' : 'heart-empty')
        .setScale(0.7 * L.s)
    }
    this.add.text(L.s * 60, b.labelY, 'YOUR TEAM',
      { fontSize: L.fs(12), color: '#4ecdc4', fontFamily: 'monospace' })
    this.add.text(L.w - L.s * 60, b.labelY, 'ENEMY',
      { fontSize: L.fs(12), color: '#e94560', fontFamily: 'monospace' }).setOrigin(1, 0)
    this.add.text(b.centerX, b.vsY, 'VS', {
      fontSize: L.fs(28), color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5)
  }

  private spawnTeams(playerTeam: OwnedHero[], opponentTeam: OwnedHero[]) {
    const L = this.L
    const b = L.battle

    this.playerOrder = []
    for (let i = 0; i < playerTeam.length; i++) {
      const ref: UnitRef = { side: 'player', originalIndex: i }
      const targetX = b.centerX - L.s * 60 - i * b.spriteGap
      const startX = -L.s * 80 - i * b.spriteGap
      const sprite = this.createUnitSprite(startX, b.queueY, playerTeam[i], ref, i)
      this.sprites.set(refKey(ref), sprite)
      this.playerOrder.push(refKey(ref))
      this.tweens.add({
        targets: sprite.container, x: targetX, duration: SLIDE_IN_DURATION, ease: 'Power2',
      })
    }
    this.opponentOrder = []
    for (let i = 0; i < opponentTeam.length; i++) {
      const ref: UnitRef = { side: 'opponent', originalIndex: i }
      const targetX = b.centerX + L.s * 60 + i * b.spriteGap
      const startX = L.w + L.s * 80 + i * b.spriteGap
      const sprite = this.createUnitSprite(startX, b.queueY, opponentTeam[i], ref, i)
      this.sprites.set(refKey(ref), sprite)
      this.opponentOrder.push(refKey(ref))
      this.tweens.add({
        targets: sprite.container, x: targetX, duration: SLIDE_IN_DURATION, ease: 'Power2',
      })
    }
  }

  private createUnitSprite(
    x: number, y: number, hero: OwnedHero, ref: UnitRef, queueIndex: number,
  ): UnitSprite {
    const L = this.L
    const b = L.battle
    const container = this.add.container(x, y)

    const img = this.add.image(0, 0, hero.hero.id)
    img.setScale(Math.min(b.spriteSize / img.width, b.spriteSize / img.height, 1))
    container.add(img)

    const nameColor = ref.side === 'player' ? '#4ecdc4' : '#e94560'
    container.add(this.add.text(0, L.s * 32, `${starsString(hero.stars)} ${hero.hero.name}`, {
      fontSize: L.fs(9), color: nameColor, fontFamily: 'monospace',
    }).setOrigin(0.5))

    const hpText = this.add.text(-L.s * 16, -L.s * 30, `${hero.currentHp}`, {
      fontSize: L.fs(16), color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: Math.round(3 * L.s),
    }).setOrigin(1, 0.5)
    container.add(hpText)

    const atkText = this.add.text(L.s * 16, -L.s * 30, `${hero.hero.attack}`, {
      fontSize: L.fs(16), color: '#e94560', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: Math.round(3 * L.s),
    }).setOrigin(0, 0.5)
    container.add(atkText)

    const hpBar = this.add.graphics()
    container.add(hpBar)

    const sprite: UnitSprite = {
      ref,
      queueIndex,
      container,
      hpText,
      atkText,
      hpBar,
      hp: hero.currentHp,
      maxHp: hero.hero.hp,
      attack: hero.hero.attack,
      alive: true,
    }
    this.redrawHpBar(sprite)
    return sprite
  }

  // ── Generic redraws ────────────────────────────────────────────────────

  private redrawHpBar(sprite: UnitSprite) {
    const b = this.L.battle
    const pct = sprite.maxHp > 0 ? Math.max(0, sprite.hp) / sprite.maxHp : 0
    const color = pct > 0.5 ? 0x4ecdc4 : pct > 0.25 ? 0xf39c12 : 0xe94560
    sprite.hpBar.clear()
    sprite.hpBar.fillStyle(0x333333)
    sprite.hpBar.fillRoundedRect(-b.barW / 2, b.barY, b.barW, b.barH, 2)
    sprite.hpBar.fillStyle(color)
    sprite.hpBar.fillRoundedRect(-b.barW / 2, b.barY, b.barW * pct, b.barH, 2)
  }

  private redrawStats(sprite: UnitSprite) {
    sprite.hpText.setText(`${Math.max(0, sprite.hp)}`)
    sprite.atkText.setText(`${sprite.attack}`)
    this.redrawHpBar(sprite)
  }

  private positionFor(side: 'player' | 'opponent', queueIndex: number): number {
    const L = this.L
    const b = L.battle
    return side === 'player'
      ? b.centerX - L.s * 60 - queueIndex * b.spriteGap
      : b.centerX + L.s * 60 + queueIndex * b.spriteGap
  }

  private layoutSide(side: 'player' | 'opponent') {
    const order = side === 'player' ? this.playerOrder : this.opponentOrder
    for (let i = 0; i < order.length; i++) {
      const sprite = this.sprites.get(order[i])
      if (!sprite) continue
      sprite.queueIndex = i
      const targetX = this.positionFor(side, i)
      this.tweens.add({ targets: sprite.container, x: targetX, duration: REARRANGE_MS, ease: 'Power2' })
    }
  }

  // ── Top-level player ───────────────────────────────────────────────────

  private async playBlocks() {
    for (const block of this.result.blocks) {
      await this.playBlock(block)
    }
    this.finishBattle()
  }

  private async playBlock(block: BattleEventBlock): Promise<void> {
    switch (block.kind) {
      case 'phase':
        return this.playPhase(block)
      case 'abilityBlock':
        return this.playAbilityBlock(block)
      case 'combatRound':
        return this.playCombatRound(block)
    }
  }

  private async playPhase(block: Extract<BattleEventBlock, { kind: 'phase' }>) {
    if (block.phase === 'preBattle') {
      this.statusText.setText('PRE-BATTLE ABILITIES')
      await delay(this, 400)
    } else if (block.phase === 'combat') {
      await this.dismissCasterDot()
      this.statusText.setText('COMBAT')
      await delay(this, 300)
    } else if (block.phase === 'end') {
      await this.dismissCasterDot()
      this.statusText.setText('')
    }
  }

  // ── Ability block ──────────────────────────────────────────────────────

  private async playAbilityBlock(block: AbilityBlock) {
    const caster = this.sprites.get(refKey(block.caster))
    if (caster) {
      await this.showCasterDot(caster)
      this.statusText.setText(`${caster.container.name || ''} ${block.abilityName}`.trim() || block.abilityName)
    }
    for (const atom of block.events) {
      await this.playAtom(atom)
      await delay(this, 80)
    }
    await delay(this, ATOM_DELAY_MS / 2)
    await this.dismissCasterDot()
  }

  private async showCasterDot(caster: UnitSprite) {
    await this.dismissCasterDot()
    const L = this.L
    const dot = this.add.graphics()
    dot.setPosition(caster.container.x, caster.container.y - L.s * 32)
    dot.fillStyle(0xf1c40f, 1)
    dot.fillCircle(0, 0, 4 * L.s)
    dot.setScale(3).setAlpha(0)
    this.casterDot = dot
    this.tweens.add({
      targets: dot,
      scaleX: 1, scaleY: 1, alpha: 1,
      duration: CASTER_DOT_DURATION,
      ease: 'Back.easeOut',
    })
    await delay(this, CASTER_DOT_DURATION)
  }

  private async dismissCasterDot() {
    if (!this.casterDot) return
    const dot = this.casterDot
    this.casterDot = null
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: dot, scaleX: 3, scaleY: 3, alpha: 0,
        duration: 180, ease: 'Sine.easeIn',
        onComplete: () => { dot.destroy(); resolve() },
      })
    })
  }

  // ── Combat round ───────────────────────────────────────────────────────

  private async playCombatRound(block: CombatRoundBlock) {
    // 1) Lunges (simultaneous).
    for (const a of block.attacks) {
      this.lungeAttacker(a)
    }
    // 2) Damage popups + state updates appear at the impact frame.
    await delay(this, COMBAT_LUNGE_MS)
    for (const a of block.attacks) {
      this.applyAttackVisual(a)
    }
    await delay(this, COMBAT_RESOLVE_MS * 0.4)
    // 3) Reactions (Athena / Ares).
    for (const reaction of block.reactions) {
      await this.playAbilityBlock(reaction)
    }
    // 4) Deaths from attacks animate, then queue compacts.
    const deaths: UnitRef[] = []
    for (const a of block.attacks) {
      if (a.defenderDied) deaths.push(a.defender)
    }
    for (const ref of deaths) {
      await this.playDeath(ref)
    }
    if (deaths.length > 0) {
      this.layoutSide('player')
      this.layoutSide('opponent')
    }
    await delay(this, COMBAT_RESOLVE_MS * 0.3)
  }

  private lungeAttacker(attack: AttackEvent) {
    const sprite = this.sprites.get(refKey(attack.attacker))
    if (!sprite || !sprite.alive) return
    const dir = attack.attacker.side === 'player' ? 1 : -1
    const dist = this.L.battle.lungeDistance * dir
    this.tweens.add({
      targets: sprite.container,
      x: sprite.container.x + dist,
      duration: COMBAT_LUNGE_MS,
      yoyo: true,
    })
  }

  private applyAttackVisual(attack: AttackEvent) {
    const defender = this.sprites.get(refKey(attack.defender))
    if (!defender) return
    defender.hp = attack.defenderRemainingHp
    this.redrawStats(defender)
    this.popDamageNumber(defender, attack.damage)
  }

  // ── Atomic event visualizers ───────────────────────────────────────────

  private async playAtom(atom: AtomicEvent): Promise<void> {
    switch (atom.kind) {
      case 'damage':
        return this.playDamageAtom(atom)
      case 'statChange':
        return this.playStatChangeAtom(atom)
      case 'amplify':
        return this.playAmplifyAtom(atom)
      case 'rearrange':
        return this.playRearrangeAtom(atom)
      case 'death':
        return this.playDeath(atom.target)
    }
  }

  private async playDamageAtom(atom: Extract<AtomicEvent, { kind: 'damage' }>) {
    const target = this.sprites.get(refKey(atom.target))
    if (!target) return
    this.flashTargetCircle(target)
    target.hp = atom.remainingHp
    this.redrawStats(target)
    this.popDamageNumber(target, atom.amount)
    await delay(this, DAMAGE_POPUP_MS)
  }

  private async playStatChangeAtom(atom: Extract<AtomicEvent, { kind: 'statChange' }>) {
    const target = this.sprites.get(refKey(atom.target))
    if (!target) return
    target.hp = atom.remainingHp
    target.maxHp = atom.newMaxHp
    target.attack = atom.newAttack
    this.redrawStats(target)
    this.flashTargetCircle(target, atom.permanent ? 0xf1c40f : 0x4ecdc4)
    if (atom.hpDelta !== 0) {
      this.popStatNumber(target, atom.hpDelta, '#ffffff', -1)
    }
    if (atom.attackDelta !== 0) {
      this.popStatNumber(target, atom.attackDelta, '#e94560', 1)
    }
    await delay(this, STAT_POPUP_MS)
  }

  private async playAmplifyAtom(atom: Extract<AtomicEvent, { kind: 'amplify' }>) {
    const target = this.sprites.get(refKey(atom.target))
    if (!target) return
    this.flashTargetCircle(target, 0xf1c40f)
    this.popStatNumber(target, atom.bonus, '#f1c40f', 0, '+')
    await delay(this, STAT_POPUP_MS * 0.7)
  }

  private async playRearrangeAtom(atom: Extract<AtomicEvent, { kind: 'rearrange' }>) {
    // Defensively drop refs whose sprites have already been removed from the
    // scene (dead/destroyed) so layoutSide doesn't tween a destroyed object.
    const order = atom.newOrder
      .map(refKey)
      .filter((key) => {
        const s = this.sprites.get(key)
        return Boolean(s && s.alive)
      })
    if (atom.side === 'player') this.playerOrder = order
    else this.opponentOrder = order
    this.layoutSide(atom.side)
    await delay(this, REARRANGE_MS)
  }

  private async playDeath(ref: UnitRef): Promise<void> {
    const target = this.sprites.get(refKey(ref))
    if (!target || !target.alive) return
    target.alive = false
    target.hp = 0
    this.redrawStats(target)
    const orderArr = ref.side === 'player' ? this.playerOrder : this.opponentOrder
    const idx = orderArr.indexOf(refKey(ref))
    if (idx !== -1) orderArr.splice(idx, 1)
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: target.container,
        alpha: 0,
        y: target.container.y + this.L.s * 20,
        duration: DEATH_FADE_MS,
        onComplete: () => { target.container.destroy(); resolve() },
      })
    })
  }

  // ── Floaters / flashes ─────────────────────────────────────────────────

  private flashTargetCircle(target: UnitSprite, color: number = 0xffffff) {
    const L = this.L
    const cx = target.container.x
    const cy = target.container.y
    const circle = this.add.graphics()
    circle.setPosition(cx, cy)
    circle.lineStyle(2, color, 0.85)
    circle.strokeCircle(0, 0, 8 * L.s)
    this.tweens.add({
      targets: circle, scaleX: 2.5, scaleY: 2.5, alpha: 0,
      duration: 380, onComplete: () => circle.destroy(),
    })
  }

  private popDamageNumber(target: UnitSprite, damage: number) {
    const L = this.L
    const t = this.add.text(target.container.x, target.container.y - L.s * 32,
      `-${damage}`, {
        fontSize: L.fs(18), color: '#ff4444', fontFamily: 'monospace', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: Math.round(3 * L.s),
      }).setOrigin(0.5)
    this.tweens.add({
      targets: t, y: t.y - L.s * 28, alpha: 0,
      duration: DAMAGE_POPUP_MS, onComplete: () => t.destroy(),
    })
  }

  private popStatNumber(
    target: UnitSprite, delta: number, color: string, xOffsetDir: -1 | 0 | 1, prefix: string = '',
  ) {
    const L = this.L
    const x = target.container.x + xOffsetDir * L.s * 16
    const y = target.container.y - L.s * 50
    const sign = delta >= 0 ? '+' : ''
    const t = this.add.text(x, y, `${prefix}${sign}${delta}`, {
      fontSize: L.fs(13), color, fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: Math.round(2 * L.s),
    }).setOrigin(0.5)
    this.tweens.add({
      targets: t, y: y - L.s * 26, alpha: 0,
      duration: STAT_POPUP_MS, onComplete: () => t.destroy(),
    })
  }

  // ── Finish ─────────────────────────────────────────────────────────────

  private finishBattle() {
    const L = this.L
    const b = L.battle
    gameStore.getState().finishBattle(this.result)
    const outcome = this.result.outcome
    const label = outcome === 'won' ? 'VICTORY!' : outcome === 'draw' ? 'DRAW!' : 'DEFEAT!'
    const color = outcome === 'won' ? '#4ecdc4' : outcome === 'draw' ? '#f1c40f' : '#e94560'
    this.statusText.setText(label).setColor(color).setFontSize(Math.round(24 * L.s))

    const big = outcome === 'won' ? 'WIN' : outcome === 'draw' ? 'DRAW' : 'LOSE'
    const bigText = this.add.text(L.cx, b.resultY, big, {
      fontSize: L.fs(64), color, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setAlpha(0)
    this.tweens.add({ targets: bigText, alpha: 0.3, duration: 400 })

    this.time.delayedCall(1600, () => {
      this.tweens.add({
        targets: this.cameras.main, alpha: 0, duration: 400,
        onComplete: () => {
          const s = gameStore.getState()
          if (s.phase === 'gameover') this.scene.start('GameOver')
          else { s.returnToShop(); this.scene.start('Shop') }
        },
      })
    })
  }
}
