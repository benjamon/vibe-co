import { create } from 'zustand'
import { sfxCorrect, sfxWrong, sfxAchievement } from './sfx'
import {
  getAccountId,
  pullProgress,
  pushProgress,
  generateLoginCode as accountGenerateLoginCode,
  redeemLoginCode as accountRedeemLoginCode,
} from './account'
import {
  submitGuess as submitPartyGuess,
  sendLifeline as sendPartyLifeline,
  type PartyPhase,
} from './party'
import {
  resolveSubMode,
  behavioralModeOf,
  type SubMode,
  type ModeFamily,
} from './gameModes'
import { usStateFlagUrl } from './usStateFlags'

export type AttemptResult = 'pending' | 'correct' | 'wrong'
export type GamePhase = 'idle' | 'playing' | 'finished'
// Which country pool the match draws from. 'classic' = every playable country
// (or a named regional subset — see gameModes.ts); 'capitals' = guess the
// capital city of a country, scored golf-style by distance (URL `cap=1`).
export type GameMode = 'classic' | 'capitals' | 'draw'

// A city and its coordinates. Populated by WorldViewer from the Natural Earth
// populated-places dataset (50m ≈ 1250 cities with population). Drives the
// 'capitals' (cities) mode draw pool and its distance scoring. Keyed in the
// store by the city's Natural Earth ne_id, so multiple cities per country and
// duplicate names across countries all stay distinct.
export interface CityInfo {
  city: string
  // The Natural Earth country NAME this city sits in, for the reveal flag +
  // label and for the region filters in the city sub-modes.
  country: string
  // Admin-1 name (US state / province), when the dataset carries one. Shown in
  // place of the country when revealing US cities in a state-lines mode.
  region?: string
  lat: number
  lon: number
  // Max metro population (Natural Earth pop_max). Drives the "largest cities"
  // ordering for the regional city sub-modes.
  pop: number
  // Whether this is the country's national capital (Natural Earth adm0cap).
  // The "World Capitals" sub-mode draws only from these.
  capital: boolean
  // Whether this is an admin-1 (US state / province) capital — Natural Earth's
  // 'Admin-1 capital' featurecla. Lets a region mode fold in every state capital
  // regardless of population (Montpelier, Pierre, Juneau, …).
  stateCapital: boolean
}
// Sprite kind drawn at the marker location: green pin for a correct guess,
// grey pin for the wrong country the player clicked, red X for the centroid
// reveal of a missed target. City modes drop small dots for their guesses
// instead of flag pins: 'guess' is a grey dot, 'guess-best' the yellow dot for
// the guess that actually scored (the closer of the two).
export type MarkerKind =
  | 'correct'
  | 'wrong'
  | 'reveal'
  | 'guess'
  | 'guess-best'
export interface Marker {
  lat: number
  lon: number
  kind: MarkerKind
  label: string
  // Optional explicit ISO 3166-1 alpha-2 flag code. When absent the renderer
  // derives the code from `label` (a country name). Capitals-mode reveal markers
  // set this so the pin shows the country's flag while `label` reads
  // "City,\nCountry" (which isn't a country name and wouldn't resolve on its own).
  code?: string
  // Explicit flag image URL, taking precedence over `code`. Used for US state
  // flags (see cityFlagUrl), which aren't ISO country codes.
  flagUrl?: string
  // Countries mode only: on a 'wrong' marker, the great-circle miss distance
  // (to the target's centroid — an approximation of "how far off"), shown as
  // a second label line above the pin. Undefined for every other marker kind.
  distanceMi?: number
}

export const ROUNDS = 9
export const WRONG_GUESSES_BEFORE_REVEAL = 2
// Timed Mode (Settings menu): how long a single-player round has before it
// auto-misses — see handleTimeout/handleCapitalTimeout. One window per
// round, not per guess (App.tsx's timer effect keys off `target`, which
// stays the same across capitals mode's two attempts on one city). Padded
// by FIRST_MISS_LOCK_MS so the post-first-miss input lock below doesn't eat
// into a timed round's thinking time.
export const TIMED_ROUND_MS = 10000 + 500
// Capitals mode is shorter and scored golf-style: 5 capitals, two guesses each
// (the closer guess scores). Kept separate from ROUNDS, which is the guess
// budget for classic.
export const CAPITAL_ROUNDS = 5
export const CAPITAL_GUESSES_PER_ROUND = 2
// Draw mode: freehand-trace a country's border from memory, scored by %
// overlap with the real shape. Shorter than classic — each round takes
// longer (a whole drawing gesture vs. a single click).
export const DRAW_ROUNDS = 5
// A city-mode guess scores its great-circle miss in miles (lower is better).
// Used as the miss penalty for a round a player never answers (multiplayer
// only) — a skipped round costs exactly this many miles, no cap on an actual
// guess (see `handleCapitalGuess`, which reports the true distance).
export const MAX_CAPITAL_MILES = 1000
// A city guess within this many miles counts as a "near" hit (green sfx).
const CAPITAL_NEAR_MI = 50

// City-mode point tiers — closer guesses score more. Two scales: the US
// regional mode covers a much smaller area than the rest of the world, so its
// tiers are tighter; every other city sub-mode (World Capitals, Latin
// America, Europe) shares the wider world scale. Exported so WorldViewer can
// draw a matching concentric ring at each radius around the target when the
// round's answer is revealed. Plus a bonus point when the scoring guess lands
// in the target's actual country (or, in the US state-lines sub-mode, its
// actual state). Max 6 pts/round × CAPITAL_ROUNDS = 30 — the perfect score
// that triggers the win-screen fireworks.
export const US_CAPITAL_POINT_TIER_MILES = [20, 50, 100, 200, 350]
export const WORLD_CAPITAL_POINT_TIER_MILES = [30, 100, 300, 500, 1000]
export const capitalPointTierMilesFor = (subMode: string): number[] =>
  resolveSubMode(subMode).cities?.usStateLines === true
    ? US_CAPITAL_POINT_TIER_MILES
    : WORLD_CAPITAL_POINT_TIER_MILES
const pointsForDistance = (mi: number, tiers: number[]): number => {
  for (let i = 0; i < tiers.length; i++) {
    if (mi <= tiers[i]) return tiers.length - i
  }
  return 0
}
const REGION_BONUS_POINTS = 1
export const MAX_CAPITAL_POINTS = CAPITAL_ROUNDS * (5 + REGION_BONUS_POINTS)

// After the target changes, guess input is ignored for this long so a click
// queued/double-fired for the previous target doesn't land on the new one.
export const GUESS_LOCK_MS = 1000
const lockUntil = (ms: number = GUESS_LOCK_MS): number => Date.now() + ms

// After a first missed guess (still same target, one retry left), input is
// briefly ignored too — otherwise a fast double-tap/click meant as a single
// guess registers as two straight misses and burns the reveal early.
const FIRST_MISS_LOCK_MS = 500

// How many rounds a given mode runs for. Must match the server's roundsForMode
// so single-player and party matches agree on when the match ends. ('draw' is
// single-player only — see gameModes.ts — so it has no server-side match.)
export const roundsForMode = (mode: GameMode): number =>
  mode === 'capitals' ? CAPITAL_ROUNDS : mode === 'draw' ? DRAW_ROUNDS : ROUNDS

// Single-slot save: a returning player can resume one in-progress match.
// Starting a different seed overwrites it.
const SAVE_KEY = 'mapoguesser:save'
// Count of consecutive perfect (9/9) games. Persisted so the streak survives
// reloads; reset to 0 the moment a match ends with any miss.
const PERFECT_STREAK_KEY = 'mapoguesser:perfectStreak'
// Per-item adaptive-difficulty weights (single-player draw only — see
// `drawWeightedUniqueTargets`). Keyed by `${family}:${itemId}` so the same
// entity (e.g. "France") shares one weight across every sub-mode it appears in
// (All, Europe, Asia, …), while cities/states get their own namespace. This is
// "the user's progress" that account.ts syncs across devices.
const ITEM_WEIGHTS_KEY = 'mapoguesser:itemWeights'
// When itemWeights was last changed locally (epoch ms) — compared against the
// server's `progress.updated_at` on load to decide which copy is newer. See
// syncProgressOnLoad.
const ITEM_WEIGHTS_UPDATED_KEY = 'mapoguesser:itemWeightsUpdatedAt'
// Settings-menu preference: whether the "All" countries pool excludes tiny
// island nations / city-states. See MIN_TARGET_AREA / poolForSubMode.
const HIDE_TINY_ISLANDS_KEY = 'mapoguesser:hideTinyIslands'
// Settings-menu preference: Timed Mode — see TIMED_ROUND_MS / handleTimeout /
// handleCapitalTimeout.
const TIMED_MODE_KEY = 'mapoguesser:timedMode'
// Settings-menu preference: which basemap WorldViewer renders — a satellite
// photo layer or the labelled-and-stripped OpenStreetMap vector style. See
// WorldViewer's styleFor().
const MAP_STYLE_KEY = 'mapoguesser:mapStyle'
export type MapStyleChoice = 'osm' | 'satellite' | 'toner' | 'desert'

// Adaptive-difficulty weight for one item (country/state/city). `weight` is
// the draw multiplier (1.0 = default likelihood); `streak` is the player's
// current run of consecutive correct rounds on this item (first OR second
// attempt), used only to detect the "3-in-a-row" mastery rule.
export interface WeightEntry {
  weight: number
  streak: number
  // Epoch ms this item was last guessed (any outcome). Drives the
  // least-recently-shown guarantee in `buildRoundTargets` — once every item
  // in a pool has been guessed at least once, the round with the oldest
  // `lastGuessed` is forced back into rotation even if it's since been
  // mastered down to a near-zero draw weight. Absent for entries created
  // before this field existed.
  lastGuessed?: number
}
export type ItemWeights = Record<string, WeightEntry>

// An item selected for "browsing" from the item-list panel — see
// GameState.browseTarget. `item` is a country/state name for those families,
// or a city dataset key (matching poolForSubMode's cities-family output) for
// the cities family.
export interface BrowseTarget {
  family: ModeFamily
  item: string
}

export const DEFAULT_ITEM_WEIGHT = 1
export const MIN_ITEM_WEIGHT = 0.1
const MAX_ITEM_WEIGHT = 20
const MASTERY_STREAK = 3

// Namespaces a per-family item id so "France" (a country) and a same-named
// city/state never collide in the weight map.
export const itemWeightKey = (family: ModeFamily, item: string): string =>
  `${family}:${item}`

const clampWeight = (w: number): number =>
  Math.min(MAX_ITEM_WEIGHT, Math.max(MIN_ITEM_WEIGHT, w))

// How a completed round on one item affects its future draw weight:
//   'first' → answered correctly on the FIRST attempt (halve the weight; for
//             the golf-scored cities mode, "correct" means the first pin
//             landed within the top two score tiers, i.e. <=50 mi).
//   'second' → only correct on the second attempt (weight unchanged).
//   'miss'   → never answered correctly (double the weight, or reset to the
//              original 1.0, whichever is greater).
// Any correct outcome (first or second) extends the mastery streak; three in
// a row immediately floors the weight to the minimum. A miss breaks the
// streak and can undo mastery — floored weight (0.1) doubles to 0.2, which is
// still less than the original 1.0, so `Math.max` snaps it back up to 1.0
// rather than leaving it barely above the floor.
export type WeightOutcome = 'first' | 'second' | 'miss'

