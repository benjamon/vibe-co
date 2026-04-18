import * as Phaser from 'phaser'
import { gameStore, generateOpponentTeam } from '../store'
import { simulateBattle } from '../battle-sim'
import type { OwnedHero, BattleStep, PreBattleEffect } from '../types'
import { computeLayout, type Layout } from '../layout'

const STEP_DELAY = 700
const LUNGE_DURATION = 120

function starsString(n: number): string {
  return '\u2605'.repeat(n)
}

interface HeroSprite {
  container: Phaser.GameObjects.Container
  hpText: Phaser.GameObjects.Text
  atkText: Phaser.GameObjects.Text
  hpBarBg: Phaser.GameObjects.Graphics
  hpBarFill: Phaser.GameObjects.Graphics
  maxHp: number
}

export class BattleScene extends Phaser.Scene {
  private stepIndex = 0
  private steps: BattleStep[] = []
  private playerSprites: HeroSprite[] = []
  private opponentSprites: HeroSprite[] = []
  private statusText!: Phaser.GameObjects.Text
  private playerTeam: OwnedHero[] = []
  private opponentTeam: OwnedHero[] = []
  private battleResult!: ReturnType<typeof simulateBattle>
  private playerQueueIndex = 0
  private opponentQueueIndex = 0
  private L!: Layout

  constructor() {
    super('Battle')
  }

