// Shared "parchment doodle-pad" design tokens: warm paper panels, soft ink
// borders, offset hard-shadows, punchy yellow/coral accents. Applied as
// inline style fragments (spread into each component's own style object) so
// call sites can still layer position/layout concerns on top.

export const COLOR = {
  // Aged paper, not stark white — the sticker/panel fill.
  cream: '#F6EAD2',
  // Warm ink brown, not flat black — outlines, shadows, and body text.
  charcoal: '#4A3826',
  yellow: '#FFC72C',
  coral: '#FF4D4D',
  green: '#3DDC84',
  white: '#FFFFFF',
} as const

export const FONT = "'Fredoka', system-ui, sans-serif"

// Solid dark border, the standard weight used everywhere (buttons, panels,
// pills, inputs) so the whole UI reads as one consistent sticker sheet.
export const border = (width = 2) => `${width}px solid ${COLOR.charcoal}`

// The tactile offset "sticker" shadow — no blur, hard-edged, dark charcoal.
export const hardShadow = (offset = 4) => `${offset}px ${offset}px 0px ${COLOR.charcoal}`

// Base look for an opaque cream panel (menus, cards, sidebars).
export const panelStyle = {
  background: COLOR.cream,
  border: border(2),
  borderRadius: 16,
  boxShadow: hardShadow(6),
  color: COLOR.charcoal,
  fontFamily: FONT,
} as const

// A pressable arcade button/sticker. `bg` picks the fill; text defaults to
// charcoal (readable on cream/yellow/green) unless overridden. Combine with
// the `.arcade-btn` global class (index.html) for the press-depress :active
// state, which can't be expressed as a static inline style.
export const buttonStyle = (bg: string, color: string = COLOR.charcoal) =>
  ({
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 16,
    color,
    background: bg,
    border: border(2),
    borderRadius: 14,
    boxShadow: hardShadow(3),
    padding: '12px 15px',
    letterSpacing: 0.2,
    cursor: 'pointer',
  }) as const

// A rounded badge/pill — passport-stamp / scoreboard-tag look — for HUD
// readouts that float over the globe (round status, guessed country, etc).
export const pillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  background: COLOR.cream,
  border: border(2),
  borderRadius: 999,
  boxShadow: hardShadow(3),
  color: COLOR.charcoal,
  fontFamily: FONT,
  fontWeight: 700,
} as const

export const inputStyle = {
  fontFamily: FONT,
  padding: '10px 12px',
  fontSize: 16,
  borderRadius: 12,
  border: border(2),
  background: COLOR.cream,
  color: COLOR.charcoal,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
} as const

export const disabledLook = { opacity: 0.45, cursor: 'not-allowed' } as const
