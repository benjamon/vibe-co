/**
 * Responsive layout calculator.
 * All positions are computed relative to the current screen dimensions.
 * Portrait mode is detected when height > width.
 */

export interface Layout {
  w: number
  h: number
  portrait: boolean
  cx: number  // center x
  cy: number  // center y

  // Scaling factor relative to 800x600 baseline
  s: number
  // Font size helper: returns scaled px string
  fs: (base: number) => string

  // Battle scene
  battle: {
    queueY: number
    centerX: number
    spriteGap: number
    spriteSize: number
    barW: number
    barH: number
    barY: number
    lungeDistance: number
    titleY: number
    heartsY: number
    labelY: number
    vsY: number
    statusY: number
    resultY: number
  }

  // Shop scene
  shop: {
    roundY: number
    resultY: number
    heartsX: number
    heartsY: number
    goldX: number
    goldY: number
    shopLabelY: number
    cardW: number
    cardH: number
    cardSpacing: number
    cardY: number
    buttonY: number
    buttonSpacing: number
    infoY: number
    teamY: number
    teamSpacing: number
    teamSpriteSize: number
    benchX: number
    benchStartY: number
    benchGap: number
    benchSpriteSize: number
    sellX: number
    sellY: number
  }
}

export function computeLayout(w: number, h: number): Layout {
  const portrait = h > w
  // Scale factor: use the smaller dimension relative to 800 (landscape) or 600 (portrait)
  const s = portrait ? Math.min(w / 600, h / 800) : Math.min(w / 800, h / 600)
  const cx = w / 2
  const cy = h / 2

  const fs = (base: number) => `${Math.round(base * s)}px`

  // Battle layout
  const bQueueY = portrait ? h * 0.45 : h * 0.47
  const bCenterX = cx
  const bSpriteGap = Math.round(66 * s)
  const bSpriteSize = Math.round(40 * s)

  // Shop layout
  const cardW = Math.round(portrait ? w * 0.38 : w * 0.3)
  const cardH = Math.round(portrait ? h * 0.12 : h * 0.25)
  const cardSpacing = Math.round(portrait ? w * 0.42 : w * 0.34)
  const cardY = portrait ? h * 0.28 : h * 0.33

  const teamY = portrait ? h * 0.78 : h * 0.83
  const teamSpacing = Math.round(portrait ? 80 * s : 120 * s)
  const teamSpriteSize = Math.round(56 * s)

  const benchX = Math.round(40 * s)
  const benchStartY = portrait ? h * 0.62 : teamY - Math.round(45 * s)
  const benchGap = Math.round(65 * s)
  const benchSpriteSize = Math.round(36 * s)

  const buttonY = portrait ? h * 0.68 : h * 0.68
  const buttonSpacing = Math.round(portrait ? 150 * s : 220 * s)

  return {
    w, h, portrait, cx, cy, s, fs,
    battle: {
      queueY: bQueueY,
      centerX: bCenterX,
      spriteGap: bSpriteGap,
      spriteSize: bSpriteSize,
      barW: Math.round(36 * s),
      barH: Math.max(2, Math.round(4 * s)),
      barY: Math.round(22 * s),
      lungeDistance: Math.round(15 * s),
      titleY: Math.round(20 * s),
      heartsY: Math.round(55 * s),
      labelY: bQueueY - Math.round(90 * s),
      vsY: bQueueY - Math.round(30 * s),
      statusY: h - Math.round(50 * s),
      resultY: bQueueY,
    },
    shop: {
      roundY: Math.round(18 * s),
      resultY: Math.round(42 * s),
      heartsX: Math.round(20 * s),
      heartsY: Math.round(60 * s),
      goldX: w - Math.round(100 * s),
      goldY: Math.round(70 * s),
      shopLabelY: Math.round(100 * s),
      cardW, cardH, cardSpacing, cardY,
      buttonY,
      buttonSpacing,
      infoY: buttonY - Math.round(25 * s),
      teamY,
      teamSpacing,
      teamSpriteSize,
      benchX,
      benchStartY,
      benchGap,
      benchSpriteSize,
      sellX: w - Math.round(45 * s),
      sellY: h - Math.round(45 * s),
    },
  }
}