const nextWeightEntry = (
  entry: WeightEntry | undefined,
  outcome: WeightOutcome,
  now: number = Date.now(),
): WeightEntry => {
  const weight = entry?.weight ?? DEFAULT_ITEM_WEIGHT
  if (outcome === 'miss') {
    return {
      weight: clampWeight(Math.max(weight * 2, DEFAULT_ITEM_WEIGHT)),
      streak: 0,
      lastGuessed: now,
    }
  }
  const streak = (entry?.streak ?? 0) + 1
  if (streak >= MASTERY_STREAK)
    return { weight: MIN_ITEM_WEIGHT, streak, lastGuessed: now }
  if (outcome === 'first')
    return { weight: clampWeight(weight * 0.5), streak, lastGuessed: now }
  return { weight, streak, lastGuessed: now }
}

// Whether a weight update just crossed into "mastered" (floored to
// MIN_ITEM_WEIGHT) for the first time — i.e. it wasn't already there. Drives
// GameState.masteredThisMatch, the end-of-match "N mastered" message.
const isNewlyMastered = (prevWeight: number, nextWeight: number): boolean =>
  prevWeight > MIN_ITEM_WEIGHT && nextWeight <= MIN_ITEM_WEIGHT

interface SavedMatch {
  seed: string
  // Which pool the saved draw came from. A seed alone isn't enough to resume —
  // the same seed yields a different draw per mode — so the resume check below
  // requires both to match. Optional for legacy saves (default 'classic').
  mode?: GameMode
  // Which sub-mode (region) the draw came from. Like `mode`, the same seed draws
  // a different sequence per sub-mode, so resume requires it to match. Optional
  // for legacy saves (default resolves from `mode`).
  subMode?: string
  // The drawn target sequence itself. Since the single-player draw is now
  // weighted by the player's live item-performance history (see
  // `drawWeightedUniqueTargets`), it's no longer safe to *recompute* the draw
  // from seed+pool on resume — weights may have shifted mid-match (the
  // rounds already played bump their own items' weights). Optional so legacy
  // saves without it fall back to the old recompute-from-seed behaviour.
  targets?: string[]
  // Per-guess log (one entry per click), NOT one per country. See GameState.
  attempts: AttemptResult[]
  // Parallel to `attempts` (classic mode only): true at index i iff that
  // guess was the one that pushed its target's mastery streak to the floor
  // (see isNewlyMastered) — drives the stamp badge on that guess's flag box.
  // Optional so legacy saves without it just show no badges on resume.
  masteredOnAttempt?: boolean[]
  // How far through the 9-country sequence we are (advances on a correct guess
  // or the second consecutive miss). Drives which country is served.
  targetIndex: number
  consecutiveWrong: number
  markers: Marker[]
  // Capitals mode only: the great-circle miles for each completed round, in
  // order. Absent for classic saves (which score by `attempts`).
  distances?: number[]
  // Capitals mode only: the points scored for each completed round (see
  // `pointsForDistance` + the region bonus), parallel to `distances`.
  capitalPoints?: number[]
  // Capitals mode only: whether each completed round's score included the
  // region bonus, parallel to `distances`/`capitalPoints` — lets the UI show
  // the bonus as its own "+1 country/state bonus" toast.
  capitalBonus?: boolean[]
  // Capitals mode only: total lifeline point cost for each completed round
  // (see HINT_PENALTY), parallel to `distances`/`capitalPoints` — lets the UI
  // show it as its own "-N hint" toast.
  capitalHintPenalty?: number[]
  // Capitals mode only: the in-progress first guess of the current capital (the
  // player has one guess left), or null/absent when between rounds.
  roundGuess?: RoundGuess | null
  // Count of items freshly mastered (weight dropped to MIN_ITEM_WEIGHT) so far
  // this match — see GameState.masteredThisMatch. Optional so legacy saves
  // without it just resume at 0.
  masteredThisMatch?: number
  // Draw mode only: the % overlap score for each completed round.
  drawScores?: number[]
  // Draw mode only: which target's post-match reveal is showing, if any —
  // see GameState.drawRevealIndex. A resumed reveal loses its fill overlay
  // (WorldViewer doesn't persist raw stroke geometry) but still shows the
  // real border and re-arms the hold timer.
  drawRevealIndex?: number | null
}

const isSavedMatch = (v: unknown): v is SavedMatch => {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.seed === 'string' &&
    Array.isArray(o.attempts) &&
    typeof o.targetIndex === 'number' &&
    typeof o.consecutiveWrong === 'number' &&
    Array.isArray(o.markers)
  )
}

const loadSave = (): SavedMatch | null => {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isSavedMatch(parsed) ? parsed : null
  } catch {
    return null
  }
}

const writeSave = (data: SavedMatch): void => {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data))
  } catch {
    // quota exceeded / private browsing — silent skip
  }
}

// Shared by loadItemWeights (localStorage) and the cross-device sync path
// (account.ts's pulled JSON blob) — both hand this raw JSON text.
const parseItemWeightsJSON = (raw: string): ItemWeights | null => {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const out: ItemWeights = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      if (typeof o.weight !== 'number' || !Number.isFinite(o.weight)) continue
      if (typeof o.streak !== 'number' || !Number.isFinite(o.streak)) continue
      const lastGuessed =
        typeof o.lastGuessed === 'number' && Number.isFinite(o.lastGuessed)
          ? o.lastGuessed
          : undefined
      out[k] = {
        weight: clampWeight(o.weight),
        streak: Math.max(0, o.streak),
        ...(lastGuessed !== undefined ? { lastGuessed } : {}),
      }
    }
    return out
  } catch {
    return null
  }
}

const loadItemWeights = (): ItemWeights => {
  if (typeof localStorage === 'undefined') return {}
  const raw = localStorage.getItem(ITEM_WEIGHTS_KEY)
  if (!raw) return {}
  return parseItemWeightsJSON(raw) ?? {}
}

