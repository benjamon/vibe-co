import { useEffect, useRef } from 'react'

export function useKeyboard() {
  const keys = useRef(new Set<string>())

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => keys.current.add(e.code)
    const onUp = (e: KeyboardEvent) => keys.current.delete(e.code)
    const onBlur = () => keys.current.clear()

    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return keys.current
}
