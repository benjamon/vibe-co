import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { Confetti } from './Confetti'
import { Fireworks } from './Fireworks'
import { sfxEndJingle, installAudioUnlock } from './sfx'
import {
  useGameStore,
  ROUNDS,
  CAPITAL_ROUNDS,
  MAX_CAPITAL_POINTS,
  HINT_PENALTY,
  cityRevealName,
  cityFlagUrl,
  usPopulationRank,
  subModeProgress,
  poolForSubMode,
  itemWeightKey,
  MIN_ITEM_WEIGHT,
  DEFAULT_ITEM_WEIGHT,
  capitalPointTierMilesFor,
  type AttemptResult,
} from './store'
import { US_CITY_FOUNDED } from './usCityFacts'
import { usStateFlagUrl } from './usStateFlags'
import { StateFactsCard } from './StateFactsCard'
import { CountryFactsCard } from './CountryFactsCard'
import { CityFactsCard, type CityFactsData } from './CityFactsCard'
import { ItemDetailCard } from './ItemDetailCard'
import {
  fetchStats,
  releaseStats,
  subscribeStats,
  subscribeCountryGuesses,
  type CountryAgg,
} from './stats'
import { PartyOverlay, useParty } from './PartyUI'
import { subModesFor, resolveSubMode, type SubMode } from './gameModes'
import { COLOR, FONT, border, hardShadow, panelStyle, pillStyle, buttonStyle, disabledLook } from './theme'

// Cesium (~4 MB) lives entirely inside WorldViewer, so lazy-loading it splits
// that weight into its own chunk: the menu / start screen paints off the small
// React bundle while the globe streams in behind it. The `ready` flag already
// keeps the Start button showing "Loading…" until the globe has its data.
const WorldViewer = lazy(() =>
  import('./WorldViewer').then((m) => ({ default: m.WorldViewer })),
)

// Positioning-only base for the floating HUD readouts — each one gets its own
// opaque cream "scoreboard pill" background (see hudPillStyle) rather than
// bare text over the globe, so it stays legible over any map tile colour.
const overlayBase = {
  position: 'absolute',
  color: COLOR.charcoal,
  fontFamily: FONT,
  pointerEvents: 'none',
  userSelect: 'none',
} as const

// Opaque scoreboard-pill chrome for the HUD readouts (round status, guessed
// line, footer badge) — passport-stamp look: cream fill, chunky dark border,
// offset hard shadow.
const hudPillStyle = {
  background: COLOR.cream,
  border: border(2),
  borderRadius: 16,
  boxShadow: hardShadow(4),
  padding: '10px 18px',
} as const

// Background colour encodes the round outcome (green = correct, coral = wrong,
// cream = pending). Replaces the older ✓/✗ glyph — the flag now lives in the
// box, so the colour is the only thing carrying right/wrong.
const CHECK_BG: Record<AttemptResult, string> = {
  pending: COLOR.cream,
  correct: COLOR.green,
  wrong: COLOR.coral,
}

// Capitals-mode "+N points" / "+1 bonus" / "-N hint" pop-down toasts: a beat
// before the first one appears, and how long each one lingers once shown.
// POINT_TOAST_LIFE_MS must match the capPointToast animation duration below;
// POINT_TOAST_FADE_MS is how much of that lifespan, at the very end, is spent
// fading out (the toast stays fully visible for everything before that).
const POINT_TOAST_START_DELAY_MS = 1000
const POINT_TOAST_LIFE_MS = 3100
const POINT_TOAST_FADE_MS = 500

// flagcdn.com serves free, CORS-friendly PNGs at 4:3 (w40 = 40×30). Using
// images instead of emoji because Windows browsers render regional-indicator
// flag emojis as ISO letters, which looks broken.
const FlagIcon = ({
  code,
  src,
  height,
}: {
  code?: string
  // Explicit image URL override (US state flags aren't ISO country codes).
  src?: string
  height: number
}) => {
  const url = src ?? (code ? `https://flagcdn.com/w80/${code}.png` : undefined)
  if (!url) return null
  return (
    <img
      src={url}
      alt=""
      width={Math.round((height * 4) / 3)}
      height={height}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        borderRadius: 4,
        border: border(1.5),
      }}
    />
  )
}

// Three-line hamburger/list icon for the "view item list" button next to each
// sub-mode in the region picker.
const HamburgerIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
)

// Per-item mastery status, driven off the adaptive-difficulty weight (see
// store.ts's nextWeightEntry): floored to the minimum = mastered/solved,
// below the 1.0 default but not floored = improving, exactly the untouched
// default = new, above default = struggling (missed more than it's hit).
type ItemStatus = 'solved' | 'under' | 'exact' | 'over'
const STATUS_COLOR: Record<ItemStatus, string> = {
  solved: COLOR.green,
  under: COLOR.yellow,
  exact: COLOR.grey,
  over: COLOR.coral,
}
// Mastery sort order: least-mastered first (struggling items are the ones
// worth surfacing) down to fully solved.
const STATUS_RANK: Record<ItemStatus, number> = {
  over: 0,
  exact: 1,
  under: 2,
  solved: 3,
}
const statusOf = (weight: number): ItemStatus => {
  if (weight <= MIN_ITEM_WEIGHT) return 'solved'
  if (weight < DEFAULT_ITEM_WEIGHT) return 'under'
  if (weight === DEFAULT_ITEM_WEIGHT) return 'exact'
  return 'over'
}
const StatusDot = ({ status }: { status: ItemStatus }) => (
  <span
    style={{
      width: 12,
      height: 12,
      borderRadius: '50%',
      background: STATUS_COLOR[status],
      border: border(1.5),
      flex: 'none',
      display: 'inline-block',
    }}
  />
)

const Checkbox = ({
  result,
  code,
  flagSrc,
  count,
}: {
  result: AttemptResult
  code?: string
  // Explicit image URL override (US state flags aren't ISO country codes).
  flagSrc?: string
  // How many boxes share the row — drives the responsive shrink so they all fit
  // across a narrow viewport even when misses push the count above 9.
  count: number
}) => (
  <div
    style={{
      // 40px on desktop, but shrink to fit `count` boxes (+ 4px gaps) across the
      // viewport on a narrow portrait phone. aspectRatio keeps the 40:32 shape
      // as the width shrinks; the flag inside scales with it.
      width: `min(40px, calc((96vw - ${(count - 1) * 4}px) / ${count}))`,
      aspectRatio: '40 / 32',
      boxSizing: 'border-box',
      flex: 'none',
      border: border(2),
      borderRadius: 8,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: CHECK_BG[result],
      boxShadow: hardShadow(2),
      overflow: 'hidden',
    }}
  >
    {result !== 'pending' && (flagSrc || code) && (
      <img
        src={flagSrc ?? `https://flagcdn.com/w80/${code}.png`}
        alt=""
        style={{ display: 'block', width: '70%', height: 'auto', borderRadius: 2 }}
      />
    )}
  </div>
)

// Stats sum colour: green for net-positive, red for net-negative, neutral
// otherwise. A zero result still gets shown but uses the muted style so the
// strong colours stay reserved for clear signal.
const scoreColour = (sum: number): string => {
  if (sum > 0) return '#1E8E4A'
  if (sum < 0) return COLOR.coral
  return COLOR.charcoal
}