const loadItemWeightsUpdatedAt = (): number => {
  if (typeof localStorage === 'undefined') return 0
  try {
    const raw = localStorage.getItem(ITEM_WEIGHTS_UPDATED_KEY)
    const n = raw ? Number(raw) : 0
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

const writeJSON = (key: string, data: unknown): void => {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // quota exceeded / private browsing — silent skip
  }
}

const loadPerfectStreak = (): number => {
  if (typeof localStorage === 'undefined') return 0
  try {
    const raw = localStorage.getItem(PERFECT_STREAK_KEY)
    if (!raw) return 0
    const n = Number(JSON.parse(raw))
    return Number.isInteger(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

const loadHideTinyIslands = (): boolean => {
  if (typeof localStorage === 'undefined') return true
  try {
    const raw = localStorage.getItem(HIDE_TINY_ISLANDS_KEY)
    return raw === null ? true : JSON.parse(raw) === true
  } catch {
    return true
  }
}

const loadTimedMode = (): boolean => {
  if (typeof localStorage === 'undefined') return false
  try {
    const raw = localStorage.getItem(TIMED_MODE_KEY)
    return raw === null ? false : JSON.parse(raw) === true
  } catch {
    return false
  }
}

const MAP_STYLE_CHOICES: MapStyleChoice[] = ['osm', 'satellite', 'toner', 'desert']

const loadMapStyle = (): MapStyleChoice => {
  if (typeof localStorage === 'undefined') return 'satellite'
  try {
    const raw = localStorage.getItem(MAP_STYLE_KEY)
    if (raw === null) return 'satellite'
    // writeJSON always JSON-encodes, so a stored 'osm' round-trips as the
    // 5-character string `"osm"`, not the bare word.
    const parsed = JSON.parse(raw)
    return MAP_STYLE_CHOICES.includes(parsed) ? parsed : 'satellite'
  } catch {
    return 'satellite'
  }
}

// Given a finished match's per-guess log, return the next perfect-game streak:
// +1 on a flawless run, reset to 0 otherwise. A perfect run is exactly ROUNDS
// guesses that are all correct — any miss adds an extra 'wrong' entry, pushing
// the length past ROUNDS, so the equality check rules it out.
const nextPerfectStreak = (
  attempts: AttemptResult[],
  current: number,
): number => {
  const correct = attempts.filter((a) => a === 'correct').length
  return correct === ROUNDS && attempts.length === ROUNDS ? current + 1 : 0
}

interface GameState {
  heading: number
  setHeading: (heading: number) => void

  // Available country names, populated by WorldViewer once Natural Earth
  // GeoJSON has loaded. The Start button stays disabled until non-empty.
  countries: string[]
  setCountries: (countries: string[]) => void

  // US state names, populated by WorldViewer once the states polygon GeoJSON
  // loads. Drives the 'states' family draw pool.
  states: string[]
  setStates: (states: string[]) => void

  // ne_id → city. Populated by WorldViewer once the populated-places GeoJSON
  // loads. Drives the cities-mode ('capitals' behaviour) draw pool + scoring:
  // World Capitals draws the `capital` ones, regional modes the largest by
  // `pop` within a set of countries.
  cities: Record<string, CityInfo>
  setCities: (cities: Record<string, CityInfo>) => void

  // Name → ISO 3166-1 alpha-2 code (lowercase). Populated alongside countries.
  // Drives the flag icons in the HUD. Countries without a valid ISO_A2 in the
  // Natural Earth dataset are simply absent (the HUD then omits the flag).
  countryCodes: Record<string, string>
  setCountryCodes: (codes: Record<string, string>) => void

  // Name → Natural Earth's POP_EST (population estimate). Populated alongside
  // countries; drives the Countries mode's after-guess facts card.
  countryPopulations: Record<string, number>
  setCountryPopulations: (pops: Record<string, number>) => void

  // Name → total polygon area (deg²). Populated alongside countries; used
  // only to let the "All" pool optionally exclude tiny island nations /
  // city-states when hideTinyIslands is on — see poolForSubMode.
  countryAreas: Record<string, number>
  setCountryAreas: (areas: Record<string, number>) => void

  // Name → polygon centroid. Populated alongside countries; used only to
  // pick Draw mode's 5-country cluster (see pickAdjacentCluster) — the
  // curated DRAW_SUBMODES pool doesn't carry geographic position otherwise.
  countryCentroids: Record<string, { lat: number; lon: number }>
  setCountryCentroids: (centroids: Record<string, { lat: number; lon: number }>) => void

  // Same idea as countryCentroids, but for US states — feeds the "Draw a US
  // State" mode's (family 'draw-states') cluster pick.
  stateCentroids: Record<string, { lat: number; lon: number }>
  setStateCentroids: (centroids: Record<string, { lat: number; lon: number }>) => void

  // Settings-menu preference: when true, the "All" countries pool excludes
  // countries below MIN_TARGET_AREA (Vatican, Monaco, Tuvalu, Nauru, …).
  // Persisted; defaults to true (exclude them).
  hideTinyIslands: boolean
  setHideTinyIslands: (hide: boolean) => void

  // Settings-menu preference: when true, single-player Countries/States/
  // Capitals rounds auto-miss after TIMED_ROUND_MS of not being solved (see
  // handleTimeout / handleCapitalTimeout) — a fresh window per round, not per
  // guess (capitals mode's two attempts share the one window). Doesn't apply
  // to Draw mode or multiplayer. Persisted; defaults to false.
  timedMode: boolean
  setTimedMode: (timed: boolean) => void

  // Settings-menu preference: which basemap WorldViewer renders (see
  // MapStyleChoice). Persisted; defaults to 'osm'.
  mapStyle: MapStyleChoice
  setMapStyle: (style: MapStyleChoice) => void

  // Adaptive-difficulty draw weight per item, keyed by `itemWeightKey(family,
  // item)`. Persisted independently of the match save, grown over time by
  // single-player-only guesses (see `handleGlobeClick` / `handleCapitalGuess`).
  // Drives `drawWeightedUniqueTargets` in `startGame` and the per-mode "solved"
  // counts (`subModeProgress`) — this is "the user's progress" that gets
  // synced across devices (see account.ts / syncProgressOnLoad).
  itemWeights: ItemWeights
  // Internal: epoch ms this device last changed itemWeights locally. Not for
  // UI use — see ITEM_WEIGHTS_UPDATED_KEY / syncProgressOnLoad.
  itemWeightsUpdatedAt: number

  // Count of items whose adaptive-difficulty weight dropped to MIN_ITEM_WEIGHT
  // (freshly mastered) so far in the current single-player match — reset by
  // `startGame`, bumped by `handleGlobeClick`/`handleCapitalGuess` whenever a
  // correct guess pushes an item's weight into the mastered floor for the
  // first time. Drives the "N countries/cities/states mastered" end-of-match
  // message. Never incremented for multiplayer (party guesses don't touch
  // itemWeights at all).
  masteredThisMatch: number

  // The item currently being "browsed" from the item-list panel (see
  // App.tsx's weightsSub UI) — drives WorldViewer's fly-to + flag-pin so the
  // player can see where it is on the globe, and the detail card shown in
  // place of the list. null = nothing being browsed.
  browseTarget: BrowseTarget | null
  setBrowseTarget: (t: BrowseTarget | null) => void

  // The sub-mode id of whichever item-list panel is currently open (see
  // App.tsx's weightsSub), or null when it's closed. While open, this
  // overrides `subMode` for deciding whether WorldViewer shows the US state
  // boundary lines — e.g. opening the US States or United States (cities)
  // item list shows them even though no match of that sub-mode is running.
  browseSubModeId: string | null
  setBrowseSubMode: (id: string | null) => void

  // Cross-device progress sync (see account.ts). Generates a short-lived
  // pairing code for this device's account, or null if offline/failed.
  generateLoginCode: () => Promise<string | null>
  // Redeems a code generated on another device: adopts that device's account
  // id and pulls (and applies) its itemWeights progress.
  redeemLoginCode: (code: string) => Promise<'ok' | 'not-found' | 'expired' | 'offline'>

  // Last country clicked on the globe (whichever phase we're in).
  country: string | null
  setCountry: (country: string | null) => void

  // Consecutive perfect (9/9) games, persisted. Incremented when a match ends
  // flawless, reset to 0 on any miss. Drives the win-screen streak banner.
  perfectStreak: number

  // Game flow.
  phase: GamePhase
  // The behavioural mode of the active match: 'classic' guesses the
  // country, 'capitals' guesses the city. Derived from the sub-mode; drives
  // round count, scoring, HUD, and the map-corner label.
  mode: GameMode
  // The selected sub-mode id (region). This is the real selector — it fixes both
  // the behaviour (`mode`) and the draw pool. Mirrored to the URL as `sm=<id>`
  // so a shared link reproduces the same match.
  subMode: string
  // Match seed (base36, 6 chars). Drives the deterministic target draw and is
  // mirrored to the URL so a link reproduces the same match.
  seed: string | null
  // The full draw of ROUNDS unique countries for this match, in order. This is
  // the source of truth for what's served next — independent of the guess log.
  targets: string[]
  // Pointer into `targets`: the index of the country currently being asked.
  // Advances by one on a correct guess or the second consecutive miss, so each
  // country is served at most once, in order. Because the match is capped at
  // ROUNDS *guesses* (not countries), a miss spends a guess without reaching a
  // later country — so targetIndex can finish below ROUNDS.
  targetIndex: number
  target: string | null
  // Per-GUESS result log (one entry per click, in order) — the player's fixed
  // budget is ROUNDS guesses total, so this never exceeds ROUNDS and the match
  // ends when it fills. A country missed twice contributes two 'wrong' entries;
  // a country guessed right first try contributes one 'correct'. Drives the HUD
  // flag boxes (which pad to ROUNDS with pending boxes for unused guesses); it
  // never contains 'pending'.
  attempts: AttemptResult[]
  // Parallel to `attempts` (classic mode only, always [] elsewhere): true at
  // index i iff that guess just floored its target's mastery weight (see
  // isNewlyMastered) — drives the flag box's stamp badge in the HUD.
  masteredOnAttempt: boolean[]
  // Capitals mode only: the great-circle miles for each completed round, in
  // order (uncapped — a wild guess shows its true miss distance). Empty in
  // classic mode (which scores by `attempts`).
  distances: number[]
  // Capitals mode only: the points scored for each completed round, parallel
  // to `distances` (see `pointsForDistance` + the region bonus). The total
  // (sum) is the match score, out of `MAX_CAPITAL_POINTS` — higher is better,
  // and a perfect run triggers the win-screen fireworks.
  capitalPoints: number[]
  // Capitals mode only: whether each completed round's score included the
  // region bonus, parallel to `capitalPoints`.
  capitalBonus: boolean[]
  // Capitals mode only: total lifeline point cost deducted from each
  // completed round's score, parallel to `capitalPoints` (see HINT_PENALTY).
  capitalHintPenalty: number[]

  // Draw mode only: the % overlap between the player's freehand shapes and
  // the real country, one per round — appended as each of the DRAW_ROUNDS
  // targets is submitted, all of them *before* any reveal is shown (see
  // drawRevealIndex). Purely a per-match score — not persisted beyond the
  // current match's save, not fed into itemWeights.
  drawScores: number[]
  // Draw mode only: which of the DRAW_ROUNDS targets (by index into
  // `targets`/`drawScores`) the post-match reveal sequence is currently
  // showing, or null while still drawing (or once the sequence has finished
  // and the match is over). Set to 0 the moment the 5th shape is submitted;
  // WorldViewer steps it forward once each reveal has been shown a while
  // (advanceDrawRound), walking through all 5 in the same order they were
  // drawn before finally finishing the match.
  drawRevealIndex: number | null
  submitDrawGuess: (percent: number) => void
  advanceDrawRound: () => void

  // Draw mode only: how many shapes the player has committed so far this
  // round (before hitting Submit) — mirrored from WorldViewer's local shape
  // list (which owns the actual stroke geometry) purely so the Submit/Undo
  // buttons (App.tsx) know when they're usable. Reset to 0 whenever a round
  // starts.
  drawShapeCount: number
  setDrawShapeCount: (n: number) => void
  // Bumped by the Submit/Undo buttons; WorldViewer diffs these nonces to
  // trigger the actual submit/undo, since it — not the store — owns the
  // drawn shapes' geometry and rendering.
  drawSubmitNonce: number
  requestDrawSubmit: () => void
  drawUndoNonce: number
  requestDrawUndo: () => void

  // Capitals lifelines, usable every round at a points cost (see
  // HINT_PENALTY). `revealName`/`revealFlag` show the hidden country
  // name/flag for the *current* round; `hintCircle` is the drawn circle. All
  // three reset when the round advances, which doubles as the "already used
  // this round" gate in `useLifeline`.
  revealName: boolean
  revealFlag: boolean
  hintCircle: HintCircle | null
  // Line from the player's last dropped pin to the true capital. Cleared when
  // the next guess is made (only the current round's line is ever shown).
  guessLine: GuessLine | null
  // Capitals mode: the first of the round's two guesses, or null before the
  // player has guessed this capital. On the second guess the closer of the two
  // scores and the answer is revealed; null again once the round advances.
  roundGuess: RoundGuess | null
  // Bumped whenever the game markers are fully replaced (rather than appended),
  // so the viewer knows to wipe + redraw instead of appending. Capitals mode
  // replaces its two markers each guess; classic only ever appends.
  markerEpoch: number

  // Markers placed on the globe. Owned by the store (rather than the viewer's
  // map markers) so we can persist them and replay them on resume.
  markers: Marker[]
  // Wrong guesses on the *current* target. Resets on correct guess or reveal.
  consecutiveWrong: number
  // When non-null, the WorldViewer is expected to fly the camera to this
  // country and drop an X marker, then call clearReveal().
  revealTarget: string | null
  // When non-null, the player just got the *final* round correct. The viewer
  // pans to this country, holds 2 s, then calls finishGame() to transition to
  // the 'finished' phase. Keeps the score-screen handoff cinematic.
  endingTarget: string | null

  // True while a "Play With Friends" party match is driving the globe. In this
  // mode handleGlobeClick submits one server guess per question (no local
  // budget/reveal logic) and the question pointer is driven by the server via
  // syncPartyMatch rather than by local guesses.
  multiplayer: boolean
  // Whether the local player has already guessed the *current* party question.
  // Locks the globe until the server advances to the next question.
  partyAnswered: boolean
  // Epoch-ms until which guess input is ignored. Bumped GUESS_LOCK_MS ahead
  // whenever the target changes, so a click queued for the previous target
  // doesn't accidentally register against the new one. Enforced at the input
  // layer (WorldViewer), not in the guess handlers, so direct-call tests are
  // unaffected.
  inputLockUntil: number

  // Drive the local match from a party snapshot. Draws the deterministic
  // targets from the room seed, serves the server's current question, and
  // resets the answered-lock whenever the question changes. Called by the App's
  // party→store bridge on every snapshot.
  syncPartyMatch: (opts: {
    seed: string
    phase: PartyPhase
    currentQuestion: number
    // The room's selected game mode (server-resolved from the lobby vote).
    mode: string
  }) => void
  // Tear down the multiplayer match (leave / back to menu) and return to idle.
  endPartyMatch: () => void

  // Start a match. `sel` is a sub-mode id (see gameModes.ts); legacy GameMode
  // strings ('classic'/'capitals') are also accepted for old callers.
  startGame: (seed?: string, sel?: string) => void
  resetGame: () => void
  clearReveal: () => void
  // Wipes a just-finished capitals/cities round's map content (guess pins,
  // reveal marker, score-tier ring + line, hint circle) once its details card
  // has been dismissed, so the globe doesn't sit cluttered while idling
  // before the next guess. `epoch` is the markerEpoch that was current when
  // the dismissed card's round resolved — the caller snapshots it at reveal
  // time, so if the player has already guessed again before the dismiss
  // fires (bumping markerEpoch further), this becomes a no-op instead of
  // wiping the new round's just-placed pins.
  clearRoundMarkers: (epoch: number) => void
  finishGame: () => void
  // Routes a globe click through the game logic when in 'playing' phase.
  // lat/lon are the exact click location on the ellipsoid; they're recorded
  // into the per-country guess history so the stats view can pin them later.
  handleGlobeClick: (
    clicked: string | null,
    lat?: number,
    lon?: number,
  ) => void
  // Capitals mode guess: the player dropped a pin at (lat, lon). Scores it by
  // distance from the current target's capital, drops the guess + answer
  // markers, records it to the server, and advances (or finishes) the match.
  // `guessedCountry`/`guessedState` are the country/US-state (if any) the click
  // point resolved to on the globe — resolved by WorldViewer via the same
  // point-in-polygon lookup used for classic mode — so the region bonus can
  // compare them against the target city's actual country/state.
  handleCapitalGuess: (
    lat: number,
    lon: number,
    guessedCountry?: string | null,
    guessedState?: string | null,
  ) => void
  // Timed Mode only (see `timedMode`): the current classic-mode round's
  // TIMED_ROUND_MS window elapsed unsolved — forces the same reveal-and-
  // advance the second miss on a country would (single-player only).
  handleTimeout: () => void
  // Timed Mode only: the current capitals-mode round's window elapsed —
  // finalizes it using whatever guess (if any) was already dropped, same as
  // if the player had used their second attempt on it (single-player only).
  handleCapitalTimeout: () => void
  // Multiplayer city modes: lock in the current round's single pending guess as
  // the final answer (called when the round is about to end so a player who only
  // dropped one pin still gets that score, instead of it being thrown out).
  commitPartyCapitalGuess: () => void
  // Spend a once-per-game capitals lifeline on the current round.
  useLifeline: (which: Lifeline) => void
  // Records a marker drop. The viewer also handles the map-side render via
  // a subscription to `markers`.
  addMarker: (marker: Marker) => void
}

// FNV-1a 32-bit hash; folds an arbitrary seed string down to a u32 to seed
// mulberry32. Avalanches well enough that visually-similar seeds give very
// different draws.
const hashSeed = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Mulberry32 — small, fast, deterministic PRNG. Good enough for a 9-country
// shuffle and reproducible across browsers.
const mulberry32 = (a: number): (() => number) => {
  let s = a >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Partial Fisher-Yates: shuffles only the first n positions, costing O(n)
// rather than O(pool.length). The pool is large (~200 countries) so the saving
// matters.
const drawUniqueTargets = (
  pool: string[],
  seed: string,
  n: number,
): string[] => {
  const arr = pool.slice()
  const limit = Math.min(n, arr.length)
  const rng = mulberry32(hashSeed(seed))
  for (let i = 0; i < limit; i++) {
    const j = i + Math.floor(rng() * (arr.length - i))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr.slice(0, limit)
}

// Weighted sampling without replacement: single-player only (see
// `startGame`), so a player who keeps missing a country/city/state sees it
// more often, and one they've mastered drops out almost entirely. Each of the
// n draws picks from the remaining pool with probability proportional to
// `weightOf(item)`, then removes it, so O(n * pool.length) — fine at these
// pool sizes (a few hundred countries, ~9-30 draws/match). Still seeded, so a
// shared seed replays identically given the same weights.
const drawWeightedUniqueTargets = (
  pool: string[],
  weightOf: (item: string) => number,
  seed: string,
  n: number,
): string[] => {
  const rng = mulberry32(hashSeed(seed))
  const remaining = pool.map((item) => ({ item, w: Math.max(0, weightOf(item)) }))
  const limit = Math.min(n, remaining.length)
  const out: string[] = []
  for (let k = 0; k < limit; k++) {
    let total = 0
    for (const r of remaining) total += r.w
    // All-zero weights (shouldn't happen — weights floor at MIN_ITEM_WEIGHT —
    // but stay safe) falls back to a uniform pick.
    let roll = total > 0 ? rng() * total : rng() * remaining.length
    let idx = remaining.length - 1
    for (let i = 0; i < remaining.length; i++) {
      roll -= total > 0 ? remaining[i].w : 1
      if (roll <= 0) {
        idx = i
        break
      }
    }
    out.push(remaining[idx].item)
    remaining.splice(idx, 1)
  }
  return out
}

// Builds a single-player round on top of `drawWeightedUniqueTargets`, adding
// two "guaranteed" picks so a match never drifts into being entirely
// mastered items or entirely fresh ones:
//   1. An unmastered item (weight above MIN_ITEM_WEIGHT) — skipped only once
//      *nothing* in the pool is unmastered.
//   2. The least-recently-guessed item — forced only once every item in the
//      pool has been guessed at least once (a pool with never-seen items
//      already gets those naturally via guarantee #1 / the weighted draw, so
//      this only matters once the whole pool has cycled through and mastered
//      items would otherwise almost never resurface).
// Both guaranteed picks are seeded-shuffled in among the rest so they don't
// always land at the start or end of the round.
const buildRoundTargets = (
  pool: string[],
  weightOf: (item: string) => number,
  lastGuessedOf: (item: string) => number | undefined,
  seed: string,
  n: number,
): string[] => {
  const limit = Math.min(n, pool.length)
  if (limit <= 0) return []

  const guaranteed: string[] = []
  const pickRng = mulberry32(hashSeed(`${seed}:guarantee`))

  const unmastered = pool.filter((item) => weightOf(item) > MIN_ITEM_WEIGHT)
  if (unmastered.length > 0) {
    guaranteed.push(unmastered[Math.floor(pickRng() * unmastered.length)])
  }

  if (pool.every((item) => lastGuessedOf(item) !== undefined)) {
    let leastRecent: string | null = null
    let leastRecentAt = Infinity
    for (const item of pool) {
      if (guaranteed.includes(item)) continue
      const at = lastGuessedOf(item) ?? -Infinity
      if (at < leastRecentAt) {
        leastRecentAt = at
        leastRecent = item
      }
    }
    if (leastRecent) guaranteed.push(leastRecent)
  }

  const forced = guaranteed.slice(0, limit)
  const remainingPool = pool.filter((item) => !forced.includes(item))
  const drawn = drawWeightedUniqueTargets(
    remainingPool,
    weightOf,
    `${seed}:fill`,
    limit - forced.length,
  )

  const combined = [...forced, ...drawn]
  const shuffleRng = mulberry32(hashSeed(`${seed}:shuffle`))
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(shuffleRng() * (i + 1))
    const tmp = combined[i]
    combined[i] = combined[j]
    combined[j] = tmp
  }
  return combined
}

// Draw mode: pick `n` countries from `pool` that are geographically close to
// each other — a seed country chosen deterministically from `seed`, plus its
// n-1 nearest neighbors by straight centroid distance. This is an
// approximation of "adjacent" (the curated DRAW_SUBMODES pool is only ~30
// countries worldwide, so it rarely contains a true land-adjacent n-clique
// for an arbitrary seed) but keeps the group visually close enough to frame
// together in one shot. Countries missing a centroid (dataset still loading)
// are skipped; if fewer than n remain, returns whatever's available.
const pickAdjacentCluster = (
  pool: string[],
  centroids: Record<string, { lat: number; lon: number }>,
  seed: string,
  n: number,
): string[] => {
  const withCentroid = pool.filter((name) => centroids[name])
  if (withCentroid.length <= n) return withCentroid
  const rng = mulberry32(hashSeed(seed))
  const seedName = withCentroid[Math.floor(rng() * withCentroid.length)]
  const seedC = centroids[seedName]
  const dist2 = (name: string): number => {
    const c = centroids[name]
    const dLat = c.lat - seedC.lat
    const dLon = c.lon - seedC.lon
    return dLat * dLat + dLon * dLon
  }
  const rest = withCentroid
    .filter((name) => name !== seedName)
    .sort((a, b) => dist2(a) - dist2(b))
  return [seedName, ...rest.slice(0, n - 1)]
}

// 6 char base36 → 36⁶ ≈ 2.2 billion possible seeds. Plenty for sharing.
export const generateSeed = (): string =>
  Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0')

// The slice of GameState the draw pool is built from — narrowed (rather than
// the full GameState) so callers outside the store (App.tsx's mode menu) can
// pass a small selected object instead of subscribing to the whole store.
export type PoolSource = Pick<
  GameState,
  'cities' | 'states' | 'countries' | 'countryAreas' | 'hideTinyIslands'
>

// Min total polygon area (deg²) for a country to count as a "tiny island" —
// city-states and pinprick island nations that are effectively unclickable
// on the globe (Vatican, Monaco, Tuvalu, Nauru, …). Only applied to the
// "All" pool, and only when the hideTinyIslands setting is on.
export const MIN_TARGET_AREA = 0.1

// Build the draw pool for a sub-mode from the currently-loaded datasets. For
// the country family the pool is country NAMEs; for the city family it's the
// country NAMEs that have a matched capital (the capitals map keys). Explicit
// name lists are intersected with what actually loaded, so an entry missing
// from the dataset is silently dropped rather than breaking the draw.
export const poolForSubMode = (s: PoolSource, sub: SubMode): string[] => {
  if (sub.family === 'cities') {
    const spec = sub.cities ?? {}
    let entries = Object.entries(s.cities)
    if (spec.capitalsOnly) entries = entries.filter(([, c]) => c.capital)
    if (spec.countries) {
      const set = new Set(spec.countries)
      entries = entries.filter(([, c]) => set.has(c.country))
    }
    // The "all state capitals" set, folded back in below regardless of the
    // population floor/limit so tiny capitals (Montpelier, Pierre, …) survive.
    const stateCapitalKeys = spec.includeStateCapitals
      ? entries.filter(([, c]) => c.stateCapital || c.capital).map(([k]) => k)
      : []
    if (typeof spec.minPopulation === 'number') {
      entries = entries.filter(([, c]) => c.pop >= spec.minPopulation!)
    }
    // Largest-first, with the ne_id key as a deterministic tiebreak so the pool
    // (and therefore the seeded draw) is identical across clients.
    entries.sort((a, b) => b[1].pop - a[1].pop || (a[0] < b[0] ? -1 : 1))
    if (typeof spec.limit === 'number') entries = entries.slice(0, spec.limit)
    // Union the top-N-by-population list with every state capital, deduped by
    // ne_id — a capital already in the top N isn't listed twice. Sorted so the
    // seeded draw stays identical across clients.
    const keys = new Set(entries.map(([k]) => k))
    for (const k of stateCapitalKeys) keys.add(k)
    return [...keys].sort((a, b) => s.cities[b].pop - s.cities[a].pop || (a < b ? -1 : 1))
  }
  if (sub.family === 'states') return s.states
  if (sub.family === 'draw-states') {
    if (sub.pool === 'all') return s.states
    const playableStates = new Set(s.states)
    return (sub.pool as string[]).filter((n) => playableStates.has(n))
  }
  if (sub.pool === 'all') {
    if (!s.hideTinyIslands) return s.countries
    return s.countries.filter(
      (n) => (s.countryAreas[n] ?? Infinity) >= MIN_TARGET_AREA,
    )
  }
  const playable = new Set(s.countries)
  return (sub.pool as string[]).filter((n) => playable.has(n))
}

// How much of a sub-mode's pool the player has "solved" — driven to the
// minimum adaptive-difficulty weight (see `nextWeightEntry`). Shown next to
// each mode in the menu so mastery is visible per region/category.
export const subModeProgress = (
  s: PoolSource & Pick<GameState, 'itemWeights'>,
  sub: SubMode,
): { solved: number; total: number } => {
  const pool = poolForSubMode(s, sub)
  let solved = 0
  for (const item of pool) {
    const w = s.itemWeights[itemWeightKey(sub.family, item)]?.weight
    if (w !== undefined && w <= MIN_ITEM_WEIGHT) solved++
  }
  return { solved, total: pool.length }
}

const US_NAME = 'United States of America'

// The place name to show when a city is revealed. In sub-modes that draw US
// state lines (North America cities), US cities are identified by their state so
// it matches the on-globe boundaries; every other city shows its country.
export const cityRevealName = (city: CityInfo, subMode: string): string => {
  const byState = resolveSubMode(subMode).cities?.usStateLines === true
  if (byState && city.country === US_NAME && city.region) return city.region
  return city.country
}

// The flag image URL to show for the "flag" lifeline / reveal pin. In
// sub-modes that draw US state lines, every city is American, so the country
// flag is always the Stars and Stripes and tells the player nothing — show
// the city's state flag instead. Returns undefined for every other mode
// (callers fall back to the country ISO-code flag).
export const cityFlagUrl = (
  city: CityInfo,
  subMode: string,
): string | undefined => {
  const byState = resolveSubMode(subMode).cities?.usStateLines === true
  if (byState && city.country === US_NAME && city.region) {
    return usStateFlagUrl(city.region)
  }
  return undefined
}

// A city's rank by population among every loaded US city (not just the mode's
// draw pool) — "the Nth most populous city in the US". Ranked against the full
// populated-places dataset for the country, so a state capital that misses the
// mode's top-100 pool (Montpelier, Pierre, …) still gets an honest, much lower
// rank rather than being compared only within the pool.
export const usPopulationRank = (
  cities: Record<string, CityInfo>,
  key: string,
): number | null => {
  const city = cities[key]
  if (!city) return null
  const pops = Object.values(cities)
    .filter((c) => c.country === US_NAME)
    .map((c) => c.pop)
    .sort((a, b) => b - a)
  const rank = pops.indexOf(city.pop)
  return rank === -1 ? null : rank + 1
}

// A country's rank by population among every loaded country (1 = most
// populous), or null if it isn't in the map. Natural Earth's own POP_RANK
// field is a coarse label-priority bucket, not a literal population rank, so
// this is computed from the raw POP_EST values instead.
export const countryPopulationRank = (
  populations: Record<string, number>,
  name: string,
): number | null => {
  const pop = populations[name]
  if (pop === undefined) return null
  const pops = Object.values(populations).sort((a, b) => b - a)
  const rank = pops.indexOf(pop)
  return rank === -1 ? null : rank + 1
}

// The country served for a given position in the pre-drawn sequence, or null
// once the sequence is exhausted (game over).
const targetAt = (targets: string[], index: number): string | null =>
  targets[index] ?? null

// Great-circle distance in miles between two lat/lon points (haversine). Used by
// capitals mode to score a dropped pin against the true capital location.
const EARTH_RADIUS_MI = 3958.8
const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI
export const haversineMiles = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)))
}

// The point reached by travelling `distanceMi` from (lat, lon) along `bearingDeg`
// (0 = north, 90 = east). Used to offset the "draw circle" hint away from the
// true capital so the circle brackets the answer without centring on it.
export const destinationPoint = (
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceMi: number,
): { lat: number; lon: number } => {
  const ang = distanceMi / EARTH_RADIUS_MI
  const brng = toRad(bearingDeg)
  const lat1 = toRad(lat)
  const lon1 = toRad(lon)
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) +
      Math.cos(lat1) * Math.sin(ang) * Math.cos(brng),
  )
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    )
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 }
}

