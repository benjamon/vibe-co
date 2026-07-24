import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { COLOR, panelStyle } from './theme'

const AUTO_DISMISS_MS = 12000
const SWIPE_DISMISS_PX = 90

// A card that slides up from the bottom of the screen, showing a snapshot of
// `data` taken whenever `triggerKey` changes to a new non-null value (so the
// caller can freely recompute `data` every render without spuriously
// re-triggering the appear animation — only a genuine new round does that).
// Swipe left/right to dismiss early; auto-dismisses after AUTO_DISMISS_MS.
// `seed` changing (a new match starting) hides any lingering card instantly.
export function SlideUpCard<T>({
  triggerKey,
  data,
  seed,
  renderContent,
  onDismiss,
}: {
  triggerKey: unknown
  data: T | null
  seed: string | null
  renderContent: (data: T) => React.ReactNode
  // Fired when the card leaves the screen by auto-timeout or swipe (not on a
  // hard reset from `seed` changing) — the caller's cue to tidy up whatever
  // this card was showing, e.g. clearing the round's pins off the globe.
  onDismiss?: () => void
}) {
  const [shown, setShown] = useState<T | null>(null)
  const [visible, setVisible] = useState(false)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startXRef = useRef(0)
  const dismissTimerRef = useRef<number | null>(null)

  const clearDismissTimer = () => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }
  const armDismissTimer = () => {
    clearDismissTimer()
    dismissTimerRef.current = window.setTimeout(() => {
      setVisible(false)
      onDismiss?.()
    }, AUTO_DISMISS_MS)
  }

  useEffect(() => {
    if (triggerKey === null || triggerKey === undefined || data === null) return
    setShown(data)
    setDragX(0)
    setVisible(true)
    armDismissTimer()
    return clearDismissTimer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey])

  // A new match starting hides any lingering card instantly, with no
  // slide-out — it'd otherwise sit there showing the last match's info.
  useEffect(() => {
    clearDismissTimer()
    setVisible(false)
    setShown(null)
    setDragX(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  if (!shown) return null

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    setDragging(true)
    startXRef.current = e.clientX
    clearDismissTimer()
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragX(e.clientX - startXRef.current)
  }
  const handlePointerUp = () => {
    if (!dragging) return
    setDragging(false)
    if (Math.abs(dragX) > SWIPE_DISMISS_PX) {
      setVisible(false)
      onDismiss?.()
    } else {
      setDragX(0)
      armDismissTimer()
    }
  }

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onTransitionEnd={() => {
        if (!visible) setShown(null)
      }}
      style={{
        ...panelStyle,
        position: 'absolute',
        left: '50%',
        bottom: 64,
        width: 'min(320px, 88vw)',
        boxSizing: 'border-box',
        transform: `translate(calc(-50% + ${dragX}px), ${visible ? '0%' : '160%'})`,
        opacity: visible ? 1 - Math.min(1, Math.abs(dragX) / 260) : 0,
        transition: dragging
          ? 'none'
          : 'transform 0.4s cubic-bezier(.22,.85,.32,1), opacity 0.3s ease',
        touchAction: 'pan-y',
        cursor: dragging ? 'grabbing' : 'grab',
        pointerEvents: 'auto',
        userSelect: 'none',
        zIndex: 900,
        padding: '12px 16px 14px',
      }}
    >
      <div
        style={{
          width: 36,
          height: 4,
          borderRadius: 2,
          background: COLOR.charcoal,
          opacity: 0.3,
          margin: '0 auto 10px',
        }}
      />
      {renderContent(shown)}
    </div>
  )
}

// Shared row layout for the label/value fact grid used by both the state and
// city facts cards.
export const FactsGrid = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr',
      rowGap: 5,
      columnGap: 12,
      fontSize: 14,
    }}
  >
    {children}
  </div>
)

export const FactRow = ({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) => (
  <>
    <span style={{ fontWeight: 600 }}>{label}</span>
    <span style={{ fontWeight: 700, textAlign: 'right' }}>{value}</span>
  </>
)
