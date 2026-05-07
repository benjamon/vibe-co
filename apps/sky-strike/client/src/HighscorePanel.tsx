import { useEffect, useRef, useState } from 'react'
import {
  getUserId,
  setUserName,
  subscribeHighscores,
  subscribeUserName,
  type HighScoreEntry,
} from './highscore'
import { getUpgrade, getUpgradeByCode, type RunBuild, type UpgradeId } from './store'

const TOP_N = 10

type WindowKind = 'all' | 'week' | 'day'
const WINDOW_ORDER: WindowKind[] = ['all', 'week', 'day']
const WINDOW_LABEL: Record<WindowKind, string> = {
  all: 'ALL TIME',
  week: 'THIS WEEK',
  day: 'TODAY',
}
const DAY_MS = 24 * 60 * 60 * 1000

function windowCutoff(kind: WindowKind): number {
  if (kind === 'all') return 0
  if (kind === 'week') return Date.now() - 7 * DAY_MS
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today.getTime()
}

function cycleWindow(current: WindowKind, dir: 1 | -1): WindowKind {
  const i = WINDOW_ORDER.indexOf(current)
  const next = (i + dir + WINDOW_ORDER.length) % WINDOW_ORDER.length
  return WINDOW_ORDER[next]
}

export function HighscorePanel() {
  const [scores, setScores] = useState<HighScoreEntry[]>([])
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [windowKind, setWindowKind] = useState<WindowKind>('all')

  useEffect(() => subscribeHighscores(setScores), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      e.preventDefault()
      setWindowKind((w) => cycleWindow(w, e.key === 'ArrowRight' ? 1 : -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const cutoff = windowCutoff(windowKind)
  const filtered = cutoff === 0 ? scores : scores.filter((s) => s.timestamp >= cutoff)
  const top = filtered.slice(0, TOP_N)
  const myId = getUserId()

  return (
    <div style={panelStyle}>
      <div style={titleStyle}>HIGH SCORES</div>
      <WindowSelector kind={windowKind} onChange={setWindowKind} />
      <NameEditor />
      {top.length === 0 ? (
        <div style={emptyStyle}>NO RUNS YET — BE THE FIRST</div>
      ) : (
        <div style={listStyle}>
          {top.map((entry, i) => {
            const isMe = entry.userId === myId
            const expanded = expandedUserId === entry.userId
            return (
              <div key={entry.userId} style={rowStyle(isMe)}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setExpandedUserId(expanded ? null : entry.userId)
                  }}
                  style={rowButtonStyle}
                  aria-expanded={expanded}
                >
                  <span style={rankStyle}>#{i + 1}</span>
                  <span style={nameStyle(isMe)}>{entry.name}</span>
                  <span style={scoreStyle}>{formatScore(entry.score)}</span>
                  <span style={chevronStyle}>{expanded ? '▾' : '▸'}</span>
                </button>
                {expanded && <BuildBreakdown build={entry.build} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function WindowSelector({ kind, onChange }: { kind: WindowKind; onChange: (k: WindowKind) => void }) {
  return (
    <div style={windowRowStyle} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onChange(cycleWindow(kind, -1))
        }}
        style={windowArrowStyle}
        aria-label="Previous window"
      >
        ◂
      </button>
      <span style={windowLabelStyle}>{WINDOW_LABEL[kind]}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onChange(cycleWindow(kind, 1))
        }}
        style={windowArrowStyle}
        aria-label="Next window"
      >
        ▸
      </button>
    </div>
  )
}

function NameEditor() {
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => subscribeUserName(setName), [])
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft(name)
    setEditing(true)
  }
  const commit = (next: string) => {
    const trimmed = next.trim()
    if (trimmed && trimmed !== name) setUserName(trimmed)
    setEditing(false)
  }
  const cancel = () => setEditing(false)

  if (editing) {
    return (
      <form
        style={nameRowStyle}
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          commit(draft)
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span style={nameLabelStyle}>YOU</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              cancel()
            }
          }}
          maxLength={24}
          style={nameInputStyle}
          aria-label="Pilot name"
        />
        <button type="submit" style={nameSaveButtonStyle} onClick={(e) => e.stopPropagation()}>
          SAVE
        </button>
      </form>
    )
  }

  return (
    <div style={nameRowStyle} onClick={(e) => e.stopPropagation()}>
      <span style={nameLabelStyle}>YOU</span>
      <span style={nameDisplayStyle}>{name}</span>
      <button type="button" onClick={startEdit} style={editButtonStyle} aria-label="Edit pilot name">
        EDIT
      </button>
    </div>
  )
}

function BuildBreakdown({ build }: { build: RunBuild }) {
  const items = Object.entries(build)
  if (items.length === 0) {
    return <div style={buildEmptyStyle}>(no upgrades taken)</div>
  }
  items.sort((a, b) => b[1] - a[1])
  return (
    <div style={buildListStyle}>
      {items.map(([key, count]) => {
        const def = safeGetUpgrade(key)
        const label = def?.name ?? key
        return (
          <div key={key} style={buildRowStyle}>
            <span style={buildNameStyle}>{label}</span>
            <span style={buildCountStyle}>×{count}</span>
          </div>
        )
      })}
    </div>
  )
}

function safeGetUpgrade(key: string) {
  const byCode = getUpgradeByCode(key)
  if (byCode) return byCode
  try {
    return getUpgrade(key as UpgradeId) ?? null
  } catch {
    return null
  }
}

function formatScore(score: number): string {
  return score.toString().padStart(6, '0')
}

const panelStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  background: 'rgba(8, 14, 38, 0.78)',
  border: '1.5px solid rgba(51, 221, 255, 0.55)',
  borderRadius: 10,
  padding: '14px 16px',
  marginTop: 24,
  width: 'min(420px, 92vw)',
  boxShadow: '0 0 22px rgba(51, 221, 255, 0.25)',
  fontFamily: "'Orbitron', system-ui, sans-serif",
  color: '#cceeff',
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 11,
  letterSpacing: '0.3em',
  color: '#33ddff',
  textAlign: 'center',
  marginBottom: 10,
  textShadow: '0 0 8px rgba(51, 221, 255, 0.6)',
}