// Capitals-mode "draw circle" lifeline: a 750 mi circle whose centre is nudged
// 600 mi off the true capital (so the answer sits inside it, but off-centre).
export const CIRCLE_RADIUS_MI = 750
export const CIRCLE_OFFSET_MI = 600

// The three capitals-mode lifelines. Usable every round (not once per game),
// each at most once per round — gated directly on that round's reveal state
// (revealName/revealFlag/hintCircle), which already resets every round — but
// each use costs points off that round's score (see HINT_PENALTY).
export type Lifeline = 'name' | 'flag' | 'circle'

// Points deducted from a round's score for each lifeline used that round
// (stacks if more than one is used). "name" reveals the target's country/US
// state and "circle" brackets its location within ~750 mi — both narrow the
// guess a lot, so they cost more than "flag", a smaller visual nudge.
export const HINT_PENALTY: Record<Lifeline, number> = {
  name: 2,
  flag: 1,
  circle: 2,
}

// A hint circle to draw on the globe (centre + radius in miles).
export interface HintCircle {
  lat: number
  lon: number
  radiusMi: number
}

// Total point cost of every lifeline used so far *this round*. Read at
// scoring time (before the round's reveal state resets for the next one).
const hintPenaltyFor = (
  s: Pick<GameState, 'revealName' | 'revealFlag' | 'hintCircle'>,
): number =>
  (s.revealName ? HINT_PENALTY.name : 0) +
  (s.revealFlag ? HINT_PENALTY.flag : 0) +
  (s.hintCircle !== null ? HINT_PENALTY.circle : 0)

