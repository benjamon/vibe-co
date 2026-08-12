import { SlideUpCard, FactsGrid, FactRow } from './SlideUpCard'
import { border } from './theme'

export interface CityFactsData {
  // ne_id of the city, doubling as the trigger key (a new value each round).
  key: string
  city: string
  // The country (or, in a US-state-lines mode, state) name.
  place: string
  flagCode?: string
  flagSrc?: string
  pop: number
  // Population rank among every loaded US city (if American) or every
  // loaded city worldwide (otherwise) — see store.ts's cityPopulationRank.
  // Null if unranked.
  rank: number | null
  founded?: number
  // Whether this city is its state's (or country's) capital — shown with a
  // 🏛️ next to the name, mirroring the 🏛️ on the state card's Capital row.
  isCapital?: boolean
}

const popFmt = (p: number) => p.toLocaleString()

// The capitals (cities) mode's after-guess info card: flag + city facts for
// whichever city a round just finished on.
export function CityFactsCard({
  info,
  seed,
  onDismiss,
}: {
  // The just-completed round's city facts (null between rounds / outside
  // capitals mode).
  info: CityFactsData | null
  seed: string | null
  onDismiss?: () => void
}) {
  return (
    <SlideUpCard
      triggerKey={info?.key ?? null}
      data={info}
      seed={seed}
      onDismiss={onDismiss}
      renderContent={(d) => (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            {(d.flagSrc || d.flagCode) && (
              <img
                src={d.flagSrc ?? `https://flagcdn.com/w80/${d.flagCode}.png`}
                alt=""
                width={63}
                height={47}
                style={{
                  borderRadius: 6,
                  border: border(2),
                  flex: 'none',
                  objectFit: 'cover',
                }}
              />
            )}
            <div style={{ lineHeight: 1.25 }}>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.2 }}>
                {d.city}
                {d.isCapital && ' 🏛️'}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {d.place}
              </div>
            </div>
          </div>
          <FactsGrid>
            <FactRow
              label="Population"
              value={
                <>
                  {popFmt(d.pop)}
                  {d.rank !== null && (
                    <span style={{ fontWeight: 500 }}> (#{d.rank})</span>
                  )}
                </>
              }
            />
            {d.founded !== undefined && <FactRow label="Founded" value={d.founded} />}
          </FactsGrid>
        </>
      )}
    />
  )
}
