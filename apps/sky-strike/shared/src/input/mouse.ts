import type { GameActions, InputSource } from './actions'

export class MouseInput implements InputSource {
  private dx = 0
  private dy = 0
  private leftClick = false
  private onMouseMove: (e: MouseEvent) => void
  private onMouseDown: (e: MouseEvent) => void

  constructor(private canvas?: HTMLElement) {
    this.onMouseMove = (e) => {
      this.dx += e.movementX
      this.dy += e.movementY
    }
    this.onMouseDown = (e) => {
      if (e.button === 0) this.leftClick = true
    }

    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('mousedown', this.onMouseDown)
  }

  update(): Partial<GameActions> {
    const sensitivity = 0.003
    const actions: Partial<GameActions> = {
      lookX: this.dx * sensitivity,
      lookY: this.dy * sensitivity,
      attack: this.leftClick,
    }
    this.dx = 0
    this.dy = 0
    this.leftClick = false
    return actions
  }

  destroy() {
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('mousedown', this.onMouseDown)
  }
}