// The line drawn from the player's dropped pin to the true capital after a guess.
export interface GuessLine {
  fromLat: number
  fromLon: number
  toLat: number
  toLon: number
}

// Capitals mode: the player's first of two guesses on the current capital.
// Held so the second guess can pick the closer of the two for scoring, and so a
// mid-round refresh resumes with the first guess intact.
export interface RoundGuess {
  lat: number
  lon: number
  distance: number
  // Whether THIS guess landed in the target's actual country (or US state, in
  // the state-lines sub-mode) — carried alongside distance so whichever guess
  // ends up scoring (the closer of the two) brings its own bonus eligibility.
  regionMatch: boolean
}

export const useGameStore = create<GameState>((set, get) => ({
  heading: 0,
  setHeading: (heading) => set({ heading }),

  countries: [],
  setCountries: (countries) => set({ countries }),

  states: [],
  setStates: (states) => set({ states }),

  cities: {},
  setCities: (cities) => set({ cities }),

  countryCodes: {},
  setCountryCodes: (countryCodes) => set({ countryCodes }),

  countryPopulations: {},
  setCountryPopulations: (countryPopulations) => set({ countryPopulations }),

  countryAreas: {},
  setCountryAreas: (countryAreas) => set({ countryAreas }),

  countryCentroids: {},
  setCountryCentroids: (countryCentroids) => set({ countryCentroids }),

  stateCentroids: {},
  setStateCentroids: (stateCentroids) => set({ stateCentroids }),

  hideTinyIslands: loadHideTinyIslands(),
  setHideTinyIslands: (hide) => set({ hideTinyIslands: hide }),

  timedMode: loadTimedMode(),
  setTimedMode: (timed) => set({ timedMode: timed }),

  mapStyle: loadMapStyle(),
  setMapStyle: (style) => set({ mapStyle: style }),

  itemWeights: loadItemWeights(),
  itemWeightsUpdatedAt: loadItemWeightsUpdatedAt(),
  masteredThisMatch: 0,

  browseTarget: null,
  setBrowseTarget: (t) => set({ browseTarget: t }),

  browseSubModeId: null,
  setBrowseSubMode: (id) => set({ browseSubModeId: id }),

  generateLoginCode: async () => {
    // Push current progress first so the code being handed out reflects it,
    // even if the debounced background push (see the persistence subscriber
    // below) hasn't fired yet.
    await pushProgress(JSON.stringify(get().itemWeights))
    return accountGenerateLoginCode()
  },
  redeemLoginCode: async (code) => {
    const result = await accountRedeemLoginCode(code)
    if (!result.ok) return result.reason
    // Adopt the other device's progress wholesale — even if it's empty (a
    // fresh account with nothing synced yet). The persistence subscriber
    // below persists this locally and stamps a fresh itemWeightsUpdatedAt.
    const parsed = result.progress ? parseItemWeightsJSON(result.progress.data) : null
    set({ itemWeights: parsed ?? {} })
    return 'ok'
  },

  country: null,
  setCountry: (country) => set({ country }),

  perfectStreak: loadPerfectStreak(),

  phase: 'idle',
  mode: 'classic',
  subMode: 'all',
  seed: null,
  targets: [],
  targetIndex: 0,
  target: null,
  attempts: [],
  masteredOnAttempt: [],
  distances: [],
  capitalPoints: [],
  capitalBonus: [],
  capitalHintPenalty: [],
  drawScores: [],
  drawRevealIndex: null,
  drawShapeCount: 0,
  setDrawShapeCount: (n) => set({ drawShapeCount: n }),
  drawSubmitNonce: 0,
  requestDrawSubmit: () => set((s) => ({ drawSubmitNonce: s.drawSubmitNonce + 1 })),
  drawUndoNonce: 0,
  requestDrawUndo: () => set((s) => ({ drawUndoNonce: s.drawUndoNonce + 1 })),
  revealName: false,
  revealFlag: false,
  hintCircle: null,
  guessLine: null,
  roundGuess: null,
  markerEpoch: 0,
  markers: [],
  consecutiveWrong: 0,
  revealTarget: null,
  endingTarget: null,
  multiplayer: false,
  partyAnswered: false,
  inputLockUntil: 0,

  syncPartyMatch: ({ seed, phase, currentQuestion, mode }) => {
    const s = get()
    // The room's mode is a sub-mode id (see gameModes.ts). Resolve it to the
    // behavioural mode + id, exactly like single-player, so party matches get
    // the regional pools + city modes for free (defaults to All if unknown).
    const sub = resolveSubMode(mode)
    const gameMode = behavioralModeOf(sub)
    const subMode = sub.id

    if (phase === 'finished') {
      set({
        multiplayer: true,
        mode: gameMode,
        subMode,
        phase: 'finished',
        target: null,
      })
      return
    }
    if (phase !== 'playing') return

    // Draw the deterministic sequence the first time (or if the seed/mode
    // changed). The pool + length follow the room's chosen sub-mode, so all
    // clients serve identical questions from the room seed.
    const pool = poolForSubMode(get(), sub)
    const rounds = roundsForMode(gameMode)
    const needDraw =
      !s.multiplayer ||
      s.seed !== seed ||
      s.mode !== gameMode ||
      s.targets.length === 0
    const targets = needDraw ? drawUniqueTargets(pool, seed, rounds) : s.targets
    if (targets.length === 0) return

    const idx = Math.min(currentQuestion, targets.length)
    const questionChanged = needDraw || idx !== s.targetIndex
    // Capitals shows one guess + answer per round, so wipe the board when the
    // question changes; classic mode accumulates its guess pins.
    const isCapitals = gameMode === 'capitals'
    const wipeMarkers = needDraw || (isCapitals && questionChanged)
    set({
      multiplayer: true,
      mode: gameMode,
      subMode,
      phase: 'playing',
      seed,
      targets,
      targetIndex: idx,
      target: targetAt(targets, idx),
      // New question (or fresh match) clears the answered-lock and last guess.
      partyAnswered: questionChanged ? false : s.partyAnswered,
      // Brief input lock so a click meant for the previous capital/country
      // doesn't register against the freshly-served one.
      inputLockUntil: questionChanged ? lockUntil() : s.inputLockUntil,
      country: questionChanged ? null : s.country,
      markers: wipeMarkers ? [] : s.markers,
      markerEpoch: wipeMarkers ? s.markerEpoch + 1 : s.markerEpoch,
      attempts: needDraw ? [] : s.attempts,
      distances: needDraw ? [] : s.distances,
      capitalPoints: needDraw ? [] : s.capitalPoints,
      capitalBonus: needDraw ? [] : s.capitalBonus,
      capitalHintPenalty: needDraw ? [] : s.capitalHintPenalty,
      revealName: questionChanged ? false : s.revealName,
      revealFlag: questionChanged ? false : s.revealFlag,
      hintCircle: questionChanged ? null : s.hintCircle,
      guessLine: questionChanged ? null : s.guessLine,
      // Preserve an in-progress first guess (capitals gets two tries per round);
      // only a new question clears it, so a mid-round snapshot update from another
      // player doesn't reset our pending guess.
      roundGuess: questionChanged ? null : s.roundGuess,
      revealTarget: null,
      endingTarget: null,
    })
  },

  endPartyMatch: () => {
    set({
      multiplayer: false,
      partyAnswered: false,
      phase: 'idle',
      mode: 'classic',
      subMode: 'all',
      seed: null,
      targets: [],
      targetIndex: 0,
      target: null,
      attempts: [],
      masteredOnAttempt: [],
      distances: [],
      capitalPoints: [],
      capitalBonus: [],
      capitalHintPenalty: [],
      drawScores: [],
      drawRevealIndex: null,
      drawShapeCount: 0,
      revealName: false,
      revealFlag: false,
      hintCircle: null,
      guessLine: null,
      roundGuess: null,
      markers: [],
      country: null,
      consecutiveWrong: 0,
      revealTarget: null,
      endingTarget: null,
    })
  },

  startGame: (seed, sel) => {
    // Resolve the selection (sub-mode id or legacy mode string) to a sub-mode,
    // then derive the behaviour and the filtered draw pool from it.
    const sub = resolveSubMode(sel)
    const mode = behavioralModeOf(sub)
    const state = get()
    const pool = poolForSubMode(state, sub)
    if (pool.length === 0) return
    const matchSeed = seed ?? generateSeed()
    const roundCount = roundsForMode(mode)

    // Resume only if the seed AND the sub-mode match the saved match — the same
    // seed draws a different sequence per sub-mode. A different seed/sub-mode
    // (Play Again, switching regions, or a friend's URL) starts fresh; the
    // persistence subscriber will overwrite the save below. Legacy saves without
    // a `subMode` fall back to the one implied by their `mode`.
    const saved = loadSave()
    const savedSub = saved?.subMode ?? resolveSubMode(saved?.mode).id
    const restore =
      saved && saved.seed === matchSeed && savedSub === sub.id ? saved : null
    // A fresh draw is weighted by the player's per-item history (single-player
    // only). A resumed match reuses its already-drawn `targets` verbatim
    // rather than re-rolling — the rounds played so far have already nudged
    // their own items' weights, so recomputing could reshuffle the remainder.
    const weightOf = (item: string) =>
      state.itemWeights[itemWeightKey(sub.family, item)]?.weight ??
      DEFAULT_ITEM_WEIGHT
    const lastGuessedOf = (item: string) =>
      state.itemWeights[itemWeightKey(sub.family, item)]?.lastGuessed
    const targets =
      restore?.targets && restore.targets.length > 0
        ? restore.targets
        : mode === 'draw'
          ? pickAdjacentCluster(
              pool,
              sub.family === 'draw-states'
                ? state.stateCentroids
                : state.countryCentroids,
              matchSeed,
              roundCount,
            )
          : buildRoundTargets(pool, weightOf, lastGuessedOf, matchSeed, roundCount)
    if (targets.length === 0) return
    const attempts = restore?.attempts ?? []
    const masteredOnAttempt = restore?.masteredOnAttempt ?? []
    const distances = restore?.distances ?? []
    const capitalPoints = restore?.capitalPoints ?? []
    const capitalBonus = restore?.capitalBonus ?? []
    const capitalHintPenalty = restore?.capitalHintPenalty ?? []
    const drawScores = restore?.drawScores ?? []
    const drawRevealIndex = restore?.drawRevealIndex ?? null
    const markers = restore?.markers ?? []
    const consecutiveWrong = restore?.consecutiveWrong ?? 0
    const targetIndex = restore?.targetIndex ?? 0
    const roundGuess = restore?.roundGuess ?? null
    const masteredThisMatch = restore?.masteredThisMatch ?? 0
    // Capitals mode records one distance per completed capital, and draw mode
    // one score per completed round, so each finishes once that array fills —
    // except draw mode also has to have finished walking through its
    // post-match reveal sequence (drawRevealIndex back to null); classic mode
    // finishes on the guess budget.
    const finished =
      mode === 'capitals'
        ? distances.length >= CAPITAL_ROUNDS
        : mode === 'draw'
          ? drawScores.length >= DRAW_ROUNDS && drawRevealIndex === null
          : targetIndex >= ROUNDS

    set({
      phase: finished ? 'finished' : 'playing',
      mode,
      subMode: sub.id,
      seed: matchSeed,
      targets,
      targetIndex,
      target: finished ? null : targetAt(targets, targetIndex),
      attempts,
      masteredOnAttempt,
      distances,
      capitalPoints,
      capitalBonus,
      capitalHintPenalty,
      drawScores,
      drawRevealIndex,
      drawShapeCount: 0,
      revealName: false,
      revealFlag: false,
      hintCircle: null,
      guessLine: null,
      roundGuess,
      markers,
      country: null,
      consecutiveWrong,
      revealTarget: null,
      endingTarget: null,
      multiplayer: false,
      partyAnswered: false,
      masteredThisMatch,
      // Settle the intro camera before the first click can land.
      inputLockUntil: finished ? 0 : lockUntil(),
    })
  },

  resetGame: () =>
    set({
      phase: 'idle',
      mode: 'classic',
      subMode: 'all',
      seed: null,
      targets: [],
      targetIndex: 0,
      target: null,
      attempts: [],
      masteredOnAttempt: [],
      distances: [],
      capitalPoints: [],
      capitalBonus: [],
      capitalHintPenalty: [],
      drawScores: [],
      drawRevealIndex: null,
      drawShapeCount: 0,
      revealName: false,
      revealFlag: false,
      hintCircle: null,
      guessLine: null,
      roundGuess: null,
      markers: [],
      country: null,
      consecutiveWrong: 0,
      revealTarget: null,
      endingTarget: null,
      multiplayer: false,
      masteredThisMatch: 0,
      partyAnswered: false,
    }),

  clearReveal: () =>
    set((state) => {
      // A reveal that spends the last guess ends the match (with a miss, so the
      // streak resets). Mid-game reveals leave phase/streak untouched.
      const finished = state.attempts.length >= ROUNDS
      return {
        revealTarget: null,
        // Guessing was blocked through the reveal; now the next target is live,
        // so hold input briefly to avoid a click meant for the revealed answer.
        inputLockUntil: finished ? state.inputLockUntil : lockUntil(),
        phase: finished ? 'finished' : state.phase,
        perfectStreak: finished
          ? nextPerfectStreak(state.attempts, state.perfectStreak)
          : state.perfectStreak,
      }
    }),

  clearRoundMarkers: (epoch) =>
    set((state) => {
      // A newer round has already replaced the markers (its own guess bumped
      // markerEpoch past the snapshot the caller took) — leave them alone.
      if (state.markerEpoch !== epoch) return {}
      return {
        markers: [],
        guessLine: null,
        hintCircle: null,
        markerEpoch: state.markerEpoch + 1,
      }
    }),

  // Reached only after the final correct guess's celebratory pan. The match is
  // perfect iff every round was correct.
  finishGame: () =>
    set((s) => ({
      phase: 'finished',
      endingTarget: null,
      perfectStreak: nextPerfectStreak(s.attempts, s.perfectStreak),
    })),

  // Records one of the DRAW_ROUNDS targets' scores (WorldViewer calls this
  // once the player hits Submit — see computeOverlapPercent). The first
  // DRAW_ROUNDS-1 submissions just advance to the next target to draw — no
  // reveal yet, no camera move (WorldViewer keeps framing the whole cluster
  // and only resets the *current* round's shape state). The final
  // submission instead starts the reveal sequence from the first target
  // (drawRevealIndex: 0) — see advanceDrawRound, which steps through the
  // rest in the same order they were drawn.
  submitDrawGuess: (percent) => {
    const s = get()
    if (s.mode !== 'draw' || s.phase !== 'playing' || s.target === null) return
    if (s.drawRevealIndex !== null) return
    const drawScores = [...s.drawScores, percent]
    if (drawScores.length >= DRAW_ROUNDS) {
      set({ drawScores, drawRevealIndex: 0, drawShapeCount: 0 })
      return
    }
    const targetIndex = s.targetIndex + 1
    set({
      drawScores,
      targetIndex,
      target: targetAt(s.targets, targetIndex),
      drawShapeCount: 0,
    })
  },

  // Called by WorldViewer once the current reveal step has been shown a
  // while: steps to the next of the 5 targets' reveal, or — after the last
  // one — finishes the match.
  advanceDrawRound: () => {
    const s = get()
    if (s.mode !== 'draw' || s.drawRevealIndex === null) return
    const next = s.drawRevealIndex + 1
    const finished = next >= DRAW_ROUNDS
    set({
      drawRevealIndex: finished ? null : next,
      phase: finished ? 'finished' : 'playing',
      target: finished ? null : s.target,
    })
  },

  handleGlobeClick: (clicked, lat, lon) => {
    set({ country: clicked })

    const s = get()

    // ---- Multiplayer party path ----
    // One server guess per question, no local budget/reveal logic. The question
    // pointer advances only when the server does (via syncPartyMatch), so a
    // second click is ignored until then.
    if (s.multiplayer) {
      if (s.phase !== 'playing' || clicked === null || s.target === null) return
      if (s.partyAnswered) return
      const correct = clicked === s.target
      if (correct) sfxCorrect()
      else sfxWrong()
      submitPartyGuess(s.targetIndex, correct)
      set({ partyAnswered: true })
      return
    }

    // Ignore clicks during reveal/ending animations; the viewer is repositioning.
    if (
      s.phase !== 'playing' ||
      clicked === null ||
      s.revealTarget !== null ||
      s.endingTarget !== null
    )
      return

    // No active country (sequence exhausted) → nothing to guess against.
    if (s.target === null || s.targetIndex >= ROUNDS) return

    const family = resolveSubMode(s.subMode).family

    const correct = clicked === s.target

    // Audible feedback for the placement, before any state transition.
    if (correct) sfxCorrect()
    else sfxWrong()

    // The player has a fixed budget of ROUNDS guesses for the whole match. Each
    // click consumes one (logged here), and the match ends once all are spent —
    // so a miss costs a guess that would otherwise have reached a later country.
    // The country pointer is separate: it only advances on a correct guess or
    // the second consecutive miss, and a miss never adds a guess to the budget.
    const attempts: AttemptResult[] = [
      ...s.attempts,
      correct ? 'correct' : 'wrong',
    ]
    const finished = attempts.length >= ROUNDS

    if (correct) {
      const targetIndex = s.targetIndex + 1
      // Adaptive difficulty: this target is resolved (correctly), so bump its
      // weight now — halved if nailed on the first try, unchanged on the
      // second (see `nextWeightEntry`).
      const key = itemWeightKey(family, s.target)
      const prevWeight = s.itemWeights[key]?.weight ?? DEFAULT_ITEM_WEIGHT
      const nextEntry = nextWeightEntry(
        s.itemWeights[key],
        s.consecutiveWrong === 0 ? 'first' : 'second',
      )
      const itemWeights = { ...s.itemWeights, [key]: nextEntry }
      const justMastered = isNewlyMastered(prevWeight, nextEntry.weight)
      const masteredThisMatch = s.masteredThisMatch + (justMastered ? 1 : 0)
      const masteredOnAttempt = [...s.masteredOnAttempt, justMastered]
      // Layer the achievement chime on top of the correct "bing" already
      // played above — fires at the moment of the click that earned it, not
      // later, so it reads as feedback on this guess.
      if (justMastered) sfxAchievement()
      // On the final guess, hand the camera to the viewer for a celebratory pan.
      // Phase stays 'playing' until finishGame() fires after the hold.
      set({
        attempts,
        masteredOnAttempt,
        targetIndex,
        consecutiveWrong: 0,
        target: finished ? null : targetAt(s.targets, targetIndex),
        endingTarget: finished ? clicked : null,
        // New target next — brief lock so a double-click doesn't burn a guess.
        inputLockUntil: finished ? s.inputLockUntil : lockUntil(),
        itemWeights,
        masteredThisMatch,
      })
      return
    }

    const newWrong = s.consecutiveWrong + 1
    if (newWrong < WRONG_GUESSES_BEFORE_REVEAL && !finished) {
      // Still have a guess left on this country (and in the match) — log the
      // miss but keep the same target so the next click retries it. Brief
      // lock so a double-tap that produced this miss doesn't also burn the
      // retry.
      set({
        attempts,
        masteredOnAttempt: [...s.masteredOnAttempt, false],
        consecutiveWrong: newWrong,
        target: s.target,
        inputLockUntil: lockUntil(FIRST_MISS_LOCK_MS),
      })
      return
    }

    // Reveal the answer: either this is the second miss on the country, or the
    // guess budget just ran out mid-country. Advance the pointer only on a true
    // second miss. Phase stays 'playing' through the reveal hold; clearReveal
    // flips to 'finished' once the guess budget is spent.
    const doubleMiss = newWrong >= WRONG_GUESSES_BEFORE_REVEAL
    const targetIndex = doubleMiss ? s.targetIndex + 1 : s.targetIndex
    // Adaptive difficulty: the reveal fires because this target went
    // unanswered (either two straight misses, or the guess budget ran out
    // mid-country) — either way the player never got it, so it's a miss.
    const key = itemWeightKey(family, s.target)
    const itemWeights = {
      ...s.itemWeights,
      [key]: nextWeightEntry(s.itemWeights[key], 'miss'),
    }
    set({
      attempts,
      masteredOnAttempt: [...s.masteredOnAttempt, false],
      targetIndex,
      consecutiveWrong: 0,
      revealTarget: s.target,
      target: finished ? null : targetAt(s.targets, targetIndex),
      phase: 'playing',
      itemWeights,
    })
  },

  // Timed Mode: this round's TIMED_ROUND_MS elapsed with the target still
  // unsolved. Forces the same reveal-and-advance the second miss on a
  // country triggers above — regardless of how many (0 or 1) wrong clicks
  // already happened this round, padding `attempts` with enough 'wrong'
  // entries to reach that point so the guess budget stays honest (a
  // never-attempted round still "costs" the full 2, same as a genuine
  // double miss; one already-wrong click only needs 1 more).
  handleTimeout: () => {
    const s = get()
    if (s.multiplayer || s.mode !== 'classic') return
    if (s.phase !== 'playing' || s.target === null) return
    if (s.revealTarget !== null || s.endingTarget !== null) return
    if (s.targetIndex >= ROUNDS || s.attempts.length >= ROUNDS) return

    const family = resolveSubMode(s.subMode).family
    const needed = Math.min(
      Math.max(1, WRONG_GUESSES_BEFORE_REVEAL - s.consecutiveWrong),
      ROUNDS - s.attempts.length,
    )
    const attempts: AttemptResult[] = [
      ...s.attempts,
      ...(Array(needed).fill('wrong') as AttemptResult[]),
    ]
    const finished = attempts.length >= ROUNDS
    const targetIndex = s.targetIndex + 1
    const key = itemWeightKey(family, s.target)
    const itemWeights = {
      ...s.itemWeights,
      [key]: nextWeightEntry(s.itemWeights[key], 'miss'),
    }
    sfxWrong()
    set({
      attempts,
      masteredOnAttempt: [
        ...s.masteredOnAttempt,
        ...(Array(needed).fill(false) as boolean[]),
      ],
      targetIndex,
      consecutiveWrong: 0,
      revealTarget: s.target,
      target: finished ? null : targetAt(s.targets, targetIndex),
      phase: 'playing',
      itemWeights,
    })
  },

  handleCapitalGuess: (lat, lon, guessedCountry, guessedState) => {
    const s = get()
    if (s.mode !== 'capitals') return
    if (s.phase !== 'playing' || s.target === null) return
    // The target is a city key (ne_id); look up the city being asked for.
    const cap = s.cities[s.target]
    if (!cap) return
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return

    const NEAR_MI = CAPITAL_NEAR_MI
    // The true great-circle miss, uncapped — a wild guess shows its actual
    // distance rather than being clamped, so the "X mi" text is always honest.
    const distance = haversineMiles(lat, lon, cap.lat, cap.lon)
    const near = distance <= NEAR_MI

    // Whether THIS click landed in the target's actual country — or, in the
    // US state-lines sub-mode, its actual state — for the +1 region bonus.
    // Also awarded outright once the guess is within the tightest distance
    // tier (tiers[0], the smallest scoring radius) — a pin that close is
    // essentially on the city, so a click that technically lands just across
    // a nearby border into another country/state shouldn't cost the bonus.
    const byState = resolveSubMode(s.subMode).cities?.usStateLines === true
    const withinSmallestTier = distance <= capitalPointTierMilesFor(s.subMode)[0]
    const regionMatch =
      withinSmallestTier ||
      (byState
        ? guessedState != null && guessedState === cap.region
        : guessedCountry != null && guessedCountry === cap.country)

    // A guess dot labelled with its own miss distance. Grey by default; the
    // closer of the two guesses — the one that actually scores — is drawn
    // yellow. Shared by the multiplayer and single-player paths.
    const pinFor = (
      gLat: number,
      gLon: number,
      dist: number,
      used = false,
    ): Marker => ({
      lat: gLat,
      lon: gLon,
      kind: used ? 'guess-best' : 'guess',
      label: `${Math.round(dist).toLocaleString()} mi`,
    })

    // ---- Multiplayer party path: two guesses per capital, closer one counts. ----
    // Like single-player, the first drop only shows a pin + distance (no reveal,
    // nothing scored). The second drop submits the best distance to the server
    // (golf-scored) and reveals the answer, locking the round.
    if (s.multiplayer) {
      if (s.partyAnswered) return
      if (near) sfxCorrect()
      else sfxWrong()

      // First of two guesses: show the pin + distance only, no answer, no submit.
      if (s.roundGuess === null) {
        set({
          roundGuess: { lat, lon, distance, regionMatch },
          markers: [pinFor(lat, lon, distance)],
          markerEpoch: s.markerEpoch + 1,
          guessLine: null,
        })
        return
      }

      // Second guess: score the closer of the two, submit once, reveal, lock.
      const first = s.roundGuess
      const best = Math.min(first.distance, distance)
      // The current (second) guess scores when it's at least as close as the first.
      const currentBest = distance <= first.distance
      const bestRegionMatch = currentBest ? regionMatch : first.regionMatch
      const hintPenalty = hintPenaltyFor(s)
      const points =
        pointsForDistance(best, capitalPointTierMilesFor(s.subMode)) +
        (bestRegionMatch ? REGION_BONUS_POINTS : 0) -
        hintPenalty
      const scoring = currentBest
        ? { lat, lon }
        : { lat: first.lat, lon: first.lon }
      submitPartyGuess(s.targetIndex, best <= NEAR_MI, best)
      set({
        partyAnswered: true,
        roundGuess: null,
        capitalPoints: [...s.capitalPoints, points],
        capitalBonus: [...s.capitalBonus, bestRegionMatch],
        capitalHintPenalty: [...s.capitalHintPenalty, hintPenalty],
        markers: [
          pinFor(first.lat, first.lon, first.distance, !currentBest),
          pinFor(lat, lon, distance, currentBest),
          {
            lat: cap.lat,
            lon: cap.lon,
            kind: 'reveal',
            label: `${cap.city},\n${cityRevealName(cap, s.subMode)}`,
            code: s.countryCodes[cap.country],
            flagUrl: cityFlagUrl(cap, s.subMode),
          },
        ],
        markerEpoch: s.markerEpoch + 1,
        guessLine: {
          fromLat: scoring.lat,
          fromLon: scoring.lon,
          toLat: cap.lat,
          toLon: cap.lon,
        },
        hintCircle: null,
      })
      return
    }

    // ---- Single-player path ----
    if (s.distances.length >= CAPITAL_ROUNDS) return

    if (near) sfxCorrect()
    else sfxWrong()

    // ---- First of two guesses: show the pin + distance, hide the answer. ----
    // The round doesn't advance and nothing is scored yet — the player gets a
    // second attempt, and only the closer of the two counts.
    if (s.roundGuess === null) {
      set({
        roundGuess: { lat, lon, distance, regionMatch },
        // Replace the previous round's markers with just this guess pin. The
        // hint circle / name / flag reveals persist into the second guess.
        markers: [pinFor(lat, lon, distance)],
        markerEpoch: s.markerEpoch + 1,
        // No line yet — that would reveal where the answer is.
        guessLine: null,
      })
      return
    }

    // ---- Second guess: score the closer of the two, reveal, advance. ----
    const first = s.roundGuess
    const best = Math.min(first.distance, distance)
    // The current (second) guess scores when it's at least as close as the first;
    // its pin is the one the answer line connects to and is drawn yellow.
    const currentBest = distance <= first.distance
    const bestRegionMatch = currentBest ? regionMatch : first.regionMatch
    const hintPenalty = hintPenaltyFor(s)
    const points =
      pointsForDistance(best, capitalPointTierMilesFor(s.subMode)) +
      (bestRegionMatch ? REGION_BONUS_POINTS : 0) -
      hintPenalty
    const scoring = currentBest
      ? { lat, lon }
      : { lat: first.lat, lon: first.lon }

    const distances = [...s.distances, best]
    const capitalPoints = [...s.capitalPoints, points]
    const capitalBonus = [...s.capitalBonus, bestRegionMatch]
    const capitalHintPenalty = [...s.capitalHintPenalty, hintPenalty]
    const targetIndex = s.targetIndex + 1
    const finished = distances.length >= CAPITAL_ROUNDS
    // Adaptive difficulty: for the golf-scored cities mode, "correct" means
    // landing within the top two score tiers (<=50 mi, CAPITAL_NEAR_MI) — the
    // same threshold as the "near" hit sfx above. First attempt scoring that
    // close halves the weight; only reaching it on the second attempt leaves
    // the weight unchanged; missing both drops it into the miss bucket.
    const outcome: WeightOutcome =
      first.distance <= CAPITAL_NEAR_MI
        ? 'first'
        : best <= CAPITAL_NEAR_MI
          ? 'second'
          : 'miss'
    const weightKey = itemWeightKey('cities', s.target)
    const prevWeight = s.itemWeights[weightKey]?.weight ?? DEFAULT_ITEM_WEIGHT
    const nextEntry = nextWeightEntry(s.itemWeights[weightKey], outcome)
    const itemWeights = { ...s.itemWeights, [weightKey]: nextEntry }
    const masteredThisMatch =
      s.masteredThisMatch +
      (isNewlyMastered(prevWeight, nextEntry.weight) ? 1 : 0)
    set({
      distances,
      capitalPoints,
      capitalBonus,
      capitalHintPenalty,
      itemWeights,
      masteredThisMatch,
      // Both guess dots (the closer one yellow) plus the reveal pin: the
      // country's flag with a two-line "City,\nCountry" label above it (flag from
      // the explicit `code`, since the label text isn't a plain country name).
      markers: [
        pinFor(first.lat, first.lon, first.distance, !currentBest),
        pinFor(lat, lon, distance, currentBest),
        {
          lat: cap.lat,
          lon: cap.lon,
          kind: 'reveal',
          label: `${cap.city},\n${cityRevealName(cap, s.subMode)}`,
          code: s.countryCodes[cap.country],
          flagUrl: cityFlagUrl(cap, s.subMode),
        },
      ],
      markerEpoch: s.markerEpoch + 1,
      // Line from the scoring (closer) guess to the answer.
      guessLine: {
        fromLat: scoring.lat,
        fromLon: scoring.lon,
        toLat: cap.lat,
        toLon: cap.lon,
      },
      hintCircle: null,
      revealName: false,
      revealFlag: false,
      roundGuess: null,
      targetIndex,
      target: finished ? null : targetAt(s.targets, targetIndex),
      phase: finished ? 'finished' : 'playing',
      // Next capital served — hold input so a stray click doesn't guess it.
      inputLockUntil: finished ? s.inputLockUntil : lockUntil(),
    })
  },

  // Timed Mode: this round's TIMED_ROUND_MS elapsed. Finalizes it using
  // whatever guess (if any) was already dropped — as if that were also the
  // second attempt (no second pin to average against) — or, if the player
  // never guessed at all, a full miss (MAX_CAPITAL_MILES, 0 points, still
  // less any lifeline cost already spent this round).
  handleCapitalTimeout: () => {
    const s = get()
    if (s.multiplayer || s.mode !== 'capitals') return
    if (s.phase !== 'playing' || s.target === null) return
    if (s.distances.length >= CAPITAL_ROUNDS) return
    const cap = s.cities[s.target]
    if (!cap) return

    const pinFor = (
      gLat: number,
      gLon: number,
      dist: number,
      used = false,
    ): Marker => ({
      lat: gLat,
      lon: gLon,
      kind: used ? 'guess-best' : 'guess',
      label: `${Math.round(dist).toLocaleString()} mi`,
    })
    const revealMarker: Marker = {
      lat: cap.lat,
      lon: cap.lon,
      kind: 'reveal',
      label: `${cap.city},\n${cityRevealName(cap, s.subMode)}`,
      code: s.countryCodes[cap.country],
      flagUrl: cityFlagUrl(cap, s.subMode),
    }

    const first = s.roundGuess
    const best = first ? first.distance : MAX_CAPITAL_MILES
    const bestRegionMatch = first ? first.regionMatch : false
    const hintPenalty = hintPenaltyFor(s)
    const points = first
      ? pointsForDistance(best, capitalPointTierMilesFor(s.subMode)) +
        (bestRegionMatch ? REGION_BONUS_POINTS : 0) -
        hintPenalty
      : -hintPenalty

    const distances = [...s.distances, best]
    const capitalPoints = [...s.capitalPoints, points]
    const capitalBonus = [...s.capitalBonus, bestRegionMatch]
    const capitalHintPenalty = [...s.capitalHintPenalty, hintPenalty]
    const targetIndex = s.targetIndex + 1
    const finished = distances.length >= CAPITAL_ROUNDS
    // Only 'first' or 'miss' are possible here — there's no second attempt to
    // potentially do better on, so the existing first-vs-second split from
    // handleCapitalGuess collapses to just "was the one guess we got near?".
    const outcome: WeightOutcome =
      first && first.distance <= CAPITAL_NEAR_MI ? 'first' : 'miss'
    const weightKey = itemWeightKey('cities', s.target)
    const prevWeight = s.itemWeights[weightKey]?.weight ?? DEFAULT_ITEM_WEIGHT
    const nextEntry = nextWeightEntry(s.itemWeights[weightKey], outcome)
    const itemWeights = { ...s.itemWeights, [weightKey]: nextEntry }
    const masteredThisMatch =
      s.masteredThisMatch +
      (isNewlyMastered(prevWeight, nextEntry.weight) ? 1 : 0)

    if (outcome === 'first') sfxCorrect()
    else sfxWrong()

    set({
      distances,
      capitalPoints,
      capitalBonus,
      capitalHintPenalty,
      itemWeights,
      masteredThisMatch,
      markers: first
        ? [pinFor(first.lat, first.lon, first.distance, true), revealMarker]
        : [revealMarker],
      markerEpoch: s.markerEpoch + 1,
      guessLine: first
        ? {
            fromLat: first.lat,
            fromLon: first.lon,
            toLat: cap.lat,
            toLon: cap.lon,
          }
        : null,
      hintCircle: null,
      revealName: false,
      revealFlag: false,
      roundGuess: null,
      targetIndex,
      target: finished ? null : targetAt(s.targets, targetIndex),
      phase: finished ? 'finished' : 'playing',
      inputLockUntil: finished ? s.inputLockUntil : lockUntil(),
    })
  },

  commitPartyCapitalGuess: () => {
    const s = get()
    if (!s.multiplayer || s.mode !== 'capitals' || s.phase !== 'playing') return
    if (s.partyAnswered || s.roundGuess === null || s.target === null) return
    const cap = s.cities[s.target]
    if (!cap) return
    // The one pin the player did drop becomes the scoring guess (drawn yellow).
    const g = s.roundGuess
    const hintPenalty = hintPenaltyFor(s)
    const points =
      pointsForDistance(g.distance, capitalPointTierMilesFor(s.subMode)) +
      (g.regionMatch ? REGION_BONUS_POINTS : 0) -
      hintPenalty
    submitPartyGuess(s.targetIndex, g.distance <= CAPITAL_NEAR_MI, g.distance)
    set({
      partyAnswered: true,
      roundGuess: null,
      capitalPoints: [...s.capitalPoints, points],
      capitalBonus: [...s.capitalBonus, g.regionMatch],
      capitalHintPenalty: [...s.capitalHintPenalty, hintPenalty],
      markers: [
        {
          lat: g.lat,
          lon: g.lon,
          kind: 'guess-best',
          label: `${Math.round(g.distance).toLocaleString()} mi`,
        },
        {
          lat: cap.lat,
          lon: cap.lon,
          kind: 'reveal',
          label: `${cap.city},\n${cityRevealName(cap, s.subMode)}`,
          code: s.countryCodes[cap.country],
          flagUrl: cityFlagUrl(cap, s.subMode),
        },
      ],
      markerEpoch: s.markerEpoch + 1,
      guessLine: {
        fromLat: g.lat,
        fromLon: g.lon,
        toLat: cap.lat,
        toLon: cap.lon,
      },
      hintCircle: null,
    })
  },

  useLifeline: (which) => {
    const s = get()
    if (s.mode !== 'capitals' || s.phase !== 'playing' || s.target === null)
      return
    // Each hint is usable once per round (not once per game) — gate directly
    // on that round's own reveal state, which already resets every round.
    if (which === 'name' && s.revealName) return
    if (which === 'flag' && s.revealFlag) return
    if (which === 'circle' && s.hintCircle !== null) return
    // In a party match, broadcast the lifeline so every client toasts it.
    if (s.multiplayer) sendPartyLifeline(which)
    if (which === 'name') {
      set({ revealName: true })
    } else if (which === 'flag') {
      set({ revealFlag: true })
    } else {
      const cap = s.cities[s.target]
      if (!cap) return
      // Offset the circle centre a fixed distance in a random direction so the
      // true capital lands inside the circle but not at its centre.
      const bearing = Math.random() * 360
      const c = destinationPoint(cap.lat, cap.lon, bearing, CIRCLE_OFFSET_MI)
      set({
        hintCircle: { lat: c.lat, lon: c.lon, radiusMi: CIRCLE_RADIUS_MI },
      })
    }
  },

  addMarker: (marker) =>
    set((state) => ({ markers: [...state.markers, marker] })),
}))

