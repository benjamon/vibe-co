import type { Marker } from './store'
import { stateFlagUrl, stateFacts, statePopulationRankFor } from './store'
import { SlideUpCard, FactsGrid, FactRow } from './SlideUpCard'
import { border } from './theme'

// The States family's after-guess info card (US States, Brazil): flag +
// population/capital facts (+ statehood year, US only) for whichever state
// a round just resolved on (a correct guess, or the miss-twice reveal).
export function StateFactsCard({
  marker,
  seed,
}: {
  // The most recently resolved 'correct'/'reveal' marker for the active
  // match (null when there's nothing to show, or outside the states mode).
  marker: Marker | null
  seed: string | null
}) {
  return (
    <SlideUpCard
      triggerKey={marker}
      data={marker}
      seed={seed}
      renderContent={(m) => {
        const facts = stateFacts(m.label)
        const rank = statePopulationRankFor(m.label)
        return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <img
                src={stateFlagUrl(m.label)}
                alt=""
                width={42}
                height={31}
                style={{
                  borderRadius: 5,
                  border: border(2),
                  flex: 'none',
                  objectFit: 'cover',
                }}
              />
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.2 }}>
                {m.label}
              </div>
            </div>
            {facts ? (
              <FactsGrid>
                <FactRow
                  label="Population"
                  value={
                    <>
                      {facts.population.toLocaleString()}
                      {rank !== null && (
                        <span style={{ fontWeight: 500 }}> (#{rank})</span>
                      )}
                    </>
                  }
                />
                <FactRow label="Capital" value={<>{facts.capital} 🏛️</>} />
                {facts.admitted !== undefined && (
                  <FactRow label="Statehood" value={facts.admitted} />
                )}
              </FactsGrid>
            ) : (
              <div style={{ fontSize: 13, fontWeight: 600 }}>No facts available.</div>
            )}
          </>
        )
      }}
    />
  )
}
