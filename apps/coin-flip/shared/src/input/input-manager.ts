import type { GameActions, InputSource } from './actions'
import { createDefaultActions } from './actions'

export class InputManager {
  private sources: InputSource[] = []

  addSource(source: InputSource) {
    this.sources.push(source)
  }

  update(): GameActions {
    const merged = createDefaultActions()

    for (const source of this.sources) {
      const partial = source.update()
      for (const [key, value] of Object.entries(partial)) {
        const k = key as keyof GameActions
        if (typeof value === 'number' && value !== 0) {
          ;(merged as any)[k] = value
        } else if (typeof value === 'boolean' && value) {
          ;(merged as any)[k] = value
        }
      }
    }

    return merged
  }

  destroy() {
    for (const source of this.sources) {
      source.destroy()
    }
    this.sources = []
  }
}
