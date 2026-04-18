import * as Phaser from 'phaser'
import { gameStore } from '../store'
import { REROLL_COST, HERO_COST } from '../data'
import { MAX_BENCH, SELL_GOLD } from '../types'
import type { Hero } from '../types'
import { computeLayout, type Layout } from '../layout'

function starsString(n: number): string { return '\u2605'.repeat(n) }

export class ShopScene extends Phaser.Scene {
  private goldText!: Phaser.GameObjects.Text
  private teamContainer!: Phaser.GameObjects.Container
  private benchContainer!: Phaser.GameObjects.Container
  private shopContainer!: Phaser.GameObjects.Container
  private heartsContainer!: Phaser.GameObjects.Container
  private infoText!: Phaser.GameObjects.Text
  private freezeBtn!: Phaser.GameObjects.Image
  private freezeText!: Phaser.GameObjects.Text
  private breathingTweens: Phaser.Tweens.Tween[] = []
  private teamHighlightGraphics: Phaser.GameObjects.Graphics[] = []
  private teamHighlightTweens: Phaser.Tweens.Tween[] = []
  private teamSpriteContainers: Phaser.GameObjects.Container[] = []
  private benchSpriteContainers: (Phaser.GameObjects.Container | null)[] = []
  private teamSlotXPositions: number[] = []
  private benchSlotPositions: { x: number; y: number }[] = []
  private teamDragIndex = -1
  private benchDragIndex = -1
  private lastDragX = 0
  private lastGold = 0
  private shopDragGhost: Phaser.GameObjects.Container | null = null
  private shopDragIndex = -1
  private shopDragHero: Hero | null = null
  private sellZoneX = 0
  private sellZoneY = 0
  private L!: Layout

  constructor() { super('Shop') }

  private resizeTimer: ReturnType<typeof setTimeout> | null = null