// Persist the in-progress match to localStorage on every relevant change.
// Only a single match is stored — starting a different seed overwrites it,
// satisfying the "clear data when a new seed is started" requirement.
useGameStore.subscribe((state, prev) => {
  if (!state.seed) return
  // Party matches are server-authoritative and never resumed from localStorage.
  if (state.multiplayer) return
  if (
    state.seed === prev.seed &&
    state.attempts === prev.attempts &&
    state.distances === prev.distances &&
    state.capitalPoints === prev.capitalPoints &&
    state.capitalBonus === prev.capitalBonus &&
    state.capitalHintPenalty === prev.capitalHintPenalty &&
    state.drawScores === prev.drawScores &&
    state.drawRevealIndex === prev.drawRevealIndex &&
    state.targetIndex === prev.targetIndex &&
    state.markers === prev.markers &&
    state.consecutiveWrong === prev.consecutiveWrong &&
    state.roundGuess === prev.roundGuess
  )
    return
  writeSave({
    seed: state.seed,
    mode: state.mode,
    subMode: state.subMode,
    targets: state.targets,
    attempts: state.attempts,
    masteredOnAttempt: state.masteredOnAttempt,
    distances: state.distances,
    capitalPoints: state.capitalPoints,
    capitalBonus: state.capitalBonus,
    capitalHintPenalty: state.capitalHintPenalty,
    drawScores: state.drawScores,
    drawRevealIndex: state.drawRevealIndex,
    targetIndex: state.targetIndex,
    consecutiveWrong: state.consecutiveWrong,
    markers: state.markers,
    roundGuess: state.roundGuess,
    masteredThisMatch: state.masteredThisMatch,
  })
})

