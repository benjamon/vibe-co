import { useEffect, useMemo, useState } from 'react'
import { UPGRADES } from './store'
import { subscribeAbilityStats, type AbilityStat, type AbilityStatsSnapshot } from './highscore'

interface RowData {
  code: string
  name: string
  userRate: number | null
  globalRate: number | null
  userVotes: number
  globalVotes: number
}

function pickRate(stat: AbilityStat | undefined): number | null {
  if (!stat) return null
  const total = stat.picks + stat.passes
  if (total <= 0) return null
  return stat.picks / total
}

function buildRows(snap: AbilityStatsSnapshot): RowData[] {
  const userByCode = new Map(snap.user.map((s) => [s.code, s]))
  const globalByCode = new Map(snap.global.map((s) => [s.code, s]))
  return UPGRADES.map((u) => {
    const userStat = userByCode.get(u.code)
    const globalStat = globalByCode.get(u.code)
    return {
      code: u.code,
      name: u.name,
      userRate: pickRate(userStat),
      globalRate: pickRate(globalStat),
      userVotes: userStat ? userStat.picks + userStat.passes : 0,
      globalVotes: globalStat ? globalStat.picks + globalStat.passes : 0,
    }
  })
}

// Bucket each non-null rate into one of 5 quintiles (-2 .. +2) by rank.
// Lowest pick rate → -2 (🧊🧊), highest → +2 (🔥🔥).
function quintileScores(values: (number | null)[]): (number | null)[] {
  const valid = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null)
  const result: (number | null)[] = values.map(() => null)
  if (valid.length < 5) return result
  valid.sort((a, b) => a.v - b.v)
  for (let r = 0; r < valid.length; r++) {
    const q = Math.min(4, Math.floor((r * 5) / valid.length))
    result[valid[r].i] = q - 2
  }
  return result
}

const RATING_LABEL: Record<string, string> = {
  '2': '🔥🔥',
  '1': '🔥',
  '0': '—',
  '-1': '🧊',
  '-2': '🧊🧊',
}

function ratingFor(score: number | null): string {
  if (score === null) return '·'
  return RATING_LABEL[String(score)] ?? '·'
}

function formatRate(rate: number | null): string {
  if (rate === null) return '—'
  return `${Math.round(rate * 100)}%`
}

export function GlobalStats({ onClose }: { onClose: () => void }) {
  const [snap, setSnap] = useState<AbilityStatsSnapshot>({ global: [], user: [] })
  useEffect(() => subscribeAbilityStats(setSnap), [])

  const rows = useMemo(() => buildRows(snap), [snap])
  const userScores = useMemo(
    () => quintileScores(rows.map((r) => r.userRate)),
    [rows],
  )
  const globalScores = useMemo(
    () => quintileScores(rows.map((r) => r.globalRate)),
    [rows],
  )

  const sorted = useMemo(() => {
    const indexed = rows.map((r, i) => ({ r, i }))
    indexed.sort((a, b) => {
      const ar = a.r.globalRate
      const br = b.r.globalRate
      if (ar === null && br === null) return a.r.name.localeCompare(b.r.name)
      if (ar === null) return 1
      if (br === null) return -1
      return br - ar
    })
    return indexed
  }, [rows])

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerRowStyle}>
          <h2 style={titleStyle}>GLOBAL STATS</h2>
          <button style={closeButtonStyle} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div style={legendStyle}>
          <span>🔥🔥 top</span>
          <span>🔥 high</span>
          <span>— mid</span>
          <span>🧊 low</span>
          <span>🧊🧊 bottom</span>
        </div>
        <div style={tableHeaderStyle}>
          <span style={nameColStyle}>Ability</span>
          <span style={rateColStyle}>You</span>
          <span style={rateColStyle}>Global</span>
        </div>
        <div style={listStyle}>
          {sorted.map(({ r, i }) => (
            <div key={r.code} style={rowStyle}>
              <span style={nameCellStyle}>{r.name}</span>
              <span style={rateCellStyle}>
                <span style={rateNumStyle}>{formatRate(r.userRate)}</span>
                <span style={ratingStyle}>{ratingFor(userScores[i])}</span>
              </span>
              <span style={rateCellStyle}>
                <span style={rateNumStyle}>{formatRate(r.globalRate)}</span>
                <span style={ratingStyle}>{ratingFor(globalScores[i])}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(5, 5, 20, 0.88)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '24px 12px',
  overflowY: 'auto',
  zIndex: 20,
  fontFamily: "'Orbitron', system-ui, sans-serif",
  cursor: 'pointer',
}

const cardStyle: React.CSSProperties = {
  width: 'min(520px, 96vw)',
  maxHeight: 'calc(100vh - 48px)',
  display: 'flex',
  flexDirection: 'column',
  background: 'rgba(8, 14, 38, 0.92)',
  border: '1.5px solid rgba(51, 221, 255, 0.55)',
  borderRadius: 10,
  boxShadow: '0 0 22px rgba(51, 221, 255, 0.25)',
  color: '#cceeff',
  cursor: 'default',
}

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  borderBottom: '1px solid rgba(51, 221, 255, 0.25)',
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 14,
  letterSpacing: '0.16em',
  color: '#33ddff',
  textShadow: '0 0 12px rgba(51, 221, 255, 0.55)',
}

const closeButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#33ddff',
  border: '1px solid rgba(51, 221, 255, 0.55)',
  borderRadius: 4,
  width: 28,
  height: 28,
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
  fontWeight: 'bold',
}

const legendStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '8px 14px',
  fontSize: 11,
  color: '#88aabb',
  borderBottom: '1px solid rgba(51, 221, 255, 0.18)',
  flexWrap: 'wrap',
  gap: 6,
}

const tableHeaderStyle: React.CSSProperties = {
  display: 'flex',
  padding: '8px 14px',
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 9,
  letterSpacing: '0.18em',
  color: '#88aabb',
  borderBottom: '1px solid rgba(51, 221, 255, 0.25)',
}

const listStyle: React.CSSProperties = {
  overflowY: 'auto',
  padding: '4px 0',
  flex: 1,
}

const nameColStyle: React.CSSProperties = {
  flex: 1.4,
  textAlign: 'left',
}

const rateColStyle: React.CSSProperties = {
  flex: 1,
  textAlign: 'right',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '7px 14px',
  borderBottom: '1px solid rgba(51, 221, 255, 0.08)',
  fontSize: 13,
}

const nameCellStyle: React.CSSProperties = {
  flex: 1.4,
  textAlign: 'left',
  letterSpacing: '0.04em',
}

const rateCellStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'baseline',
  gap: 6,
}

const rateNumStyle: React.CSSProperties = {
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 10,
  color: '#aaffdd',
  minWidth: 36,
  textAlign: 'right',
}

const ratingStyle: React.CSSProperties = {
  fontSize: 14,
  minWidth: 36,
  textAlign: 'right',
}
