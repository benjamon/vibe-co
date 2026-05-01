import { useEffect, useRef } from 'react'

export interface InputState {
  left: boolean
  right: boolean
}

export function useInput() {
  const ref = useRef<InputState>({ left: false, right: false })

  useEffect(() => {
    const state = ref.current
    const touches = new Map<number, 'left' | 'right'>()

    const recompute = () => {
      let left = false
      let right = false
      touches.forEach((side) => {
        if (side === 'left') left = true
        else right = true
      })
      state.left = left
      state.right = right
    }

    const sideOf = (x: number) => (x < window.innerWidth / 2 ? 'left' : 'right')

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null
      if (target && target.closest('button, a, input, [data-no-touch-capture]')) {
        return
      }
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i]
        touches.set(t.identifier, sideOf(t.clientX))
      }
      recompute()
    }
    const onTouchMove = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i]
        if (touches.has(t.identifier)) {
          touches.set(t.identifier, sideOf(t.clientX))
        }
      }
      recompute()
    }
    const onTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        touches.delete(e.changedTouches[i].identifier)
      }
      recompute()
    }

    let mouseSide: 'left' | 'right' | null = null
    const onMouseDown = (e: MouseEvent) => {
      mouseSide = sideOf(e.clientX)
      if (mouseSide === 'left') state.left = true
      else state.right = true
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!mouseSide) return
      const next = sideOf(e.clientX)
      if (next !== mouseSide) {
        if (mouseSide === 'left') state.left = false
        else state.right = false
        mouseSide = next
        if (mouseSide === 'left') state.left = true
        else state.right = true
      }
    }
    const onMouseUp = () => {
      if (mouseSide === 'left') state.left = false
      if (mouseSide === 'right') state.right = false
      mouseSide = null
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') state.left = true
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') state.right = true
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') state.left = false
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') state.right = false
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  return ref
}