// End-of-match "N mastered" message: singular/plural noun per family, keyed
// off the just-played sub-mode's family (see subFamily below).
const MASTERED_NOUN: Record<'countries' | 'states' | 'cities', [string, string]> = {
  countries: ['country', 'countries'],
  states: ['state', 'states'],
  cities: ['city', 'cities'],
}
const masteredLabel = (family: keyof typeof MASTERED_NOUN, count: number): string => {
  const [singular, plural] = MASTERED_NOUN[family]
  return `${count} ${count === 1 ? singular : plural} mastered`
}

// Hamburger / menu / stats / start-screen all share this button look so the
// HUD reads as one consistent UI rather than a pile of bespoke styles. Pair
// with className="arcade-btn" for the press-depress :active state.
const menuButtonStyle = {
  ...buttonStyle(COLOR.cream),
  padding: '10px 15px',
  pointerEvents: 'auto',
} as const

export function App() {
  const phase = useGameStore((s) => s.phase)
  const target = useGameStore((s) => s.target)
  const revealTarget = useGameStore((s) => s.revealTarget)
  const attempts = useGameStore((s) => s.attempts)
  const markers = useGameStore((s) => s.markers)
  const markerEpoch = useGameStore((s) => s.markerEpoch)
  const countryCodes = useGameStore((s) => s.countryCodes)
  const countryPopulations = useGameStore((s) => s.countryPopulations)
  const countryIds = useGameStore((s) => s.countryIds)
  const stats = useGameStore((s) => s.stats)
  const selectedStatsCountryId = useGameStore((s) => s.selectedStatsCountryId)
  const selectStatsCountry = useGameStore((s) => s.selectStatsCountry)
  const statsMode = useGameStore((s) => s.statsMode)
  const setStatsMode = useGameStore((s) => s.setStatsMode)
  const globalStats = useGameStore((s) => s.globalStats)
  const myStats = useGameStore((s) => s.myStats)
  const ready = useGameStore((s) => s.countries.length > 0)
  const startGame = useGameStore((s) => s.startGame)
  const resetGame = useGameStore((s) => s.resetGame)
  const guess = useGameStore((s) => s.country)
  const seed = useGameStore((s) => s.seed)
  const mode = useGameStore((s) => s.mode)
  const subMode = useGameStore((s) => s.subMode)
  const distances = useGameStore((s) => s.distances)
  const capitalPoints = useGameStore((s) => s.capitalPoints)
  const capitalBonus = useGameStore((s) => s.capitalBonus)
  const capitalHintPenalty = useGameStore((s) => s.capitalHintPenalty)
  const targets = useGameStore((s) => s.targets)
  const cities = useGameStore((s) => s.cities)
  const revealName = useGameStore((s) => s.revealName)
  const revealFlag = useGameStore((s) => s.revealFlag)
  const hintCircle = useGameStore((s) => s.hintCircle)
  const useLifeline = useGameStore((s) => s.useLifeline)
  const roundGuess = useGameStore((s) => s.roundGuess)
  const clearRoundMarkers = useGameStore((s) => s.clearRoundMarkers)
  // Cities modes need the populated-places dataset (joined to country polygons)
  // before they can draw a pool. Gate on having enough capitals for the World
  // Capitals mode; the regional modes have plenty once cities are loaded.
  const capitalsReady = useGameStore(
    (s) =>
      Object.values(s.cities).filter((c) => c.capital).length >= CAPITAL_ROUNDS,
  )
  // The US States mode needs its own polygon dataset (independent of the
  // country one), so it gets its own readiness gate.
  const statesReady = useGameStore((s) => s.states.length > 0)
  const perfectStreak = useGameStore((s) => s.perfectStreak)
  const masteredThisMatch = useGameStore((s) => s.masteredThisMatch)
  const multiplayer = useGameStore((s) => s.multiplayer)
  // Adaptive-difficulty pool source for the mode-menu "solved" counts
  // (subModeProgress) — a narrow slice rather than subscribing to the whole
  // store, so unrelated state changes don't re-render the menu.
  const countries = useGameStore((s) => s.countries)
  const states = useGameStore((s) => s.states)
  const itemWeights = useGameStore((s) => s.itemWeights)
  const poolSource = useMemo(
    () => ({ cities, states, countries, itemWeights }),
    [cities, states, countries, itemWeights],
  )

  // Which family the active/last-played sub-mode belongs to — drives flag
  // sourcing (state flags vs country flags) in the HUD below.
  const subFamily = resolveSubMode(subMode).family
  // Whether the just-played mode's pool is loaded, gating the "Play Again"
  // button the same way the start-screen pickers gate their own buttons.
  const playAgainReady =
    mode === 'capitals' ? capitalsReady : subFamily === 'states' ? statesReady : ready

  // True whenever a party (lobby/in-game/results) owns the screen — used to
  // suppress all the single-player overlays while Party.tsx drives the UI.
  const { active: partyActive } = useParty()
  const [friendsOpen, setFriendsOpen] = useState(false)
  // Either of these means the single-player menu/HUD should step aside.
  const partyUI = partyActive || multiplayer

  const [menuOpen, setMenuOpen] = useState(false)
  // Which mode-family sub-menu the idle start screen is showing (null = the
  // top-level Countries / Cities / … picker).
  const [submenu, setSubmenu] = useState<
    null | 'countries' | 'cities' | 'states'
  >(null)
  const [statsOpen, setStatsOpen] = useState(false)
  const [statsSort, setStatsSort] = useState<'name' | 'sum'>('name')
  // Sub-mode whose full item list (weights + mastery status) the "view list"
  // button is showing, or null when that panel is closed.
  const [weightsSub, setWeightsSub] = useState<SubMode | null>(null)
  const [weightsSort, setWeightsSort] = useState<'name' | 'mastery'>('name')
  // The item (country/state name, or city key) currently drilled into from
  // the item-list panel — null shows the list, non-null shows its detail card
  // (see ItemDetailCard) and hides the list, per weightsSub's browse flow.
  const [weightsItem, setWeightsItem] = useState<string | null>(null)
  const setBrowseTarget = useGameStore((s) => s.setBrowseTarget)
  const setBrowseSubMode = useGameStore((s) => s.setBrowseSubMode)
  // Close the item-list panel's detail view (if any) and clear its flag pin.
  const closeWeightsItem = () => {
    setWeightsItem(null)
    setBrowseTarget(null)
  }
  // Open/close the item-list panel itself, mirroring the sub-mode id into the
  // store so WorldViewer can show the US state lines while a states/US-cities
  // list is open (see browseSubModeId).
  const updateWeightsSub = (sub: SubMode | null) => {
    setWeightsSub(sub)
    setBrowseSubMode(sub?.id ?? null)
  }
  const [showConfetti, setShowConfetti] = useState(false)
  const [confettiIntensity, setConfettiIntensity] = useState<'small' | 'full'>(
    'full',
  )
  const [showFireworks, setShowFireworks] = useState(false)
  // Floating "+N points" / "+1 country bonus" toasts fired whenever a capitals
  // round scores. Two toasts per round are staggered in time (not stacked
  // spatially) so a bonus doesn't visually collide with the base-points toast.
  const [pointToasts, setPointToasts] = useState<
    { id: number; text: string }[]
  >([])
  const nextPointToastId = useRef(1)

  // Reverse lookup ID → name so we can fold the local guess history into the
  // "mine" aggregate. Recompute only when the (grow-only) ID map changes.
  const idToName = useMemo(() => {
    const m: Record<number, string> = {}
    for (const [name, id] of Object.entries(countryIds)) m[id] = name
    return m
  }, [countryIds])

  // "Mine" aggregate keyed by country NAME: the server's per-user totals
  // (retrieved by the local random id) merged with this device's local history.
  // Local overlays the server when it holds at least as many samples, so the
  // view never shows fewer guesses than the player has actually made here.
  const mineAgg = useMemo(() => {
    const out: Record<string, CountryAgg> = {}
    for (const [name, a] of Object.entries(myStats)) {
      out[name] = { correct: a.correct, total: a.total }
    }
    for (const [idStr, s] of Object.entries(stats)) {
      const id = Number(idStr)
      const name = idToName[id]
      if (!name) continue
      let correct = 0
      for (const g of s.guesses) if (g.id === id) correct += 1
      const total = s.guesses.length
      const prev = out[name]
      if (!prev || total >= prev.total) out[name] = { correct, total }
    }
    return out
  }, [myStats, stats, idToName])

  // The dataset the sidebar is currently showing.
  const activeAgg = statsMode === 'global' ? globalStats : mineAgg

  // Flatten the active aggregate into a sorted, render-ready array. Only
  // countries with at least one recorded guess appear — an alphabetical wall of
  // every country in the dataset would be mostly noise. `sum` is the net score
  // (correct − wrong); selection is keyed by the local country ID.
  const statsRows = useMemo(() => {
    const rows: { id: number; name: string; sum: number; code?: string }[] = []
    for (const [name, a] of Object.entries(activeAgg)) {
      const id = countryIds[name]
      if (id === undefined) continue
      rows.push({
        id,
        name,
        sum: a.correct - (a.total - a.correct),
        code: countryCodes[name],
      })
    }
    rows.sort((a, b) =>
      statsSort === 'sum'
        ? b.sum - a.sum || a.name.localeCompare(b.name) // best net score first
        : a.name.localeCompare(b.name),
    )
    return rows
  }, [activeAgg, countryIds, countryCodes, statsSort])

  // Totals across every country, for the synthetic "All" row at the top.
  const statsTotals = useMemo(() => {
    let correct = 0
    let total = 0
    for (const a of Object.values(activeAgg)) {
      correct += a.correct
      total += a.total
    }
    return { correct, wrong: total - correct, total }
  }, [activeAgg])

  // Full item list (+ weight/status) for whichever sub-mode's "view list"
  // button was clicked. `item` is a country/state name for those families, or
  // a city dataset key for the cities family (see poolForSubMode).
  const weightsRows = useMemo(() => {
    if (!weightsSub) return []
    const pool = poolForSubMode(poolSource, weightsSub)
    const rows = pool.map((item) => {
      const weight =
        poolSource.itemWeights[itemWeightKey(weightsSub.family, item)]
          ?.weight ?? DEFAULT_ITEM_WEIGHT
      const city = weightsSub.family === 'cities' ? cities[item] : undefined
      const label =
        weightsSub.family === 'cities'
          ? city
            ? `${city.city}, ${cityRevealName(city, weightsSub.id)}`
            : item
          : item
      const flagCode =
        weightsSub.family === 'countries'
          ? countryCodes[item]
          : city
            ? countryCodes[city.country]
            : undefined
      const flagSrc =
        weightsSub.family === 'states'
          ? usStateFlagUrl(item)
          : city
            ? cityFlagUrl(city, weightsSub.id)
            : undefined
      return {
        key: item,
        label,
        percent: Math.round(weight * 100),
        status: statusOf(weight),
        flagCode,
        flagSrc,
      }
    })
    rows.sort((a, b) =>
      weightsSort === 'mastery'
        ? STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
          b.percent - a.percent ||
          a.label.localeCompare(b.label)
        : a.label.localeCompare(b.label),
    )
    return rows
  }, [weightsSub, weightsSort, poolSource, cities, countryCodes])

  // The per-guess log and the click markers grow together (one of each per
  // click), so they pair 1:1 in order — guess i was the country of click marker
  // i. Reveal markers are interleaved separately and filtered out. We want the
  // player's pick (so a missed box shows the wrong flag), not the answer.
  const clickMarkers = useMemo(
    () => markers.filter((m) => m.kind !== 'reveal'),
    [markers],
  )

  // The most recently resolved round for the active family — a correct guess
  // (which matches the target) or the miss-twice reveal (the answer that was
  // just shown). 'wrong' markers are on a target that hasn't resolved yet, so
  // they're skipped. Drives the after-guess facts cards below; the object
  // reference only changes when a *new* correct/reveal marker is pushed, so
  // this is a stable trigger for each card's "show again" effect.
  const lastResolvedStateMarker = useMemo(() => {
    if (subFamily !== 'states') return null
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i]
      if (m.kind === 'correct' || m.kind === 'reveal') return m
    }
    return null
  }, [markers, subFamily])
  const lastResolvedCountryMarker = useMemo(() => {
    if (subFamily !== 'countries') return null
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i]
      if (m.kind === 'correct' || m.kind === 'reveal') return m
    }
    return null
  }, [markers, subFamily])

  // The HUD shows a fixed ROUNDS boxes — the player's guess budget. Each guess
  // made fills a box (flagged by what was clicked); unused guesses are pending.
  // A missed-twice country leaves two 'wrong' boxes, eating into the budget.
  const guessBoxes = useMemo(() => {
    const boxes: {
      result: AttemptResult
      code?: string
      flagSrc?: string
    }[] = []
    const isStates = subFamily === 'states'
    for (let i = 0; i < ROUNDS; i++) {
      if (i < attempts.length) {
        const label = clickMarkers[i]?.label
        boxes.push({
          result: attempts[i],
          code: label && !isStates ? countryCodes[label] : undefined,
          flagSrc: label && isStates ? usStateFlagUrl(label) : undefined,
        })
      } else {
        boxes.push({ result: 'pending' })
      }
    }
    return boxes
  }, [attempts, clickMarkers, countryCodes, subFamily])

  const [shareLabel, setShareLabel] = useState<'idle' | 'copied'>('idle')

  useEffect(() => {
    ;(window as any).__gameState = useGameStore.getState()
    return useGameStore.subscribe((state) => {
      ;(window as any).__gameState = state
    })
  }, [])

  // Pipe SpacetimeDB snapshots into the store: aggregate per-country stats
  // (global + this user's) and the on-demand guess dots for a selected global
  // country. The connection itself is opened lazily (on the first guess or when
  // the stats panel opens), not here — visitors who only look hold nothing.
  useEffect(() => {
    const unsubStats = subscribeStats((snap) => {
      useGameStore.getState().setServerStats(snap.global, snap.mine)
    })
    const unsubGuesses = subscribeCountryGuesses((country, dots) => {
      useGameStore.getState().setGlobalGuesses(country, dots)
    })
    return () => {
      unsubStats()
      unsubGuesses()
    }
  }, [])

  // Auto-start a match if the URL carries a ?seed=. Runs once countries have
  // loaded, and only while we're still on the start screen — clicking
  // 'Play Again' later generates a fresh seed instead of replaying this one.
  useEffect(() => {
    if (!ready || phase !== 'idle') return
    // Never auto-start a solo game while a party owns (or is rejoining) the
    // screen — multiplayer is server-driven and doesn't use the URL seed.
    if (partyUI) return
    const params = new URLSearchParams(window.location.search)
    const urlSeed = params.get('seed')
    if (!urlSeed) return
    // `sm=<id>` is the current form (any region). Fall back to the legacy
    // `cap=1` (capitals) tag so old shared links still work. An old `wc=1`
    // (World Cup, now removed) link falls through to classic All.
    const smParam = params.get('sm')
    const sub = smParam
      ? resolveSubMode(smParam)
      : params.get('cap') === '1'
        ? resolveSubMode('capitals')
        : resolveSubMode('classic')
    // City sub-modes need the capitals dataset before the draw can reproduce;
    // states sub-modes need the state polygon dataset.
    if (sub.family === 'cities' && !capitalsReady) return
    if (sub.family === 'states' && !statesReady) return
    startGame(urlSeed, sub.id)
  }, [ready, capitalsReady, statesReady, phase, startGame, partyUI])

  // Mirror the active match seed (and its mode tag) into the URL so a refresh /
  // link share reproduces the same draw. replaceState avoids polluting history.
  useEffect(() => {
    // Multiplayer is server-driven: never expose the room's internal seed, and
    // strip any leftover single-player params so a refresh resumes the party
    // (via sessionStorage) instead of auto-starting a solo game from the URL.
    if (multiplayer) {
      const url = new URL(window.location.href)
      const dirty =
        url.searchParams.has('seed') ||
        url.searchParams.has('sm') ||
        url.searchParams.has('wc') ||
        url.searchParams.has('cap')
      if (dirty) {
        url.searchParams.delete('seed')
        url.searchParams.delete('sm')
        url.searchParams.delete('wc')
        url.searchParams.delete('cap')
        window.history.replaceState(null, '', url.toString())
      }
      return
    }
    if (!seed) return
    const url = new URL(window.location.href)
    // The sub-mode id fully identifies the draw. Omit it for the default 'all'
    // pool so a plain classic link stays clean (?seed=…). Legacy wc/cap tags are
    // dropped in favour of the single `sm` param.
    const wantSm = subMode !== 'all' ? subMode : null
    const seedOk = url.searchParams.get('seed') === seed
    const smOk = (url.searchParams.get('sm') || null) === wantSm
    const legacyClean =
      !url.searchParams.has('wc') && !url.searchParams.has('cap')
    if (seedOk && smOk && legacyClean) return
    url.searchParams.set('seed', seed)
    if (wantSm) url.searchParams.set('sm', wantSm)
    else url.searchParams.delete('sm')
    url.searchParams.delete('wc')
    url.searchParams.delete('cap')
    window.history.replaceState(null, '', url.toString())
  }, [seed, subMode, multiplayer])

  const correctCount = attempts.filter((a) => a === 'correct').length
  const isCapitals = mode === 'capitals'
  // Capitals mode: the great-circle miss of the round just finished — still
  // needed to gate the after-guess facts card below (the score itself is now
  // only shown via the point pop-down toasts, not this HUD).
  const lastMiles = distances.length ? distances[distances.length - 1] : null
  // Capitals mode point score: sum of the per-round points (distance tier +
  // region bonus) — the match score for city modes, driving the win-screen
  // tiers the same way correctCount does for classic mode.
  const totalCapitalPoints = capitalPoints.reduce((sum, p) => sum + p, 0)
  // A hint penalty can push a round's net points negative — only prefix "+"
  // on positive values so it never reads "+-5pts".
  const signedPts = (n: number) => (n > 0 ? `+${n}` : `${n}`)

  // The city the player just finished guessing. `target` has already advanced
  // to the next round's question by the time this reveal renders, so it's
  // derived from `targets`/`distances` (round i's distance lands at the same
  // index as round i's target) rather than read off the live `target`.
  const lastCityKey =
    isCapitals && distances.length ? targets[distances.length - 1] : null
  const lastCity = lastCityKey ? cities[lastCityKey] : null
  // Snapshot of the just-finished round's city, for the after-guess facts
  // card. `founded` is only known for US cities (see usCityFacts.ts) and
  // `rank` only for US cities (ranked among every loaded US city); both are
  // simply omitted for the rest of the world.
  const lastCityInfo: CityFactsData | null =
    lastCity && lastCityKey && lastMiles !== null
      ? {
          key: lastCityKey,
          city: lastCity.city,
          place: cityRevealName(lastCity, subMode),
          flagCode: countryCodes[lastCity.country],
          flagSrc: cityFlagUrl(lastCity, subMode),
          pop: lastCity.pop,
          rank: usPopulationRank(cities, lastCityKey),
          founded: US_CITY_FOUNDED[lastCity.city],
          isCapital: lastCity.stateCapital || lastCity.capital,
        }
      : null

  // Epoch snapshot of the map state as of the last capitals-mode reveal —
  // lets the details card's dismiss handler (which can fire up to
  // AUTO_DISMISS_MS later) tell whether the player has already started a new
  // round in the meantime (bumping markerEpoch again via their next guess),
  // so it never wipes pins that aren't the ones it was shown for.
  const cityRevealEpochRef = useRef(0)
  useEffect(() => {
    if (lastCityInfo) cityRevealEpochRef.current = markerEpoch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastCityInfo?.key])

  // When a match wraps up, play the score-appropriate jingle and fire the
  // matching visual celebration. Keyed on `phase` so it runs once per
  // transition into 'finished'. Tiers (classic mode, out of ROUNDS):
  //   7/9 → small confetti
  //   8/9 → full confetti
  //   9/9 → full confetti + fireworks
  // Capitals mirrors the same relative tiers (max, max-1, max-2) but out of
  // MAX_CAPITAL_POINTS (30) instead of ROUNDS.
  useEffect(() => {
    // Multiplayer runs its own celebration on the party results screen.
    if (phase !== 'finished' || multiplayer) {
      setShowConfetti(false)
      setShowFireworks(false)
      return
    }
    if (isCapitals) {
      sfxEndJingle(
        Math.round((totalCapitalPoints / MAX_CAPITAL_POINTS) * ROUNDS),
      )
      if (totalCapitalPoints >= MAX_CAPITAL_POINTS) {
        setConfettiIntensity('full')
        setShowConfetti(true)
        setShowFireworks(true)
      } else if (totalCapitalPoints === MAX_CAPITAL_POINTS - 1) {
        setConfettiIntensity('full')
        setShowConfetti(true)
      } else if (totalCapitalPoints === MAX_CAPITAL_POINTS - 2) {
        setConfettiIntensity('small')
        setShowConfetti(true)
      } else {
        setShowConfetti(false)
        setShowFireworks(false)
      }
      return
    }
    sfxEndJingle(correctCount)
    if (correctCount >= ROUNDS) {
      setConfettiIntensity('full')
      setShowConfetti(true)
      setShowFireworks(true)
    } else if (correctCount === ROUNDS - 1) {
      setConfettiIntensity('full')
      setShowConfetti(true)
    } else if (correctCount === ROUNDS - 2) {
      setConfettiIntensity('small')
      setShowConfetti(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Fire the "+N points" / "+1 bonus" floating toasts whenever a capitals round
  // scores (capitalPoints grows by one). Tracked with a ref rather than state
  // so resuming an in-progress match doesn't replay toasts for rounds that
  // were already scored before this mount.
  const prevCapitalRoundsRef = useRef(capitalPoints.length)
  useEffect(() => {
    const prevLen = prevCapitalRoundsRef.current
    prevCapitalRoundsRef.current = capitalPoints.length
    if (!isCapitals || capitalPoints.length <= prevLen) return
    const i = capitalPoints.length - 1
    const bonus = capitalBonus[i] ?? false
    const penalty = capitalHintPenalty[i] ?? 0
    // capitalPoints[i] already has the bonus added and the hint penalty
    // subtracted — back both out to isolate the pure distance-tier points for
    // its own toast.
    const base = capitalPoints[i] - (bonus ? 1 : 0) + penalty
    // Which distance bucket the scoring guess landed in, e.g. "<50 miles" —
    // points p came from tier index (tiers.length - p) in capitalPointTierMilesFor
    // (see store.ts's pointsForDistance); 0 points means it missed every
    // tier, i.e. fell outside the worst (last) one.
    const tiers = capitalPointTierMilesFor(subMode)
    const tierLabel =
      base > 0
        ? `<${tiers[tiers.length - base]} miles`
        : `>${tiers[tiers.length - 1]} miles`
    const byState = resolveSubMode(subMode).cities?.usStateLines === true
    // `delayMs` schedules the toast's appearance; it then lingers on screen
    // for POINT_TOAST_LIFE_MS (must match the capPointToast animation
    // duration below) before being unmounted.
    const spawn = (text: string, delayMs: number) => {
      window.setTimeout(() => {
        const id = nextPointToastId.current++
        setPointToasts((prev) => [...prev, { id, text }])
        window.setTimeout(
          () => setPointToasts((prev) => prev.filter((t) => t.id !== id)),
          POINT_TOAST_LIFE_MS,
        )
      }, delayMs)
    }
    // A beat before the first toast appears, then staggered in time (not
    // stacked spatially) so later toasts don't appear on top of the still-
    // visible ones before them.
    let delay = POINT_TOAST_START_DELAY_MS
    let extra_delay = POINT_TOAST_LIFE_MS - POINT_TOAST_FADE_MS
    spawn(`${tierLabel}: ${signedPts(base)} points`, delay)
    delay += extra_delay
    if (bonus) {
      spawn(`+1 ${byState ? 'state' : 'country'} bonus`, delay)
      delay += extra_delay
    }
    if (penalty > 0) {
      spawn(`-${penalty} hint`, delay)
    }
  }, [isCapitals, capitalPoints, capitalBonus, capitalHintPenalty, subMode])

  // Prime Web Audio on the first user interaction so end-game sounds reliably
  // play on iOS/Safari (which keeps the audio context suspended until then).
  useEffect(() => installAudioUnlock(), [])

  const handleShareSeed = async () => {
    if (!seed) return
    const url = new URL(window.location.href)
    url.searchParams.set('seed', seed)
    const shareUrl = url.toString()
    try {
      // Prefer the native share sheet on mobile; fall back to clipboard so
      // desktop users still get a working "copy link" affordance.
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'mapoguesser', url: shareUrl })
      } else {
        await navigator.clipboard.writeText(shareUrl)
      }
      setShareLabel('copied')
      window.setTimeout(() => setShareLabel('idle'), 2000)
    } catch {
      // User cancelled the share sheet, or clipboard is blocked.
    }
  }

  // Launch a match from a chosen sub-mode (region). Used by every button in the
  // Countries / Cities sub-menus on the start screen.
  const handleStartSubMode = (sub: SubMode) => {
    setMenuOpen(false)
    setSubmenu(null)
    updateWeightsSub(null)
    closeWeightsItem()
    startGame(undefined, sub.id)
  }
  // Drop ?seed= from the URL so the auto-start effect doesn't immediately
  // re-launch the just-ended match the moment resetGame() flips us to 'idle'.
  const clearSeedFromUrl = () => {
    const url = new URL(window.location.href)
    if (
      url.searchParams.has('seed') ||
      url.searchParams.has('sm') ||
      url.searchParams.has('wc') ||
      url.searchParams.has('cap')
    ) {
      url.searchParams.delete('seed')
      url.searchParams.delete('sm')
      url.searchParams.delete('wc')
      url.searchParams.delete('cap')
      window.history.replaceState(null, '', url.toString())
    }
  }
  const handleMainMenu = () => {
    setMenuOpen(false)
    setSubmenu(null)
    updateWeightsSub(null)
    closeWeightsItem()
    // Back to the unseeded URL + the idle main-menu screen. Without clearing the
    // seed, the auto-start effect would just replay the same match.
    clearSeedFromUrl()
    resetGame()
  }
  // Same "back to the clean main menu" path, but also dismisses the party UI so
  // the join/create screen's Main Menu button drops you all the way out.
  const handleFriendsMainMenu = () => {
    setFriendsOpen(false)
    updateWeightsSub(null)
    closeWeightsItem()
    clearSeedFromUrl()
    resetGame()
  }
  const handleOpenStats = () => {
    clearSeedFromUrl()
    // Wipe the last game's pins/labels so the stats dots aren't drawn on
    // top of leftover correct/wrong markers from the previous round.
    resetGame()
    setStatsOpen(true)
    // Pull a fresh one-time snapshot of the server aggregates. There's no live
    // subscription; this is the only point the global/your stats are fetched.
    fetchStats()
  }
  const handleCloseStats = () => {
    // Drop the transient stats + per-country subscriptions, and clear the dot
    // layer so stale highlights don't linger on the globe.
    selectStatsCountry(null)
    releaseStats()
    setStatsOpen(false)
  }

  return (
    <>
      <Suspense fallback={null}>
        <WorldViewer />
      </Suspense>

      <PartyOverlay
        friendsOpen={friendsOpen}
        onClose={() => setFriendsOpen(false)}
        onMainMenu={handleFriendsMainMenu}
      />

      {showConfetti && (
        <Confetti
          intensity={confettiIntensity}
          onDone={() => setShowConfetti(false)}
        />
      )}
      {showFireworks && <Fireworks onDone={() => setShowFireworks(false)} />}

      {pointToasts.length > 0 && (
        <>
          <style>{`
            @keyframes capPointToast {
              /* Each step re-applies translateX(-50%) alongside the vertical
                 drift — a keyframe's transform replaces the element's whole
                 transform (it doesn't compose with the inline style), so
                 without it the toast loses its horizontal centering the
                 moment the animation starts. Stays fully opaque until the
                 last POINT_TOAST_FADE_MS of POINT_TOAST_LIFE_MS, then fades. */
              0%    { opacity: 0; transform: translateX(-50%) translateY(-6px); }
              15%   { opacity: 1; transform: translateX(-50%) translateY(0); }
              ${(((POINT_TOAST_LIFE_MS - POINT_TOAST_FADE_MS) / POINT_TOAST_LIFE_MS) * 100).toFixed(2)}%
                    { opacity: 1; transform: translateX(-50%) translateY(10px); }
              100%  { opacity: 0; transform: translateX(-50%) translateY(22px); }
            }
          `}</style>
          <div
            style={{
              position: 'absolute',
              top: '40%',
              left: '50%',
              width: 0,
              height: 0,
              pointerEvents: 'none',
              zIndex: 25,
            }}
          >
            {pointToasts.map((t) => (
              <span
                key={t.id}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  transform: 'translateX(-50%)',
                  whiteSpace: 'nowrap',
                  fontFamily: FONT,
                  fontSize: 22,
                  fontWeight: 800,
                  color: COLOR.charcoal,
                  background: COLOR.yellow,
                  border: border(2),
                  borderRadius: 999,
                  padding: '4px 16px',
                  boxShadow: hardShadow(3),
                  animation: `capPointToast ${POINT_TOAST_LIFE_MS}ms ease forwards`,
                }}
              >
                {t.text}
              </span>
            ))}
          </div>
        </>
      )}

      {phase !== 'idle' && !partyUI && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 8,
            pointerEvents: 'auto',
            // Keep the menu above every other overlay (party panels at zIndex 25,
            // toasts at 30) so its buttons are always clickable on top.
            zIndex: 1000,
          }}
        >
          <button
            type="button"
            className="arcade-btn"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              fontSize: 22,
              fontWeight: 700,
              color: COLOR.charcoal,
              background: COLOR.cream,
              border: border(2),
              borderRadius: 12,
              boxShadow: hardShadow(3),
              cursor: 'pointer',
              fontFamily: FONT,
              lineHeight: 1,
              pointerEvents: 'auto',
            }}
          >
            {menuOpen ? '×' : '☰'}
          </button>
          {menuOpen && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {seed && (
                <button
                  type="button"
                  className="arcade-btn"
                  // Don't close the menu — keep it open so the "Copied!"
                  // confirmation is visible after a clipboard copy.
                  onClick={handleShareSeed}
                  style={menuButtonStyle}
                >
                  {shareLabel === 'copied' ? 'Copied!' : 'Share Seed'}
                </button>
              )}
              <button
                type="button"
                className="arcade-btn"
                onClick={handleMainMenu}
                style={{ ...menuButtonStyle, background: COLOR.coral, color: COLOR.cream }}
              >
                Abandon
              </button>
            </div>
          )}
        </div>
      )}

      {/* Capitals lifelines (top-right): usable every round at a points cost,
          always shown as buttons (no submenu). */}
      {isCapitals && phase === 'playing' && !partyUI && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 8,
            pointerEvents: 'auto',
            zIndex: 1000,
          }}
        >
          {(
            [
              { key: 'name', icon: '🏳️', text: 'Name', used: revealName },
              { key: 'flag', icon: '🚩', text: 'Flag', used: revealFlag },
              { key: 'circle', icon: '⭕', text: 'Circle', used: hintCircle !== null },
            ] as const
          ).map((l) => (
            <button
              key={l.key}
              type="button"
              className="arcade-btn"
              disabled={l.used}
              onClick={() => useLifeline(l.key)}
              style={{
                ...menuButtonStyle,
                // Narrow + stacked so a long label wraps down the button
                // instead of stretching it wide into the centre of the map.
                width: 76,
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                lineHeight: 1.15,
                textDecoration: l.used ? 'line-through' : 'none',
                ...(l.used ? disabledLook : {}),
              }}
            >
              <span style={{ fontSize: 20 }}>{l.icon}</span>
              <span>{l.text}</span>
              <span style={{ fontSize: 12, fontWeight: 600 }}>-{HINT_PENALTY[l.key]}</span>
            </button>
          ))}
        </div>
      )}

      {phase !== 'idle' && !partyUI && (
        <div
          style={{
            ...overlayBase,
            ...hudPillStyle,
            // Sit below the 44px hamburger (top:16 → bottom:60) so the centred
            // flag boxes never overlap it on narrow screens.
            top: 64,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            // Cut 40% off the gap between the round/score row and the target
            // title below it (12 → 7).
            gap: 7,
          }}
        >
          {isCapitals ? (
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'baseline',
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              <span>
                Round{' '}
                {phase === 'playing'
                  ? Math.min(distances.length + 1, CAPITAL_ROUNDS)
                  : CAPITAL_ROUNDS}{' '}
                / {CAPITAL_ROUNDS}
              </span>
              <span>Score: {totalCapitalPoints}</span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 4 }}>
              {guessBoxes.map((b, i) => (
                <Checkbox
                  key={i}
                  result={b.result}
                  code={b.code}
                  flagSrc={b.flagSrc}
                  count={guessBoxes.length}
                />
              ))}
            </div>
          )}
          <div
            style={{
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: 0.3,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            {isCapitals ? (
              phase === 'playing' && target ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {/* Only the city is given; the country name + flag are hidden
                      behind the "show country name/flag" lifelines. */}
                  <span style={{ fontSize: 30, fontWeight: 800 }}>
                    {cities[target]?.city ?? '…'}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>
                    {roundGuess
                      ? 'Guess 2 of 2'
                      : 'Guess 1 of 2'}
                  </span>
                  {(revealFlag || revealName) && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 18,
                      }}
                    >
                      {revealFlag && cities[target] && (
                        <FlagIcon
                          code={countryCodes[cities[target].country]}
                          src={cityFlagUrl(cities[target], subMode)}
                          height={45}
                        />
                      )}
                      {revealName && cities[target] && (
                        <span>{cityRevealName(cities[target], subMode)}</span>
                      )}
                    </div>
                  )}
                </div>
              ) : phase === 'finished' ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span>
                    Score: {totalCapitalPoints} / {MAX_CAPITAL_POINTS}
                  </span>
                  {masteredThisMatch > 0 && (
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#1E8E4A' }}>
                      🎓 {masteredLabel(subFamily, masteredThisMatch)}
                    </span>
                  )}
                  {totalCapitalPoints >= MAX_CAPITAL_POINTS && (
                    <span
                      style={{
                        fontSize: 19,
                        fontWeight: 800,
                        color: COLOR.coral,
                        letterSpacing: 0.5,
                      }}
                    >
                      Perfect Score!
                    </span>
                  )}
                </div>
              ) : null
            ) : revealTarget ? (
              <>
                <span style={{ fontWeight: 700 }}>Was:</span>
                <FlagIcon
                  code={subFamily === 'states' ? undefined : countryCodes[revealTarget]}
                  src={subFamily === 'states' ? usStateFlagUrl(revealTarget) : undefined}
                  height={22}
                />
                <span>{revealTarget}</span>
              </>
            ) : phase === 'playing' && target ? (
              <>
                <span style={{ fontWeight: 700 }}>Find:</span>
                <FlagIcon
                  code={subFamily === 'states' ? undefined : countryCodes[target]}
                  src={subFamily === 'states' ? usStateFlagUrl(target) : undefined}
                  height={22}
                />
                <span>{target}</span>
              </>
            ) : phase === 'finished' ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span>
                  Score: {correctCount} / {ROUNDS}
                </span>
                {masteredThisMatch > 0 && (
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1E8E4A' }}>
                    🎓 {masteredLabel(subFamily, masteredThisMatch)}
                  </span>
                )}
                {correctCount >= ROUNDS && (
                  <span
                    style={{
                      fontSize: 19,
                      fontWeight: 800,
                      color: COLOR.coral,
                      letterSpacing: 0.5,
                    }}
                  >
                    {perfectStreak >= 2
                      ? `${perfectStreak}X Perfect Game Streak`
                      : 'Perfect Game!'}
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {!statsOpen && !partyUI && !friendsOpen && (phase === 'idle' || phase === 'finished') && (
        <div
          style={{
            position: 'absolute',
            top: phase === 'finished' ? '62%' : '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          {phase === 'finished' ? (
            // After-game menu: replay the mode just played, or bail to the menu.
            <>
              <button
                type="button"
                className="arcade-btn"
                onClick={() => startGame(undefined, subMode)}
                disabled={!playAgainReady}
                style={{
                  ...buttonStyle(COLOR.yellow),
                  padding: '14px 22px',
                  fontSize: 22,
                  cursor: playAgainReady ? 'pointer' : 'wait',
                  ...(playAgainReady ? {} : disabledLook),
                }}
              >
                Play Again
              </button>
              <button
                type="button"
                className="arcade-btn"
                onClick={handleMainMenu}
                style={menuButtonStyle}
              >
                Main Menu
              </button>
            </>
          ) : weightsSub ? (
            // The item-list panel (below) owns the screen while browsing —
            // hide the region picker underneath it entirely.
            null
          ) : submenu ? (
            // Region picker for the chosen family. Each entry is a data-driven
            // sub-mode (see gameModes.ts); picking one starts that match.
            <>
              <div
                style={{
                  ...pillStyle,
                  fontSize: 18,
                  padding: '8px 20px',
                  marginBottom: 4,
                }}
              >
                {submenu === 'countries'
                  ? '🌍 Countries'
                  : submenu === 'cities'
                    ? '🏙️ Cities'
                    : '🗺️ States'}
              </div>
              {subModesFor(submenu).map((sub) => {
                const subReady =
                  sub.family === 'cities'
                    ? capitalsReady
                    : sub.family === 'states'
                      ? statesReady
                      : ready
                const progress = subReady
                  ? subModeProgress(poolSource, sub)
                  : null
                return (
                  <div key={sub.id} style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="arcade-btn"
                      onClick={() => handleStartSubMode(sub)}
                      disabled={!subReady}
                      style={{
                        ...menuButtonStyle,
                        minWidth: 176,
                        cursor: subReady ? 'pointer' : 'wait',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        ...(subReady ? {} : disabledLook),
                      }}
                    >
                      <span>
                        {subReady ? `${sub.icon} ${sub.label}` : 'Loading…'}
                      </span>
                      {progress && progress.total > 0 && (
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            background: COLOR.yellow,
                            border: border(1.5),
                            borderRadius: 999,
                            padding: '2px 8px',
                          }}
                        >
                          {progress.solved}/{progress.total}
                        </span>
                      )}
                    </button>
                    {/* Opens the full item list (weight + mastery status) for
                        this sub-mode — see the weightsSub panel below. */}
                    <button
                      type="button"
                      className="arcade-btn"
                      aria-label={`View ${sub.label} item list`}
                      title="View item list"
                      onClick={() => {
                        closeWeightsItem()
                        updateWeightsSub(sub)
                      }}
                      disabled={!subReady}
                      style={{
                        ...menuButtonStyle,
                        width: 44,
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: subReady ? 'pointer' : 'wait',
                        ...(subReady ? {} : disabledLook),
                      }}
                    >
                      <HamburgerIcon />
                    </button>
                  </div>
                )
              })}
              <button
                type="button"
                className="arcade-btn"
                onClick={() => {
                  setSubmenu(null)
                  updateWeightsSub(null)
                }}
                style={menuButtonStyle}
              >
                ← Back
              </button>
            </>
          ) : (
            // Idle start screen: top-level family picker.
            <>
              <button
                type="button"
                className="arcade-btn"
                onClick={() => setSubmenu('countries')}
                disabled={!ready}
                style={{
                  ...menuButtonStyle,
                  minWidth: 220,
                  cursor: ready ? 'pointer' : 'wait',
                  ...(ready ? {} : disabledLook),
                }}
              >
                🌍 Countries
              </button>
              <button
                type="button"
                className="arcade-btn"
                onClick={() => setSubmenu('cities')}
                disabled={!capitalsReady}
                style={{
                  ...menuButtonStyle,
                  minWidth: 220,
                  cursor: capitalsReady ? 'pointer' : 'wait',
                  ...(capitalsReady ? {} : disabledLook),
                }}
              >
                🏙️ Cities
              </button>
              <button
                type="button"
                className="arcade-btn"
                onClick={() => setSubmenu('states')}
                disabled={!statesReady}
                style={{
                  ...menuButtonStyle,
                  minWidth: 220,
                  cursor: statesReady ? 'pointer' : 'wait',
                  ...(statesReady ? {} : disabledLook),
                }}
              >
                🗺️ States
              </button>
              <button
                type="button"
                className="arcade-btn"
                onClick={() => {
                  clearSeedFromUrl()
                  resetGame()
                  setFriendsOpen(true)
                }}
                style={{ ...buttonStyle(COLOR.yellow), minWidth: 220 }}
              >
                👥 Play With Friends
              </button>
              <button
                type="button"
                className="arcade-btn"
                onClick={handleOpenStats}
                style={{ ...menuButtonStyle, minWidth: 220 }}
              >
                View Stats
              </button>
            </>
          )}
        </div>
      )}

      {phase !== 'idle' && !partyUI && guess && (
        <div
          style={{
            ...overlayBase,
            ...hudPillStyle,
            padding: '6px 16px',
            // Lifted clear of the bottom footers (the "mapoguesser" label and
            // the map-tile attribution credits).
            bottom: 56,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: 0.3,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontWeight: 700 }}>Guessed:</span>
          <FlagIcon
            code={subFamily === 'states' ? undefined : countryCodes[guess]}
            src={subFamily === 'states' ? usStateFlagUrl(guess) : undefined}
            height={18}
          />
          <span>{guess}</span>
        </div>
      )}

      {!partyUI && (
        <>
          <StateFactsCard marker={lastResolvedStateMarker} seed={seed} />
          <CountryFactsCard
            marker={lastResolvedCountryMarker}
            countryCodes={countryCodes}
            countryPopulations={countryPopulations}
            seed={seed}
          />
          <CityFactsCard
            info={lastCityInfo}
            seed={seed}
            onDismiss={() => clearRoundMarkers(cityRevealEpochRef.current)}
          />
        </>
      )}

      <div
        style={{
          ...overlayBase,
          bottom: 10,
          right: 10,
          fontSize: 20,
          fontWeight: 700,
          color: COLOR.yellow,
          textShadow: `-1px -1px 0 ${COLOR.charcoal}, 1px -1px 0 ${COLOR.charcoal}, -1px 1px 0 ${COLOR.charcoal}, 1px 1px 0 ${COLOR.charcoal}`,
        }}
      >
        {mode === 'capitals' ? (
          // Capitals edition: swap the "o" for a map pin.
          <>
            map<span style={{ fontSize: '0.85em' }}>📍</span>guesser
          </>
        ) : subFamily === 'states' ? (
          // US States edition: swap the "o" for a map.
          <>
            map<span style={{ fontSize: '0.85em' }}>🗺️</span>guesser
          </>
        ) : (
          'mapoguesser'
        )}
      </div>

      {statsOpen && (
        <div
          style={{
            ...panelStyle,
            position: 'absolute',
            top: 16,
            bottom: 16,
            left: 16,
            width: 'min(340px, 92vw)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 14,
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.3 }}>
              {statsMode === 'global' ? 'Global stats' : 'My stats'}
            </div>
            <button
              type="button"
              className="arcade-btn"
              onClick={handleCloseStats}
              style={{ ...buttonStyle(COLOR.coral, COLOR.cream), padding: '6px 10px', fontSize: 14 }}
            >
              Close
            </button>
          </div>
          {typeof selectedStatsCountryId === 'number' ? (
            // A specific country is selected: hide the list and show its
            // detail card instead, with an X that clears the selection (and
            // the flag/dots on the globe) and brings the list back.
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                background: COLOR.cream,
                border: border(2),
                borderRadius: 12,
                padding: 14,
              }}
            >
              <ItemDetailCard
                family="countries"
                item={idToName[selectedStatsCountryId] ?? ''}
                cities={cities}
                countryCodes={countryCodes}
                countryPopulations={countryPopulations}
                subModeId={subMode}
                onClose={() => selectStatsCountry(null)}
              />
            </div>
          ) : (
            <>
          {/* Segmented My / Global toggle, with a single sort-toggle icon to its
              right. Switching mode wipes the current selection (handled in
              setStatsMode) so dots from one dataset don't linger. */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            <div
              style={{
                display: 'flex',
                flex: 1,
                gap: 0,
                border: border(2),
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              {(['mine', 'global'] as const).map((mode) => {
                const active = statsMode === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      if (statsMode !== mode) setStatsMode(mode)
                    }}
                    style={{
                      flex: 1,
                      padding: '8px 0',
                      fontSize: 14,
                      fontWeight: 700,
                      letterSpacing: 0.3,
                      color: COLOR.charcoal,
                      background: active ? COLOR.yellow : COLOR.cream,
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {mode === 'mine' ? 'My stats' : 'Global stats'}
                  </button>
                )
              })}
            </div>
            {/* Sort toggle: shows "AZ" when sorting by name, a funnel when
                sorting by net hit−miss sum. Tapping flips between them. */}
            <button
              type="button"
              className="arcade-btn"
              aria-label={
                statsSort === 'name'
                  ? 'Sorted by name — tap to sort by hit − miss'
                  : 'Sorted by hit − miss — tap to sort by name'
              }
              title={
                statsSort === 'name' ? 'Sort by hit − miss' : 'Sort by name'
              }
              onClick={() =>
                setStatsSort((s) => (s === 'name' ? 'sum' : 'name'))
              }
              style={{
                ...buttonStyle(COLOR.cream),
                width: 44,
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                letterSpacing: 0.5,
              }}
            >
              {statsSort === 'name' ? (
                'AZ'
              ) : (
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
              )}
            </button>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              background: COLOR.cream,
              border: border(2),
              borderRadius: 12,
            }}
          >
            {statsRows.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: 'center',
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                {statsMode === 'global'
                  ? 'No global guesses yet — or still connecting.'
                  : 'No guesses yet — play a round to start filling this in.'}
              </div>
            ) : (
              <>
                {(() => {
                  const active = selectedStatsCountryId === 'all'
                  return (
                    <button
                      type="button"
                      onClick={() =>
                        selectStatsCountry(active ? null : 'all')
                      }
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        width: '100%',
                        background: active ? COLOR.yellow : 'transparent',
                        border: 'none',
                        borderBottom: border(2),
                        color: COLOR.charcoal,
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          fontSize: 15,
                          fontWeight: 700,
                          letterSpacing: 0.3,
                        }}
                      >
                        All ({statsTotals.total})
                      </span>
                      <span
                        style={{
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: 700,
                          fontSize: 15,
                          color: '#1E8E4A',
                        }}
                      >
                        {statsTotals.correct}
                      </span>
                      <span style={{ fontWeight: 700 }}>/</span>
                      <span
                        style={{
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: 700,
                          fontSize: 15,
                          color: COLOR.coral,
                        }}
                      >
                        {statsTotals.wrong}
                      </span>
                    </button>
                  )
                })()}
                {statsRows.map((row) => {
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => selectStatsCountry(row.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid rgba(30,32,34,0.15)',
                      color: COLOR.charcoal,
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                    }}
                  >
                    <FlagIcon code={row.code} height={20} />
                    <span style={{ flex: 1, fontSize: 15 }}>{row.name}</span>
                    <span
                      style={{
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 700,
                        fontSize: 16,
                        color: scoreColour(row.sum),
                        minWidth: 32,
                        textAlign: 'right',
                      }}
                    >
                      {row.sum > 0 ? `+${row.sum}` : row.sum}
                    </span>
                  </button>
                )
                })}
              </>
            )}
          </div>
            </>
          )}
        </div>
      )}

      {weightsSub && (
        <div
          style={{
            ...panelStyle,
            position: 'absolute',
            top: 16,
            bottom: 16,
            right: 16,
            width: 'min(340px, 92vw)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 14,
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.3 }}>
              {weightsSub.icon} {weightsSub.label}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {/* Toggles between alphabetical and worst-mastery-first, mirroring
                  the My Stats sort button (AZ text / funnel icon). */}
              <button
                type="button"
                className="arcade-btn"
                aria-label={
                  weightsSort === 'name'
                    ? 'Sorted by name — tap to sort by mastery'
                    : 'Sorted by mastery — tap to sort by name'
                }
                title={
                  weightsSort === 'name' ? 'Sort by mastery' : 'Sort by name'
                }
                onClick={() =>
                  setWeightsSort((s) => (s === 'name' ? 'mastery' : 'name'))
                }
                style={{
                  ...buttonStyle(COLOR.cream),
                  width: 44,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  letterSpacing: 0.5,
                }}
              >
                {weightsSort === 'name' ? (
                  'AZ'
                ) : (
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className="arcade-btn"
                onClick={() => {
                  closeWeightsItem()
                  updateWeightsSub(null)
                }}
                style={{ ...buttonStyle(COLOR.coral, COLOR.cream), padding: '6px 10px', fontSize: 14 }}
              >
                Close
              </button>
            </div>
          </div>
          {weightsItem && weightsSub ? (
            // A row was picked: hide the list and show its detail card. The
            // card's own X (onClose) clears weightsItem, bringing the list
            // (and the flag on the globe) back.
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                background: COLOR.cream,
                border: border(2),
                borderRadius: 12,
                padding: 14,
              }}
            >
              <ItemDetailCard
                family={weightsSub.family}
                item={weightsItem}
                cities={cities}
                countryCodes={countryCodes}
                countryPopulations={countryPopulations}
                subModeId={weightsSub.id}
                onClose={closeWeightsItem}
              />
            </div>
          ) : (
            <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '4px 12px',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <StatusDot status="solved" /> Mastered
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <StatusDot status="under" /> Improving
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <StatusDot status="exact" /> New
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <StatusDot status="over" /> Struggling
            </span>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              background: COLOR.cream,
              border: border(2),
              borderRadius: 12,
            }}
          >
            {weightsRows.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: 'center',
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                No items in this pool yet.
              </div>
            ) : (
              weightsRows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => {
                    if (!weightsSub) return
                    setWeightsItem(row.key)
                    setBrowseTarget({ family: weightsSub.family, item: row.key })
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid rgba(30,32,34,0.15)',
                    color: COLOR.charcoal,
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                  }}
                >
                  <StatusDot status={row.status} />
                  {(row.flagCode || row.flagSrc) && (
                    <FlagIcon code={row.flagCode} src={row.flagSrc} height={18} />
                  )}
                  <span style={{ flex: 1, fontSize: 14 }}>{row.label}</span>
                  <span
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 700,
                      fontSize: 13,
                      minWidth: 44,
                      textAlign: 'right',
                    }}
                  >
                    {row.percent}%
                  </span>
                </button>
              ))
            )}
          </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
