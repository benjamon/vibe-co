import type { GameActions, InputSource } from './actions'

const DEFAULT_BINDINGS: Record<string, keyof GameActions> = {
  KeyW: 'moveY',
  KeyS: 'moveY',
  KeyA: 'moveX',
  KeyD: 'moveX',
  ArrowUp: 'moveY',
  ArrowDown: 'moveY',
  ArrowLeft: 'moveX',
  ArrowRight: 'moveX',
  Space: 'jump',
  KeyE: 'interact',
  Escape: 'pause',
}

const NEGATIVE_KEYS = new Set(['KeyW', 'KeyA', 'ArrowUp', 'ArrowLeft'])

export class KeyboardInput implements InputSource {
  private held = new Set<string>()
  private pressed = new Set<string>()
  private onKeyDown: (e: KeyboardEvent) => void
  private onKeyUp: (e: KeyboardEvent) => void
  private onBlur: () => void

  constructor() {
    this.onKeyDown = (e) => {
      if (!this.held.has(e.code)) {
        this.pressed.add(e.code)
      }
      this.held.add(e.code)
    }
    this.onKeyUp = (e) => {
      this.held.delete(e.code)
    }
    this.onBlur = () => {
      this.held.clear()
    }

    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  update(): Partial<GameActions> {
    const actions: Partial<GameActions> = {}

    // Movement axes
    let mx = 0
    let my = 0
    if (this.held.has('KeyA') || this.held.has('ArrowLeft')) mx -= 1
    if (this.held.has('KeyD') || this.held.has('ArrowRight')) mx += 1
    if (this.held.has('KeyW') || this.held.has('ArrowUp')) my -= 1
    if (this.held.has('KeyS') || this.held.has('ArrowDown')) my += 1

    // Normalize diagonal
    if (mx !== 0 && my !== 0) {
      const len = Math.sqrt(mx * mx + my * my)
      mx /= len
      my /= len
    }

    actions.moveX = mx
    actions.moveY = my

    // Buttons
    actions.jump = this.pressed.has('Space')
    actions.interact = this.pressed.has('KeyE')
    actions.pause = this.pressed.has('Escape')

    this.pressed.clear()
    return actions
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
  }
}