// Debounced push of itemWeights up to the server, under the current device's
// account id — see account.ts. Coalesces a burst of rounds into one write.
const PROGRESS_PUSH_DEBOUNCE_MS = 2000
let progressPushTimer: ReturnType<typeof setTimeout> | null = null
const schedulePushProgress = (itemWeights: ItemWeights): void => {
  if (progressPushTimer !== null) clearTimeout(progressPushTimer)
  progressPushTimer = setTimeout(() => {
    progressPushTimer = null
    void pushProgress(JSON.stringify(itemWeights))
  }, PROGRESS_PUSH_DEBOUNCE_MS)
}

// Persist long-lived state (progress and settings) independently of the match
// save — it survives across matches and is never wiped by a "new game".
useGameStore.subscribe((state, prev) => {
  if (state.perfectStreak !== prev.perfectStreak)
    writeJSON(PERFECT_STREAK_KEY, state.perfectStreak)
  if (state.itemWeights !== prev.itemWeights) {
    const now = Date.now()
    writeJSON(ITEM_WEIGHTS_KEY, state.itemWeights)
    writeJSON(ITEM_WEIGHTS_UPDATED_KEY, now)
    if (state.itemWeightsUpdatedAt !== now)
      useGameStore.setState({ itemWeightsUpdatedAt: now })
    schedulePushProgress(state.itemWeights)
  }
  if (state.hideTinyIslands !== prev.hideTinyIslands)
    writeJSON(HIDE_TINY_ISLANDS_KEY, state.hideTinyIslands)
  if (state.timedMode !== prev.timedMode)
    writeJSON(TIMED_MODE_KEY, state.timedMode)
  if (state.mapStyle !== prev.mapStyle)
    writeJSON(MAP_STYLE_KEY, state.mapStyle)
})

// One-time cross-device catch-up on load: compare this device's local
// itemWeights timestamp against the server's for the current account, and
// let whichever is newer win (last-write-wins — good enough for a single
// player sequentially switching between their own devices). If the server has
// nothing yet (or is unreachable), this just pushes local progress up so it
// exists there going forward.
async function syncProgressOnLoad(): Promise<void> {
  const accountId = getAccountId()
  const remote = await pullProgress(accountId)
  const state = useGameStore.getState()
  if (remote && remote.updatedAt > state.itemWeightsUpdatedAt) {
    const parsed = parseItemWeightsJSON(remote.data)
    if (parsed) {
      writeJSON(ITEM_WEIGHTS_KEY, parsed)
      writeJSON(ITEM_WEIGHTS_UPDATED_KEY, remote.updatedAt)
      useGameStore.setState({
        itemWeights: parsed,
        itemWeightsUpdatedAt: remote.updatedAt,
      })
      return
    }
  }
  if (Object.keys(state.itemWeights).length > 0) {
    void pushProgress(JSON.stringify(state.itemWeights))
  }
}
void syncProgressOnLoad()