  create() {
    this.events.once('shutdown', this.cleanup, this)

    // Live resize: debounced scene restart
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      if (this.resizeTimer) clearTimeout(this.resizeTimer)
      this.resizeTimer = setTimeout(() => {
        if (this.scene.isActive('Shop')) this.scene.restart()
      }, 200)
    })

    const { width, height } = this.scale
    this.L = computeLayout(width, height)
    const L = this.L; const S = L.shop
    const state = gameStore.getState()
    this.lastGold = state.gold

    this.cameras.main.setAlpha(0)
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 300 })

    this.add.text(L.cx, S.roundY, `ROUND ${state.round}`, { fontSize: L.fs(22), color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(0.5)

    if (state.lastBattleResult) {
      const r = state.lastBattleResult
      this.add.text(L.cx, S.resultY,
        r.outcome === 'won' ? 'VICTORY!' : r.outcome === 'draw' ? 'DRAW!' : 'DEFEAT! Lost a heart.',
        { fontSize: L.fs(13), color: r.outcome === 'won' ? '#4ecdc4' : r.outcome === 'draw' ? '#f1c40f' : '#e94560', fontFamily: 'monospace' }
      ).setOrigin(0.5)
    }

    this.heartsContainer = this.add.container(S.heartsX, S.heartsY)
    this.renderHearts()

    if (state.lastBattleResult && state.lastBattleResult.outcome === 'lost') {
      const lostIdx = state.hearts
      if (lostIdx >= 0 && lostIdx < 5) {
        const h = this.heartsContainer.getAt(lostIdx) as Phaser.GameObjects.Image
        if (h) { h.setTexture('heart'); this.tweens.add({ targets: h, scaleX: 1.3, scaleY: 1.3, duration: 200, yoyo: true, onComplete: () => { h.setTexture('heart-empty'); this.tweens.add({ targets: h, alpha: 0.3, duration: 150, yoyo: true }) } }) }
      }
    }

    this.add.image(S.goldX, S.goldY, 'coin').setScale(L.s)
    this.goldText = this.add.text(S.goldX + L.s * 18, S.goldY, `${state.gold} gold`, { fontSize: L.fs(16), color: '#f1c40f', fontFamily: 'monospace' }).setOrigin(0, 0.5)

    this.add.text(L.cx, S.shopLabelY, 'SHOP — drag heroes to your team', { fontSize: L.fs(14), color: '#aaaaaa', fontFamily: 'monospace' }).setOrigin(0.5)

    this.shopContainer = this.add.container(0, 0)
    this.renderShopChoices()

    // Buttons
    const rerollBtn = this.add.image(L.cx - S.buttonSpacing, S.buttonY, 'button-sm').setInteractive({ useHandCursor: true })
    this.add.text(L.cx - S.buttonSpacing, S.buttonY, `REROLL (${REROLL_COST}g)`, { fontSize: L.fs(13), color: '#ffffff', fontFamily: 'monospace' }).setOrigin(0.5)
    rerollBtn.on('pointerover', () => rerollBtn.setTint(0x3a7bd5))
    rerollBtn.on('pointerout', () => rerollBtn.clearTint())
    rerollBtn.on('pointerdown', () => { gameStore.getState().rerollShop(); this.updateFreezeDisplay(); this.refreshAll() })

    this.freezeBtn = this.add.image(L.cx, S.buttonY, 'button-sm').setInteractive({ useHandCursor: true })
    this.freezeText = this.add.text(L.cx, S.buttonY, state.shopFrozen ? 'UNFREEZE' : 'FREEZE', { fontSize: L.fs(13), color: state.shopFrozen ? '#3498db' : '#ffffff', fontFamily: 'monospace' }).setOrigin(0.5)
    if (state.shopFrozen) this.freezeBtn.setTint(0x3498db)
    this.freezeBtn.on('pointerover', () => { if (!gameStore.getState().shopFrozen) this.freezeBtn.setTint(0x3498db) })
    this.freezeBtn.on('pointerout', () => { if (!gameStore.getState().shopFrozen) this.freezeBtn.clearTint() })
    this.freezeBtn.on('pointerdown', () => { gameStore.getState().toggleFreezeShop(); this.updateFreezeDisplay() })

    const fightBtn = this.add.image(L.cx + S.buttonSpacing, S.buttonY, 'button-sm').setInteractive({ useHandCursor: true })
    this.add.text(L.cx + S.buttonSpacing, S.buttonY, 'FIGHT!', { fontSize: L.fs(14), color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(0.5)
    fightBtn.on('pointerover', () => fightBtn.setTint(0x4ecdc4))
    fightBtn.on('pointerout', () => fightBtn.clearTint())
    fightBtn.on('pointerdown', () => {
      if (gameStore.getState().team.length === 0) { this.infoText.setText('Buy at least one hero first!'); return }
      gameStore.getState().startBattle()
      this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 300, onComplete: () => this.scene.start('Battle') })
    })

    this.infoText = this.add.text(L.cx, S.infoY, '', { fontSize: L.fs(12), color: '#e94560', fontFamily: 'monospace' }).setOrigin(0.5)

    // Sell zone
    this.sellZoneX = S.sellX; this.sellZoneY = S.sellY
    const sellZone = this.add.container(this.sellZoneX, this.sellZoneY)
    const sellBg = this.add.graphics(); sellBg.lineStyle(2, 0x666666); sellBg.strokeRoundedRect(-L.s * 35, -L.s * 30, L.s * 70, L.s * 60, 8)
    sellZone.add(sellBg)
    sellZone.add(this.add.text(0, -L.s * 12, 'SELL', { fontSize: L.fs(10), color: '#888888', fontFamily: 'monospace' }).setOrigin(0.5))
    sellZone.add(this.add.image(0, L.s * 8, 'coin').setScale(0.8 * L.s))
    sellZone.add(this.add.text(0, L.s * 24, `+${SELL_GOLD}g`, { fontSize: L.fs(9), color: '#f1c40f', fontFamily: 'monospace' }).setOrigin(0.5))

    // Bench label
    this.add.text(S.benchX - L.s * 10, S.benchStartY - L.s * 25, 'BENCH', { fontSize: L.fs(10), color: '#555555', fontFamily: 'monospace' })

    this.teamContainer = this.add.container(0, 0)
    this.benchContainer = this.add.container(0, 0)
    this.renderTeam()
    this.renderBench()
    this.setupDragHandlers()
  }

  // ── Shop Cards ──
  private renderShopChoices() {
    this.shopContainer.removeAll(true)
    for (const tw of this.breathingTweens) tw.destroy()
    this.breathingTweens = []

    const state = gameStore.getState()
    const L = this.L; const S = L.shop
    const startX = L.cx - (state.shopChoices.length - 1) * (S.cardSpacing / 2)

    for (let i = 0; i < state.shopChoices.length; i++) {
      const hero = state.shopChoices[i]
      const x = startX + i * S.cardSpacing
      const y = S.cardY
      const hcx = -S.cardW / 2; const hcy = -S.cardH / 2

      const isMergeable = !!state.team.find((h) => h.hero.id === hero.id && h.stars === 1)
      const hasRelated = !!state.team.find((h) => h.hero.id === hero.id && h.stars < 3)
      const cantAfford = state.gold < HERO_COST
      const borderColor = cantAfford ? 0x222233 : (isMergeable || hasRelated) ? 0x556699 : 0x333366
      const fillColor = cantAfford ? 0x111122 : 0x1a1a3e

      const cc = this.add.container(x, y)
      if (cantAfford) cc.setAlpha(0.45)

      const outline = this.add.graphics(); cc.add(outline)
      const card = this.add.graphics(); card.fillStyle(fillColor, 1); card.fillRoundedRect(hcx, hcy, S.cardW, S.cardH, 8); cc.add(card)
      outline.clear(); outline.lineStyle(2, borderColor); outline.strokeRoundedRect(hcx, hcy, S.cardW, S.cardH, 8)

      const spriteMaxW = S.cardW * 0.3; const spriteMaxH = S.cardH * 0.7
      const img = this.add.image(-S.cardW * 0.3, 0, hero.id)
      img.setScale(Math.min(spriteMaxW / img.width, spriteMaxH / img.height, 1)); cc.add(img)

      const owned1 = state.team.find((h) => h.hero.id === hero.id && h.stars === 1)
      const owned2 = state.team.find((h) => h.hero.id === hero.id && h.stars === 2)
      let nameStr = `${starsString(1)} ${hero.name}`
      if (owned1) nameStr += ` \u2192 ${starsString(2)}`
      else if (owned2) nameStr += ` (${starsString(2)})`

      const tx = -S.cardW * 0.1
      cc.add(this.add.text(tx, -S.cardH * 0.17, nameStr, { fontSize: L.fs(14), color: cantAfford ? '#555555' : '#ffffff', fontFamily: 'monospace', fontStyle: 'bold' }))
      cc.add(this.add.text(tx, S.cardH * 0.02, `${hero.hp}`, { fontSize: L.fs(14), color: cantAfford ? '#444444' : '#ffffff', fontFamily: 'monospace', fontStyle: 'bold' }))
      cc.add(this.add.text(tx + L.s * 35, S.cardH * 0.02, `${hero.attack}`, { fontSize: L.fs(14), color: cantAfford ? '#444444' : '#e94560', fontFamily: 'monospace', fontStyle: 'bold' }))
      cc.add(this.add.text(tx, S.cardH * 0.17, `${HERO_COST} gold`, { fontSize: L.fs(11), color: cantAfford ? '#333333' : '#f1c40f', fontFamily: 'monospace' }))
      cc.add(this.add.text(0, S.cardH / 2 - L.s * 14, `[${hero.ability}]`, { fontSize: L.fs(10), color: cantAfford ? '#333333' : '#7788aa', fontFamily: 'monospace', fontStyle: 'italic' }).setOrigin(0.5))

      if (!cantAfford) {
        const heroId = hero.id
        const borderColorHover = (isMergeable || hasRelated) ? 0x6ecdc4 : 0x4ecdc4
        const dz = this.add.zone(0, 0, S.cardW, S.cardH).setInteractive({ useHandCursor: true, draggable: true })
        dz.setData('shopIndex', i); dz.setData('heroId', heroId)
        dz.on('pointerover', () => { card.clear().fillStyle(0x2a2a5e, 1).fillRoundedRect(hcx, hcy, S.cardW, S.cardH, 8); outline.clear(); outline.lineStyle(2, borderColorHover); outline.strokeRoundedRect(hcx, hcy, S.cardW, S.cardH, 8); this.highlightTeamHeroes(heroId, true) })
        dz.on('pointerout', () => { if (this.shopDragIndex === -1) { card.clear().fillStyle(fillColor, 1).fillRoundedRect(hcx, hcy, S.cardW, S.cardH, 8); outline.clear(); outline.lineStyle(2, borderColor); outline.strokeRoundedRect(hcx, hcy, S.cardW, S.cardH, 8); this.highlightTeamHeroes(heroId, false) } })
        cc.add(dz)
      }
      this.shopContainer.add(cc)

      if ((isMergeable || hasRelated) && !cantAfford) {
        this.breathingTweens.push(this.tweens.addCounter({ from: 0, to: 1, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', onUpdate: (tw) => { const a = 0.6 + tw.getValue() * 0.4; outline.clear(); outline.lineStyle(2, borderColor, a); outline.strokeRoundedRect(hcx, hcy, S.cardW, S.cardH, 8) } }))
        if (isMergeable) this.breathingTweens.push(this.tweens.add({ targets: cc, scaleX: 1.03, scaleY: 1.03, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }))
      }
    }
  }

  // ── Team Highlights ──
  private highlightTeamHeroes(heroId: string, show: boolean) {
    for (const gfx of this.teamHighlightGraphics) gfx.destroy(); this.teamHighlightGraphics = []
    for (const tw of this.teamHighlightTweens) tw.destroy(); this.teamHighlightTweens = []
    if (!show) { for (const c of this.teamSpriteContainers) { this.tweens.killTweensOf(c); c.setScale(1) } return }
    const state = gameStore.getState()
    for (let i = 0; i < state.team.length; i++) {
      const h = state.team[i]; if (h.hero.id !== heroId) continue
      const container = this.teamSpriteContainers[i]; if (!container) continue
      const bounds = container.getBounds(); const gfx = this.add.graphics()
      if (h.stars === 1) { gfx.fillStyle(0x4ecdc4, 0.4); gfx.fillRoundedRect(bounds.centerX - 35, bounds.bottom - 4, 70, 6, 3); this.teamHighlightTweens.push(this.tweens.add({ targets: container, scaleX: 1.08, scaleY: 1.08, duration: 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })) }
      else if (h.stars === 2) { gfx.fillStyle(0x4ecdc4, 0.25); gfx.fillRoundedRect(bounds.centerX - 35, bounds.bottom - 4, 70, 6, 3) }
      else { gfx.fillStyle(0x888888, 0.25); gfx.fillRoundedRect(bounds.centerX - 35, bounds.bottom - 4, 70, 6, 3) }
      this.teamHighlightGraphics.push(gfx)
    }
  }

  private updateFreezeDisplay() {
    const frozen = gameStore.getState().shopFrozen
    this.freezeText.setText(frozen ? 'UNFREEZE' : 'FREEZE'); this.freezeText.setColor(frozen ? '#3498db' : '#ffffff')
    if (frozen) this.freezeBtn.setTint(0x3498db); else this.freezeBtn.clearTint()
  }

  // ── Team Display ──
  private renderTeam() {
    this.teamContainer.removeAll(true); this.teamSpriteContainers = []; this.teamSlotXPositions = []
    const state = gameStore.getState(); const L = this.L; const S = L.shop
    const startX = L.cx + (state.team.length - 1) * (S.teamSpacing / 2) - L.s * 60

    for (let i = 0; i < state.team.length; i++) {
      const h = state.team[i]; const x = startX - i * S.teamSpacing
      this.teamSlotXPositions.push(x)
      const hc = this.add.container(x, S.teamY); hc.setSize(L.s * 80, L.s * 90)
      hc.setInteractive({ useHandCursor: true, draggable: true }); hc.setData('teamIndex', i); hc.setData('source', 'team')
      const img = this.add.image(0, 0, h.hero.id); img.setScale(Math.min(S.teamSpriteSize / img.width, S.teamSpriteSize / img.height, 1)); hc.add(img)
      hc.add(this.add.text(0, L.s * 38, `${starsString(h.stars)} ${h.hero.name}`, { fontSize: L.fs(12), color: '#888888', fontFamily: 'monospace' }).setOrigin(0.5))
      hc.add(this.add.text(-L.s * 12, -L.s * 38, `${h.hero.hp}`, { fontSize: L.fs(14), color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(1, 0.5))
      hc.add(this.add.text(L.s * 12, -L.s * 38, `${h.hero.attack}`, { fontSize: L.fs(14), color: '#e94560', fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(0, 0.5))
      this.teamContainer.add(hc); this.teamSpriteContainers.push(hc)
    }
    if (state.team.length === 0) {
      this.teamContainer.add(this.add.text(L.cx - L.s * 60, S.teamY, 'No heroes yet — drag from the shop!', { fontSize: L.fs(14), color: '#555555', fontFamily: 'monospace' }).setOrigin(0.5))
    }
  }

  // ── Bench Display ──
  private renderBench() {
    this.benchContainer.removeAll(true); this.benchSpriteContainers = []; this.benchSlotPositions = []
    const state = gameStore.getState(); const L = this.L; const S = L.shop

    for (let slot = 0; slot < MAX_BENCH; slot++) {
      const x = S.benchX; const y = S.benchStartY + slot * S.benchGap
      this.benchSlotPositions.push({ x, y })
      if (slot < state.bench.length) {
        const h = state.bench[slot]; const hc = this.add.container(x, y); hc.setSize(L.s * 50, L.s * 55)
        hc.setInteractive({ useHandCursor: true, draggable: true }); hc.setData('benchIndex', slot); hc.setData('source', 'bench')
        const img = this.add.image(0, 0, h.hero.id); img.setScale(Math.min(S.benchSpriteSize / img.width, S.benchSpriteSize / img.height, 1)); img.setAlpha(0.7); hc.add(img)
        hc.add(this.add.text(0, L.s * 24, `${starsString(h.stars)}`, { fontSize: L.fs(9), color: '#666666', fontFamily: 'monospace' }).setOrigin(0.5))
        this.benchContainer.add(hc); this.benchSpriteContainers.push(hc)
      } else {
        const gfx = this.add.graphics(); gfx.lineStyle(1, 0x444444); gfx.strokeRoundedRect(x - L.s * 22, y - L.s * 22, L.s * 44, L.s * 44, 6)
        this.benchContainer.add(gfx); this.benchSpriteContainers.push(null)
      }
    }
  }

  // ── Drag Handlers ──
  private setupDragHandlers() {
    const L = this.L; const S = L.shop

    this.input.on('dragstart', (_p: Phaser.Input.Pointer, go: Phaser.GameObjects.GameObject) => {
      const shopIdx = go.getData('shopIndex')
      if (shopIdx !== undefined && shopIdx !== null) {
        this.shopDragIndex = shopIdx as number; this.shopDragHero = gameStore.getState().shopChoices[this.shopDragIndex] ?? null
        if (this.shopDragHero) {
          this.shopDragGhost = this.createDragGhost(this.shopDragHero); this.shopDragGhost.setPosition(_p.x, _p.y).setDepth(20)
          const parent = (go as Phaser.GameObjects.Zone).parentContainer; if (parent) parent.setAlpha(0.3)
        }
        return
      }
      const source = go.getData('source')
      if (source === 'team') { this.teamDragIndex = go.getData('teamIndex') as number; this.lastDragX = (go as Phaser.GameObjects.Container).x; (go as Phaser.GameObjects.Container).setDepth(10).setAlpha(0.8) }
      else if (source === 'bench') { this.benchDragIndex = go.getData('benchIndex') as number; (go as Phaser.GameObjects.Container).setDepth(10).setAlpha(0.8) }
    })

    this.input.on('drag', (_p: Phaser.Input.Pointer, go: Phaser.GameObjects.GameObject, dragX: number) => {
      if (this.shopDragGhost) { const dx = _p.x - this.shopDragGhost.x; this.shopDragGhost.angle = Phaser.Math.Linear(this.shopDragGhost.angle, Phaser.Math.Clamp(dx * 0.8, -25, 25), 0.3); this.shopDragGhost.setPosition(_p.x, _p.y); return }
      if (this.teamDragIndex >= 0) { const c = go as Phaser.GameObjects.Container; const dx = dragX - this.lastDragX; c.angle = Phaser.Math.Linear(c.angle, Phaser.Math.Clamp(dx * 0.8, -25, 25), 0.3); c.x = dragX; this.lastDragX = dragX }
      if (this.benchDragIndex >= 0) { (go as Phaser.GameObjects.Container).setPosition(_p.x, _p.y) }
    })

    this.input.on('dragend', (_p: Phaser.Input.Pointer, go: Phaser.GameObjects.GameObject) => {
      // Shop drag
      if (this.shopDragGhost && this.shopDragHero) {
        const dx = _p.x; const dy = _p.y
        if (!(Math.abs(dx - this.sellZoneX) < L.s * 40 && Math.abs(dy - this.sellZoneY) < L.s * 35)) {
          let targetIdx = -1
          if (Math.abs(dy - S.teamY) < L.s * 60) { for (let i = 0; i < this.teamSlotXPositions.length; i++) { if (Math.abs(dx - this.teamSlotXPositions[i]) < L.s * 55) { targetIdx = i; break } } }
          let benchDrop = false
          for (const bp of this.benchSlotPositions) { if (Math.abs(dx - bp.x) < L.s * 35 && Math.abs(dy - bp.y) < L.s * 35) { benchDrop = true; break } }
          if (benchDrop && gameStore.getState().bench.length < MAX_BENCH) gameStore.getState().buyHeroToBench(this.shopDragIndex)
          else if (targetIdx >= 0) gameStore.getState().buyHeroOnto(this.shopDragIndex, targetIdx)
          else if (Math.abs(dy - S.teamY) < L.s * 80) gameStore.getState().buyHeroOnto(this.shopDragIndex, -1)
        }
        const parent = (go as Phaser.GameObjects.Zone).parentContainer; if (parent) parent.setAlpha(1)
        this.shopDragGhost.destroy(); this.shopDragGhost = null; this.shopDragIndex = -1; this.shopDragHero = null
        this.highlightTeamHeroes('', false); this.refreshAll(); return
      }

      // Team drag
      if (this.teamDragIndex >= 0) {
        const c = go as Phaser.GameObjects.Container; c.setDepth(0).setAlpha(1)
        this.tweens.add({ targets: c, angle: 0, duration: 200, ease: 'Back.easeOut' })
        const dx = _p.x; const dy = _p.y
        if (Math.abs(dx - this.sellZoneX) < L.s * 40 && Math.abs(dy - this.sellZoneY) < L.s * 35) { gameStore.getState().sellHero('team', this.teamDragIndex); this.teamDragIndex = -1; this.refreshAll(); return }
        for (let i = 0; i < this.benchSlotPositions.length; i++) {
          const bp = this.benchSlotPositions[i]
          if (Math.abs(dx - bp.x) < L.s * 35 && Math.abs(dy - bp.y) < L.s * 35) {
            const state = gameStore.getState(); if (i < state.bench.length) gameStore.getState().swapTeamAndBench(this.teamDragIndex, i); else gameStore.getState().moveTeamToBench(this.teamDragIndex, i)
            this.teamDragIndex = -1; this.refreshAll(); return
          }
        }
        if (this.teamSlotXPositions.length >= 2) {
          let ci = 0, cd = Infinity; for (let i = 0; i < this.teamSlotXPositions.length; i++) { const d = Math.abs(c.x - this.teamSlotXPositions[i]); if (d < cd) { cd = d; ci = i } }
          if (ci !== this.teamDragIndex) gameStore.getState().reorderTeam(this.teamDragIndex, ci)
        }
        this.teamDragIndex = -1; this.refreshAll(); return
      }

      // Bench drag
      if (this.benchDragIndex >= 0) {
        const c = go as Phaser.GameObjects.Container; c.setDepth(0).setAlpha(1)
        const dx = _p.x; const dy = _p.y
        if (Math.abs(dx - this.sellZoneX) < L.s * 40 && Math.abs(dy - this.sellZoneY) < L.s * 35) { gameStore.getState().sellHero('bench', this.benchDragIndex) }
        else {
          let swapped = false
          if (Math.abs(dy - S.teamY) < L.s * 60) { for (let i = 0; i < this.teamSlotXPositions.length; i++) { if (Math.abs(dx - this.teamSlotXPositions[i]) < L.s * 55) { gameStore.getState().swapTeamAndBench(i, this.benchDragIndex); swapped = true; break } } }
          if (!swapped && Math.abs(dy - S.teamY) < L.s * 80) gameStore.getState().moveBenchToTeam(this.benchDragIndex)
        }
        this.benchDragIndex = -1; this.refreshAll()
      }
    })
  }

  private createDragGhost(hero: Hero): Phaser.GameObjects.Container {
    const L = this.L; const ghost = this.add.container(0, 0)
    const img = this.add.image(0, 0, hero.id); img.setScale(Math.min(L.s * 48 / img.width, L.s * 48 / img.height, 1)).setAlpha(0.85); ghost.add(img)
    ghost.add(this.add.text(0, L.s * 32, hero.name, { fontSize: L.fs(10), color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(0.5))
    return ghost
  }

  // ── Hearts ──
  private renderHearts() {
    this.heartsContainer.removeAll(true); const state = gameStore.getState(); const L = this.L
    for (let i = 0; i < 5; i++) this.heartsContainer.add(this.add.image(i * L.s * 30, 0, i < state.hearts ? 'heart' : 'heart-empty').setScale(0.8 * L.s))
  }

  // ── Gold Indicator ──
  private showGoldChange(amount: number) {
    const L = this.L; const sign = amount > 0 ? '+' : ''; const color = amount > 0 ? '#4ecdc4' : '#e94560'
    const f = this.add.text(L.w - L.s * 40, L.s * 55, `${sign}${amount}`, { fontSize: L.fs(14), color, fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(0.5)
    this.tweens.add({ targets: f, y: f.y - L.s * 20, alpha: 0, duration: 600, onComplete: () => f.destroy() })
  }

  // ── Merge Animations ──
  private playMergeAnimation(targetIndex: number, stars: number) {
    const container = this.teamSpriteContainers[targetIndex]; if (!container) return
    const bounds = container.getBounds()
    if (stars === 1) { this.tweens.add({ targets: container, scaleX: 1.15, scaleY: 1.15, duration: 150, yoyo: true, ease: 'Sine.easeOut' }) }
    else if (stars === 2) {
      this.tweens.add({ targets: container, scaleX: 1.3, scaleY: 1.3, duration: 180, yoyo: true, ease: 'Back.easeOut' })
      const flash = this.add.graphics(); flash.fillStyle(0x4ecdc4, 0.35); flash.fillCircle(bounds.centerX, bounds.centerY, 22)
      this.tweens.add({ targets: flash, alpha: 0, duration: 350, onComplete: () => flash.destroy() })
      const st = this.add.text(bounds.centerX, bounds.centerY - 25, '\u2605\u2605', { fontSize: '13px', color: '#4ecdc4', fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(0.5)
      this.tweens.add({ targets: st, y: st.y - 18, alpha: 0, duration: 500, onComplete: () => st.destroy() })
    } else {
      this.tweens.add({ targets: container, scaleX: 1.5, scaleY: 1.5, duration: 300, ease: 'Back.easeOut', hold: 600, yoyo: true })
      const flash = this.add.graphics(); flash.fillStyle(0xf1c40f, 0.6); flash.fillCircle(bounds.centerX, bounds.centerY, 45)
      this.tweens.add({ targets: flash, alpha: 0, duration: 800, onComplete: () => flash.destroy() })
      const ring = this.add.graphics(); ring.lineStyle(3, 0xf1c40f, 0.7); ring.strokeCircle(bounds.centerX, bounds.centerY, 20)
      this.tweens.add({ targets: ring, scaleX: 2.5, scaleY: 2.5, alpha: 0, duration: 700, onComplete: () => ring.destroy() })
      this.time.delayedCall(150, () => { const r = this.add.graphics(); r.lineStyle(2, 0xf1c40f, 0.5); r.strokeCircle(bounds.centerX, bounds.centerY, 15); this.tweens.add({ targets: r, scaleX: 3, scaleY: 3, alpha: 0, duration: 600, onComplete: () => r.destroy() }) })
      this.time.delayedCall(300, () => { const r = this.add.graphics(); r.lineStyle(2, 0xf1c40f, 0.4); r.strokeCircle(bounds.centerX, bounds.centerY, 10); this.tweens.add({ targets: r, scaleX: 3.5, scaleY: 3.5, alpha: 0, duration: 500, onComplete: () => r.destroy() }) })
      const st = this.add.text(bounds.centerX, bounds.centerY - 35, '\u2605\u2605\u2605', { fontSize: '20px', color: '#f1c40f', fontFamily: 'monospace', fontStyle: 'bold' }).setOrigin(0.5)
      this.tweens.add({ targets: st, y: st.y - 30, alpha: 0, duration: 900, delay: 400, onComplete: () => st.destroy() })
    }
  }

  // ── Refresh ──
  private refreshAll() {
    const state = gameStore.getState()
    const goldDiff = state.gold - this.lastGold; if (goldDiff !== 0) this.showGoldChange(goldDiff); this.lastGold = state.gold
    this.goldText.setText(`${state.gold} gold`)
    this.renderShopChoices(); this.renderTeam(); this.renderBench(); this.renderHearts()
    if (state.pendingMerge) { this.playMergeAnimation(state.pendingMerge.resultIndex, state.pendingMerge.resultStars); gameStore.getState().clearPendingMerge() }
    if (state.gold < HERO_COST && state.shopChoices.length > 0) this.infoText.setText(state.gold >= REROLL_COST ? 'Not enough gold to buy — reroll or fight!' : 'Out of gold — time to fight!')
    else this.infoText.setText('')
  }

  private cleanup() {
    if (this.resizeTimer) { clearTimeout(this.resizeTimer); this.resizeTimer = null }
    this.scale.off('resize')
    for (const tw of this.breathingTweens) tw.destroy(); this.breathingTweens = []
    for (const tw of this.teamHighlightTweens) tw.destroy(); this.teamHighlightTweens = []
    for (const gfx of this.teamHighlightGraphics) gfx.destroy(); this.teamHighlightGraphics = []
    if (this.shopDragGhost) { this.shopDragGhost.destroy(); this.shopDragGhost = null }
    this.input.off('dragstart'); this.input.off('drag'); this.input.off('dragend')
    this.tweens.killAll(); this.time.removeAllEvents()
  }
}
