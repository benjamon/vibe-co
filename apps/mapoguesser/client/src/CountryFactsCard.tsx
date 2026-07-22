import type { Marker } from './store'
import { countryPopulationRank } from './store'
import { SlideUpCard, FactsGrid, FactRow } from './SlideUpCard'

const popFmt = (p: number) => p.toLocaleString()

// The Countries mode's after-guess info card: flag + population for whichever
// country a round just resolved on (a correct guess, or the miss-twice
// reveal).
export function CountryFactsCard({
  marker,
  countryCodes,
  countryPopulations,
  seed,
}: {
  // The most recently resolved 'correct'/'reveal' marker for the active
  // match (null when there's nothing to show, or outside the countries mode).
  marker: Marker | null
  countryCodes: Record<string, string>
  countryPopulations: Record<string, number>
  seed: string | null
}) {
  return (
    <SlideUpCard
      triggerKey={marker}
      data={marker}
      seed={seed}
      renderContent={(m) => {
        const code = countryCodes[m.label]
        const pop = countryPopulations[m.label]
        const rank = countryPopulationRank(countryPopulations, m.label)
        return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              {code && (
                <img
                  src={`https://flagcdn.com/w80/${code}.png`}
                  alt=""
                  width={42}
                  height={31}
                  style={{
                    borderRadius: 3,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.6)',
                    flex: 'none',
                    objectFit: 'cover',
                  }}
                />
              )}
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.2 }}>
                {m.label}
              </div>
            </div>
            {pop !== undefined ? (
              <FactsGrid>
                <FactRow
                  label="Population"
                  value={
                    <>
                      {popFmt(pop)}
                      {rank !== null && (
                        <span style={{ opacity: 0.6, fontWeight: 400 }}> (#{rank})</span>
                      )}
                    </>
                  }
                />
              </FactsGrid>
            ) : (
              <div style={{ fontSize: 13, opacity: 0.6 }}>No facts available.</div>
            )}
          </>
        )
      }}
    />
  )
}