const emptyStyle: React.CSSProperties = {
  textAlign: 'center',
  fontSize: 12,
  color: 'rgba(170, 200, 220, 0.6)',
  letterSpacing: '0.15em',
  padding: '6px 0',
}

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

function rowStyle(isMe: boolean): React.CSSProperties {
  return {
    background: isMe ? 'rgba(51, 221, 255, 0.13)' : 'transparent',
    borderRadius: 6,
    border: isMe ? '1px solid rgba(51, 221, 255, 0.4)' : '1px solid transparent',
    overflow: 'hidden',
  }
}

const rowButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  padding: '6px 8px',
  background: 'transparent',
  border: 'none',
  color: '#cceeff',
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
  textAlign: 'left',
}

const rankStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 10,
  color: '#88aabb',
  width: 28,
  letterSpacing: '0.1em',
}

function nameStyle(isMe: boolean): React.CSSProperties {
  return {
    flex: 1,
    color: isMe ? '#aaffdd' : '#cceeff',
    fontWeight: isMe ? 700 : 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }
}

const scoreStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 12,
  color: '#33ddff',
  letterSpacing: '0.05em',
}

const chevronStyle: React.CSSProperties = {
  color: '#446677',
  fontSize: 12,
}

const buildListStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px 10px',
  padding: '6px 12px 8px 44px',
  fontSize: 11,
  color: '#aaccdd',
  letterSpacing: '0.04em',
}

const buildRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'baseline',
}

const buildNameStyle: React.CSSProperties = {
  color: '#cceeff',
}

const buildCountStyle: React.CSSProperties = {
  color: '#33ddff',
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 9,
}

const buildEmptyStyle: React.CSSProperties = {
  padding: '6px 12px 8px 44px',
  fontSize: 11,
  color: 'rgba(170, 200, 220, 0.5)',
  fontStyle: 'italic',
}

const nameRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginBottom: 10,
  padding: '4px 6px',
  background: 'rgba(51, 221, 255, 0.06)',
  border: '1px solid rgba(51, 221, 255, 0.25)',
  borderRadius: 6,
}

const nameLabelStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 9,
  color: '#88aabb',
  letterSpacing: '0.18em',
}

const nameDisplayStyle: React.CSSProperties = {
  flex: 1,
  fontFamily: "'Orbitron', system-ui, sans-serif",
  fontSize: 13,
  color: '#aaffdd',
  fontWeight: 700,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const nameInputStyle: React.CSSProperties = {
  flex: 1,
  fontFamily: "'Orbitron', system-ui, sans-serif",
  fontSize: 13,
  color: '#aaffdd',
  background: 'rgba(0, 0, 0, 0.4)',
  border: '1px solid rgba(51, 221, 255, 0.5)',
  borderRadius: 4,
  padding: '4px 8px',
  outline: 'none',
}

const editButtonStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 9,
  color: '#33ddff',
  background: 'transparent',
  border: '1px solid rgba(51, 221, 255, 0.55)',
  borderRadius: 4,
  padding: '4px 8px',
  cursor: 'pointer',
  letterSpacing: '0.15em',
}

const nameSaveButtonStyle: React.CSSProperties = {
  ...editButtonStyle,
  background: '#33ddff',
  color: '#08203a',
}

const windowRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  marginBottom: 10,
}

const windowArrowStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 14,
  color: '#33ddff',
  background: 'transparent',
  border: '1px solid rgba(51, 221, 255, 0.4)',
  borderRadius: 4,
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
}

const windowLabelStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 10,
  color: '#aaffdd',
  letterSpacing: '0.18em',
  minWidth: 110,
  textAlign: 'center',
}
