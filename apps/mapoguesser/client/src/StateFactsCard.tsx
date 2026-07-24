import type { Marker } from './store'
import { usStateFlagUrl } from './usStateFlags'
import { US_STATE_FACTS, usStatePopulationRank } from './usStateFacts'
import { SlideUpCard, FactsGrid, FactRow } from './SlideUpCard'
import { border } from './theme'

// The US States mode's after-guess info card: flag + population/capital/
// statehood facts for whichever state a round just resolved on (a correct
// guess, or the miss-twice reveal).
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
        const facts = US_STATE_FACTS[m.label]
        const rank = usStatePopulationRank(m.label)
        return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <img
                src={usStateFlagUrl(m.label)}
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
                <FactRow label="Statehood" value={facts.admitted} />
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
