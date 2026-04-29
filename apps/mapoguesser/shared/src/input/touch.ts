import type { GameActions, InputSource } from './actions'

interface TouchZone {
  id: number
  startX: number
  startY: number
  currentX: number
  currentY: number
}

export class TouchInput implements InputSource {
  private moveTouch: TouchZone | null = null
  private lookTouch: TouchZone | null = null
  private onTouchStart: (e: TouchEvent) => void
  private onTouchMove: (e: TouchEvent) => void
  private onTouchEnd: (e: TouchEvent) => void

  constructor() {
    const halfWidth = () => window.innerWidth / 2

    this.onTouchStart = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i]
        const zone: TouchZone = {
          id: t.identifier,
          startX: t.clientX,
          startY: t.clientY,
          currentX: t.clientX,
          currentY: t.clientY,
        }
        if (t.clientX < halfWidth() && !this.moveTouch) {
          this.moveTouch = zone
        } else if (t.clientX >= halfWidth() && !this.lookTouch) {
          this.lookTouch = zone
        }
      }
    }

    this.onTouchMove = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i]
        if (this.moveTouch?.id === t.identifier) {
          this.moveTouch.currentX = t.clientX
          this.moveTouch.currentY = t.clientY
        } else if (this.lookTouch?.id === t.identifier) {
          this.lookTouch.currentX = t.clientX
          this.lookTouch.currentY = t.clientY
        }
      }
    }

    this.onTouchEnd = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i]
        if (this.moveTouch?.id === t.identifier) this.moveTouch = null
        if (this.lookTouch?.id === t.identifier) this.lookTouch = null
      }
    }

    window.addEventListener('touchstart', this.onTouchStart, { passive: true })
    window.addEventListener('touchmove', this.onTouchMove, { passive: true })
    window.addEventListener('touchend', this.onTouchEnd, { passive: true })
  }

  private getAxis(zone: TouchZone | null, maxRadius = 50): { x: number; y: number } {
    if (!zone) return { x: 0, y: 0 }
    const dx = (zone.currentX - zone.startX) / maxRadius
    const dy = (zone.currentY - zone.startY) / maxRadius
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len > 1) return { x: dx / len, y: dy / len }
    return { x: dx, y: dy }
  }

  update(): Partial<GameActions> {
    const move = this.getAxis(this.moveTouch)
    const look = this.getAxis(this.lookTouch)
    return {
      moveX: move.x,
      moveY: move.y,
      lookX: look.x,
      lookY: look.y,
    }
  }

  destroy() {
    window.removeEventListener('touchstart', this.onTouchStart)
    window.removeEventListener('touchmove', this.onTouchMove)
    window.removeEventListener('touchend', this.onTouchEnd)
  }
}
