import type { GameActions, InputSource } from './actions'

const DEADZONE = 0.15

function applyDeadzone(value: number): number {
  if (Math.abs(value) < DEADZONE) return 0
  const sign = Math.sign(value)
  return sign * ((Math.abs(value) - DEADZONE) / (1 - DEADZONE))
}

export class GamepadInput implements InputSource {
  update(): Partial<GameActions> {
    const gamepads = navigator.getGamepads()
    const gp = gamepads[0]
    if (!gp) return {}

    return {
      moveX: applyDeadzone(gp.axes[0]),
      moveY: applyDeadzone(gp.axes[1]),
      lookX: applyDeadzone(gp.axes[2]),
      lookY: applyDeadzone(gp.axes[3]),
      jump: gp.buttons[0]?.pressed ?? false,
      attack: gp.buttons[7]?.pressed ?? false,  // RT
      interact: gp.buttons[2]?.pressed ?? false, // X
      pause: gp.buttons[9]?.pressed ?? false,    // Start
    }
  }

  destroy() {
    // No listeners to clean up — gamepad API is polled
  }
}