  create() {
    this.events.once('shutdown', () => { this.tweens.killAll(); this.time.removeAllEvents() })
    const { width, height } = this.scale
    this.L = computeLayout(width, height)
    const L = this.L
    const state = gameStore.getState()

    this.cameras.main.setAlpha(0)
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 300 })

    const rawPlayerTeam = state.team.map((h) => ({ hero: { ...h.hero }, currentHp: h.hero.hp, stars: h.stars }))
    const rawOpponentTeam = generateOpponentTeam(state.round)
    this.battleResult = simulateBattle(rawPlayerTeam, rawOpponentTeam)

    this.playerTeam = this.battleResult.prePrePlayerTeam
    this.opponentTeam = this.battleResult.prePreOpponentTeam
    this.steps = this.battleResult.steps
    this.stepIndex = 0
    this.playerQueueIndex = 0
    this.opponentQueueIndex = 0

    const b = L.battle

    this.add.text(L.cx, b.titleY, `ROUND ${state.round} — BATTLE`, {
      fontSize: L.fs(22), color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5)

    for (let i = 0; i < 5; i++) {
      this.add.image(L.s * 20 + i * L.s * 28, b.heartsY, i < state.hearts ? 'heart' : 'heart-empty').setScale(0.7 * L.s)
    }

    this.add.text(L.s * 60, b.labelY, 'YOUR TEAM', { fontSize: L.fs(12), color: '#4ecdc4', fontFamily: 'monospace' })
    this.add.text(L.w - L.s * 60, b.labelY, 'ENEMY', { fontSize: L.fs(12), color: '#e94560', fontFamily: 'monospace' }).setOrigin(1, 0)
    this.add.text(b.centerX, b.vsY, 'VS', { fontSize: L.fs(28), color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(0.5)

    // Slide-in sprites
    this.playerSprites = []
    for (let i = 0; i < this.playerTeam.length; i++) {
      const h = this.playerTeam[i]
      const targetX = b.centerX - L.s * 60 - i * b.spriteGap
      const startX = -L.s * 80 - i * b.spriteGap
      const hs = this.createHeroSprite(startX, b.queueY, h, 'player')
      this.playerSprites.push(hs)
      this.tweens.add({ targets: hs.container, x: targetX, duration: 3000, ease: 'Power2' })
    }
    this.opponentSprites = []
    for (let i = 0; i < this.opponentTeam.length; i++) {
      const h = this.opponentTeam[i]
      const targetX = b.centerX + L.s * 60 + i * b.spriteGap
      const startX = L.w + L.s * 80 + i * b.spriteGap
      const hs = this.createHeroSprite(startX, b.queueY, h, 'opponent')
      this.opponentSprites.push(hs)
      this.tweens.add({ targets: hs.container, x: targetX, duration: 3000, ease: 'Power2' })
    }

    this.statusText = this.add.text(L.cx, b.statusY, '', {
      fontSize: L.fs(14), color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5)

    this.time.delayedCall(4000, () => {
      const preFx = this.battleResult.preBattleEffects
      if (preFx.length > 0) { this.showPreBattleEffects(preFx, 0) }
      else { this.rebuildForCombat(); this.time.delayedCall(300, () => this.playStep()) }
    })
  }

  private createHeroSprite(x: number, y: number, hero: OwnedHero, side: 'player' | 'opponent'): HeroSprite {
    const L = this.L
    const b = L.battle
    const container = this.add.container(x, y)
    const img = this.add.image(0, 0, hero.hero.id)
    img.setScale(Math.min(b.spriteSize / img.width, b.spriteSize / img.height, 1))
    container.add(img)

    const nameColor = side === 'player' ? '#4ecdc4' : '#e94560'
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

    const hpBarBg = this.add.graphics()
    hpBarBg.fillStyle(0x333333)
    hpBarBg.fillRoundedRect(-b.barW / 2, b.barY, b.barW, b.barH, 2)
    container.add(hpBarBg)

    const hpBarFill = this.add.graphics()
    const initPct = hero.currentHp / hero.hero.hp
    const initColor = initPct > 0.5 ? 0x4ecdc4 : initPct > 0.25 ? 0xf39c12 : 0xe94560
    hpBarFill.fillStyle(initColor)
    hpBarFill.fillRoundedRect(-b.barW / 2, b.barY, b.barW * initPct, b.barH, 2)
    container.add(hpBarFill)

    return { container, hpText, atkText, hpBarBg, hpBarFill, maxHp: hero.hero.hp }
  }

  private updateHpDisplays() {
    const b = this.L.battle
    const updateSide = (sprites: HeroSprite[], team: OwnedHero[], queueIdx: number) => {
      for (let i = 0; i < sprites.length; i++) {
        const teamIdx = queueIdx + i
        if (teamIdx < team.length) {
          const h = team[teamIdx]; const s = sprites[i]
          s.hpText.setText(`${Math.max(0, h.currentHp)}`)
          s.atkText.setText(`${h.hero.attack}`)
          const pct = Math.max(0, h.currentHp) / s.maxHp
          const color = pct > 0.5 ? 0x4ecdc4 : pct > 0.25 ? 0xf39c12 : 0xe94560
          s.hpBarFill.clear(); s.hpBarFill.fillStyle(color)
          s.hpBarFill.fillRoundedRect(-b.barW / 2, b.barY, b.barW * pct, b.barH, 2)
        }
      }
    }
    updateSide(this.playerSprites, this.playerTeam, this.playerQueueIndex)
    updateSide(this.opponentSprites, this.opponentTeam, this.opponentQueueIndex)
  }

  // ── Pre-battle abilities ──

  private casterDot: Phaser.GameObjects.Graphics | null = null
  private casterDotTween: Phaser.Tweens.Tween | null = null
  private currentCasterKey = ''

  private dismissCasterDot(onComplete?: () => void) {
    if (this.casterDotTween) { this.casterDotTween.destroy(); this.casterDotTween = null }
    if (this.casterDot) {
      this.tweens.add({
        targets: this.casterDot, scaleX: 3, scaleY: 3, alpha: 0, duration: 200, ease: 'Sine.easeIn',
        onComplete: () => { if (this.casterDot) { this.casterDot.destroy(); this.casterDot = null } if (onComplete) onComplete() },
      })
    } else { if (onComplete) onComplete() }
  }

  private showPreBattleEffects(effects: PreBattleEffect[], idx: number) {
    if (idx >= effects.length) {
      this.dismissCasterDot(() => { this.rebuildForCombat(); this.time.delayedCall(300, () => this.playStep()) })
      return
    }
    const fx = effects[idx]
    const casterKey = `${fx.side}-${fx.casterIndex}`
    if (casterKey !== this.currentCasterKey) {
      this.dismissCasterDot(() => { this.currentCasterKey = casterKey; this.showCasterDot(fx); this.time.delayedCall(500, () => this.showEffect(effects, idx)) })
    } else {
      this.showEffect(effects, idx)
    }
  }

  private rebuildForCombat() {
    const L = this.L; const b = L.battle
    for (const s of this.playerSprites) s.container.destroy()
    for (const s of this.opponentSprites) s.container.destroy()
    this.playerTeam = this.battleResult.postPrePlayerTeam
    this.opponentTeam = this.battleResult.postPreOpponentTeam
    this.playerQueueIndex = 0; this.opponentQueueIndex = 0
    this.playerSprites = []
    for (let i = 0; i < this.playerTeam.length; i++) {
      this.playerSprites.push(this.createHeroSprite(b.centerX - L.s * 60 - i * b.spriteGap, b.queueY, this.playerTeam[i], 'player'))
    }
    this.opponentSprites = []
    for (let i = 0; i < this.opponentTeam.length; i++) {
      this.opponentSprites.push(this.createHeroSprite(b.centerX + L.s * 60 + i * b.spriteGap, b.queueY, this.opponentTeam[i], 'opponent'))
    }
  }

  private showCasterDot(fx: PreBattleEffect) {
    const L = this.L
    const casterSprites = fx.side === 'player' ? this.playerSprites : this.opponentSprites
    const casterSprite = casterSprites[fx.casterIndex]
    if (casterSprite) {
      this.casterDot = this.add.graphics()
      this.casterDot.setPosition(casterSprite.container.x, casterSprite.container.y - L.s * 32)
      this.casterDot.fillStyle(0xf1c40f, 1); this.casterDot.fillCircle(0, 0, 4 * L.s)
      this.casterDot.setScale(3); this.casterDot.setAlpha(0)
      this.casterDotTween = this.tweens.add({ targets: this.casterDot, scaleX: 1, scaleY: 1, alpha: 1, duration: 250, ease: 'Back.easeOut' })
    }
  }

  private showEffect(effects: PreBattleEffect[], idx: number) {
    const L = this.L; const b = L.battle
    const fx = effects[idx]
    const x = fx.side === 'player' ? L.w / 4 : (L.w * 3) / 4
    const color = fx.side === 'player' ? '#4ecdc4' : '#e94560'
    this.statusText.setText(fx.text)

    const fxText = this.add.text(x, b.queueY - L.s * 60, fx.text.split(']')[1]?.trim() || fx.text, {
      fontSize: L.fs(12), color, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5)
    this.tweens.add({ targets: fxText, y: fxText.y - L.s * 25, alpha: 0, duration: 1000, onComplete: () => fxText.destroy() })

    // Poseidon rearrange
    if (fx.rearrangeOrder && fx.rearrangeSide) {
      const sprites = fx.rearrangeSide === 'player' ? this.playerSprites : this.opponentSprites
      const team = fx.rearrangeSide === 'player' ? this.playerTeam : this.opponentTeam
      const oldSprites = [...sprites]; const oldTeam = [...team]
      const reordered: { sprite: HeroSprite; hero: OwnedHero }[] = []
      const used = new Set<number>()
      for (const key of fx.rearrangeOrder) {
        const heroId = key.split('-')[0]
        for (let i = 0; i < oldSprites.length; i++) {
          if (!used.has(i) && oldTeam[i].hero.id === heroId) { reordered.push({ sprite: oldSprites[i], hero: oldTeam[i] }); used.add(i); break }
        }
      }
      for (let i = 0; i < reordered.length; i++) {
        if (fx.rearrangeSide === 'player') { this.playerSprites[i] = reordered[i].sprite; this.playerTeam[i] = reordered[i].hero }
        else { this.opponentSprites[i] = reordered[i].sprite; this.opponentTeam[i] = reordered[i].hero }
        const targetX = fx.rearrangeSide === 'player' ? b.centerX - L.s * 60 - i * b.spriteGap : b.centerX + L.s * 60 + i * b.spriteGap
        this.tweens.add({ targets: reordered[i].sprite.container, x: targetX, duration: 500, ease: 'Power2' })
      }
    }

    // Target circles + Zeus damage
    const targets = fx.targetIndices ?? []
    const targetSprites = fx.targetSide === 'player' ? this.playerSprites : this.opponentSprites
    const targetTeam = fx.targetSide === 'player' ? this.playerTeam : this.opponentTeam
    const isZeus = fx.text.includes('Thunder Strike')
    for (let t = 0; t < targets.length; t++) {
      const targetIdx = targets[t]; const sprite = targetSprites[targetIdx]
      if (!sprite) continue
      this.time.delayedCall(t * 750, () => {
        const cx = sprite.container.x; const cy = sprite.container.y
        const circle = this.add.graphics(); circle.setPosition(cx, cy)
        circle.lineStyle(2, 0xffffff, 0.8); circle.strokeCircle(0, 0, 8 * L.s)
        this.tweens.add({ targets: circle, scaleX: 2.5, scaleY: 2.5, alpha: 0, duration: 400, onComplete: () => circle.destroy() })
        if (isZeus && targetIdx < targetTeam.length) {
          targetTeam[targetIdx].currentHp -= 15
          if (targetTeam[targetIdx].currentHp < 0) targetTeam[targetIdx].currentHp = 0
          this.showDamageNumber(cx, cy - L.s * 30, 15)
          sprite.hpText.setText(`${targetTeam[targetIdx].currentHp}`)
          const pct = targetTeam[targetIdx].currentHp / sprite.maxHp
          const barColor = pct > 0.5 ? 0x4ecdc4 : pct > 0.25 ? 0xf39c12 : 0xe94560
          sprite.hpBarFill.clear(); sprite.hpBarFill.fillStyle(barColor)
          sprite.hpBarFill.fillRoundedRect(-b.barW / 2, b.barY, b.barW * pct, b.barH, 2)
          if (targetTeam[targetIdx].currentHp <= 0) {
            this.tweens.add({ targets: sprite.container, alpha: 0, y: sprite.container.y + L.s * 20, duration: 300 })
          }
        }
      })
    }

    const nextFx = idx + 1 < effects.length ? effects[idx + 1] : null
    const sameCasterNext = nextFx ? `${nextFx.side}-${nextFx.casterIndex}` === this.currentCasterKey : false
    this.time.delayedCall(sameCasterNext ? 750 : 1500, () => this.showPreBattleEffects(effects, idx + 1))
  }

  // ── Combat phase ──

  private playStep() {
    if (this.stepIndex >= this.steps.length) { this.finishBattle(); return }
    const L = this.L; const b = L.battle
    const step = this.steps[this.stepIndex]; this.stepIndex++

    if (this.playerQueueIndex < this.playerTeam.length) this.playerTeam[this.playerQueueIndex].currentHp = step.playerHp
    if (this.opponentQueueIndex < this.opponentTeam.length) this.opponentTeam[this.opponentQueueIndex].currentHp = step.opponentHp

    if (step.statBoosts) {
      for (const boost of step.statBoosts) {
        const sprites = boost.side === 'player' ? this.playerSprites : this.opponentSprites
        const team = boost.side === 'player' ? this.playerTeam : this.opponentTeam
        const qIdx = (boost.side === 'player' ? this.playerQueueIndex : this.opponentQueueIndex) + boost.queueOffset
        if (qIdx < team.length) { team[qIdx].hero.hp += boost.hpDelta; team[qIdx].hero.attack += boost.attackDelta; team[qIdx].currentHp += boost.hpDelta }
        const sprite = sprites[boost.queueOffset]
        if (sprite) {
          const cx = sprite.container.x; const cy = sprite.container.y
          if (boost.hpDelta > 0) this.showStatChange(cx - L.s * 14, cy - L.s * 48, `+${boost.hpDelta}`, '#ffffff')
          if (boost.attackDelta > 0) this.showStatChange(cx + L.s * 14, cy - L.s * 48, `+${boost.attackDelta}`, '#e94560')
          sprite.maxHp += boost.hpDelta
        }
      }
    }

    if (step.playerDamage > 0) this.showDamageNumber(b.centerX + L.s * 60, b.queueY - L.s * 55, step.playerDamage)
    if (step.opponentDamage > 0) this.showDamageNumber(b.centerX - L.s * 60, b.queueY - L.s * 55, step.opponentDamage)

    const pSprite = this.playerSprites[0]; const oSprite = this.opponentSprites[0]
    if (pSprite) this.tweens.add({ targets: pSprite.container, x: pSprite.container.x + b.lungeDistance, duration: LUNGE_DURATION, yoyo: true })
    if (oSprite) this.tweens.add({ targets: oSprite.container, x: oSprite.container.x - b.lungeDistance, duration: LUNGE_DURATION, yoyo: true })

    this.updateHpDisplays()
    this.statusText.setText(step.abilityText || `${step.playerHeroId} deals ${step.playerDamage} — ${step.opponentHeroId} deals ${step.opponentDamage}`)

    this.time.delayedCall(STEP_DELAY * 0.6, () => {
      if (step.playerDied) { this.killFrontSprite('player'); this.playerQueueIndex++ }
      if (step.opponentDied) { this.killFrontSprite('opponent'); this.opponentQueueIndex++ }
      this.updateHpDisplays()
    })
    this.time.delayedCall(STEP_DELAY, () => this.playStep())
  }

  private showStatChange(x: number, y: number, text: string, color: string) {
    const t = this.add.text(x, y, text, { fontSize: this.L.fs(12), color, fontFamily: 'monospace', fontStyle: 'bold', stroke: '#000000', strokeThickness: Math.round(2 * this.L.s) }).setOrigin(0.5)
    this.tweens.add({ targets: t, y: y - this.L.s * 22, alpha: 0, duration: 700, onComplete: () => t.destroy() })
  }

  private showDamageNumber(x: number, y: number, damage: number) {
    const t = this.add.text(x, y, `-${damage}`, { fontSize: this.L.fs(18), color: '#ff4444', fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(0.5)
    this.tweens.add({ targets: t, y: y - this.L.s * 30, alpha: 0, duration: 500, onComplete: () => t.destroy() })
  }

  private killFrontSprite(side: 'player' | 'opponent') {
    const L = this.L; const b = L.battle
    const sprites = side === 'player' ? this.playerSprites : this.opponentSprites
    if (sprites.length === 0) return
    const dead = sprites.shift()!
    this.tweens.add({ targets: dead.container, alpha: 0, y: dead.container.y + L.s * 20, duration: 300, onComplete: () => dead.container.destroy() })
    for (let i = 0; i < sprites.length; i++) {
      const targetX = side === 'player' ? b.centerX - L.s * 60 - i * b.spriteGap : b.centerX + L.s * 60 + i * b.spriteGap
      this.tweens.add({ targets: sprites[i].container, x: targetX, duration: 250, ease: 'Power2' })
    }
  }

  private finishBattle() {
    const L = this.L; const b = L.battle
    const result = this.battleResult
    gameStore.getState().finishBattle(result)
    const statusLabel = result.outcome === 'won' ? 'VICTORY!' : result.outcome === 'draw' ? 'DRAW!' : 'DEFEAT!'
    const statusColor = result.outcome === 'won' ? '#4ecdc4' : result.outcome === 'draw' ? '#f1c40f' : '#e94560'
    this.statusText.setText(statusLabel); this.statusText.setColor(statusColor); this.statusText.setFontSize(Math.round(24 * L.s))

    const bigLabel = result.outcome === 'won' ? 'WIN' : result.outcome === 'draw' ? 'DRAW' : 'LOSE'
    const bigText = this.add.text(L.cx, b.resultY, bigLabel, { fontSize: L.fs(64), color: statusColor, fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(0.5).setAlpha(0)
    this.tweens.add({ targets: bigText, alpha: 0.3, duration: 400 })

    this.time.delayedCall(1600, () => {
      this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 400,
        onComplete: () => { const s = gameStore.getState(); if (s.phase === 'gameover') this.scene.start('GameOver'); else { s.returnToShop(); this.scene.start('Shop') } },
      })
    })
  }
}
