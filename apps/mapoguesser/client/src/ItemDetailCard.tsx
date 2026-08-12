import type { CityInfo } from './store'
import {
  countryPopulationRank,
  cityPopulationRank,
  cityRevealName,
  cityFlagUrl,
} from './store'
import type { ModeFamily } from './gameModes'
import { usStateFlagUrl } from './usStateFlags'
import { US_STATE_FACTS, usStatePopulationRank } from './usStateFacts'
import { US_CITY_FOUNDED } from './usCityFacts'
import { FactsGrid, FactRow } from './SlideUpCard'
import { COLOR, border, buttonStyle } from './theme'

const popFmt = (p: number) => p.toLocaleString()

// Detail view for one browsed item — shown in place of the item-list panel
// (or the My Stats country list) once a row is picked. Same flag+facts
// content as the in-game reveal cards (CountryFactsCard/StateFactsCard/
// CityFactsCard), but laid out inline in a panel rather than as a floating
// auto-dismissing SlideUpCard, and closed explicitly via the X button rather
// than a timeout/swipe.
export function ItemDetailCard({
  family,
  item,
  cities,
  countryCodes,
  countryPopulations,
  subModeId,
  onClose,
}: {
  family: ModeFamily
  // Country/state name, or (for cities) the city dataset key.
  item: string
  cities: Record<string, CityInfo>
  countryCodes: Record<string, string>
  countryPopulations: Record<string, number>
  subModeId: string
  onClose: () => void
}) {
  let flagCode: string | undefined
  let flagSrc: string | undefined
  let title = item
  let subtitle: string | undefined
  let isCapital = false
  let body: React.ReactNode

  if (family === 'states') {
    flagSrc = usStateFlagUrl(item)
    const facts = US_STATE_FACTS[item]
    const rank = usStatePopulationRank(item)
    body = facts ? (
      <FactsGrid>
        <FactRow
          label="Population"
          value={
            <>
              {facts.population.toLocaleString()}
              {rank !== null && <span style={{ fontWeight: 500 }}> (#{rank})</span>}
            </>
          }
        />
        <FactRow label="Capital" value={<>{facts.capital} 🏛️</>} />
        <FactRow label="Statehood" value={facts.admitted} />
      </FactsGrid>
    ) : (
      <div style={{ fontSize: 13, fontWeight: 600 }}>No facts available.</div>
    )
  } else if (family === 'cities') {
    const city = cities[item]
    if (city) {
      title = city.city
      subtitle = cityRevealName(city, subModeId)
      flagCode = countryCodes[city.country]
      flagSrc = cityFlagUrl(city, subModeId)
      isCapital = city.stateCapital || city.capital
      const rank = cityPopulationRank(cities, item)
      const founded = US_CITY_FOUNDED[city.city]
      body = (
        <FactsGrid>
          <FactRow
            label="Population"
            value={
              <>
                {popFmt(city.pop)}
                {rank !== null && <span style={{ fontWeight: 500 }}> (#{rank})</span>}
              </>
            }
          />
          {founded !== undefined && <FactRow label="Founded" value={founded} />}
        </FactsGrid>
      )
    } else {
      body = <div style={{ fontSize: 13, fontWeight: 600 }}>No facts available.</div>
    }
  } else {
    flagCode = countryCodes[item]
    const pop = countryPopulations[item]
    const rank = countryPopulationRank(countryPopulations, item)
    body =
      pop !== undefined ? (
        <FactsGrid>
          <FactRow
            label="Population"
            value={
              <>
                {popFmt(pop)}
                {rank !== null && <span style={{ fontWeight: 500 }}> (#{rank})</span>}
              </>
            }
          />
        </FactsGrid>
      ) : (
        <div style={{ fontSize: 13, fontWeight: 600 }}>No facts available.</div>
      )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {(flagSrc || flagCode) && (
            <img
              src={flagSrc ?? `https://flagcdn.com/w80/${flagCode}.png`}
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
          )}
          <div style={{ lineHeight: 1.25 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.2 }}>
              {title}
              {isCapital && ' 🏛️'}
            </div>
            {subtitle && <div style={{ fontSize: 14, fontWeight: 600 }}>{subtitle}</div>}
          </div>
        </div>
        <button
          type="button"
          className="arcade-btn"
          aria-label="Close"
          title="Back to list"
          onClick={onClose}
          style={{
            ...buttonStyle(COLOR.coral, COLOR.cream),
            width: 32,
            height: 32,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            lineHeight: 1,
            flex: 'none',
          }}
        >
          ×
        </button>
      </div>
      {body}
    </div>
  )
}
