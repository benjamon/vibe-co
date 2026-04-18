export interface GameActions {
  // Analog axes (-1 to 1)
  moveX: number
  moveY: number
  lookX: number
  lookY: number

  // Digital buttons (pressed this frame)
  jump: boolean
  attack: boolean
  interact: boolean
  pause: boolean
}

export interface InputSource {
  update(): Partial<GameActions>
  destroy(): void
}

export function createDefaultActions(): GameActions {
  return {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    jump: false,
    attack: false,
    interact: false,
    pause: false,
  }
}
