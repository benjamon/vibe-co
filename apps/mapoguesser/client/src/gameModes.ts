import type { GameMode } from './store'

// ---------------------------------------------------------------------------
// DATA-DRIVEN GAME MODES
// ---------------------------------------------------------------------------
// A "sub-mode" is just a named pool of things to guess layered on top of one of
// the underlying behaviours:
//   - 'countries' family → locate the COUNTRY on the globe (9 rounds, hit/miss)
//   - 'cities'    family → locate the CAPITAL city (5 rounds, golf-scored)
//   - 'states'    family → locate the US STATE on the globe (same behaviour as
//                          'countries', just a different polygon dataset)
//   - 'draw'      family → freehand-DRAW the country's outline from memory (5
//                          rounds, scored by % overlap with the real shape)
//
// To add or reshape a mode, edit the `pool` array here — nothing else needs to
// change. Country names MUST match Natural Earth's NAME field exactly (the same
// strings the globe loads); a name that doesn't load is simply skipped, so a
// typo just drops that one entry rather than breaking the mode.
// ---------------------------------------------------------------------------

export type ModeFamily = 'countries' | 'cities' | 'states' | 'draw'

// How a 'cities'-family sub-mode picks which cities are in play. Cities come
// from the population-ranked populated-places dataset, so a region mode is just
// "the N largest cities within these countries".
export interface CitySpec {
  // Only national capitals (World Capitals). Ignores population ranking.
  capitalsOnly?: boolean
  // Restrict to cities in these Natural Earth country NAMEs (undefined = world).
  countries?: string[]
  // Drop cities smaller than this (pop_max). Trims noise from the long tail.
  minPopulation?: number
  // After filtering, keep only the N largest by population — the eligible pool
  // each match then draws a random handful from.
  limit?: number
  // Fold every admin-1 (US state) capital into the pool on top of the top-N,
  // ignoring minPopulation/limit, deduped by city. So "top 100 cities + all 50
  // state capitals", with the capitals already in the top 100 not repeated.
  includeStateCapitals?: boolean
  // Draw US state/province boundary lines on the globe while this mode is
  // active (and only this mode) — a locating aid for US-heavy city sets.
  usStateLines?: boolean
}

export interface SubMode {
  // Stable id, mirrored to the URL as `sm=<id>` so a shared link reproduces the
  // same match. Must be unique across BOTH families.
  id: string
  // Menu + results-screen label (no emoji — the icon is separate).
  label: string
  // Emoji shown next to the label in the menu and on the multiplayer vote cards.
  icon: string
  // One-line description for the multiplayer vote cards.
  blurb: string
  family: ModeFamily
  // COUNTRIES family — how the draw pool is built:
  //   'all'       → every playable country
  //   string[]    → an explicit list of Natural Earth country NAMEs
  pool?: 'all' | string[]
  // CITIES family — which cities are in play (see CitySpec).
  cities?: CitySpec
}

// The behaviour (round count, scoring, HUD, map label) each family maps onto.
export const behavioralModeOf = (sm: SubMode): GameMode =>
  sm.family === 'cities' ? 'capitals' : sm.family === 'draw' ? 'draw' : 'classic'

// ---- COUNTRIES: locate the country on the globe. --------------------------
const COUNTRY_SUBMODES: SubMode[] = [
  { id: 'all', label: 'All', icon: '🌐', blurb: 'Every country on the globe', family: 'countries', pool: 'all' },
  {
    id: 'americas',
    label: 'The Americas',
    icon: '🌎',
    blurb: 'Countries of the Americas',
    family: 'countries',
    // North → South America, a broad well-known assortment.
    pool: [
      'United States of America', 'Canada', 'Mexico', 'Guatemala', 'Honduras',
      'Costa Rica', 'Panama', 'Cuba', 'Dominican Rep.', 'Haiti', 'Jamaica',
      'Colombia', 'Venezuela', 'Ecuador', 'Peru', 'Bolivia', 'Brazil',
      'Paraguay', 'Uruguay', 'Argentina', 'Chile', 'Guyana', 'Suriname',
      'Trinidad and Tobago', 'Bahamas', 'Falkland Is.', 'S. Geo. and the Is.',
    ],
  },
  {
    id: 'europe',
    label: 'Europe+',
    icon: '🏰',
    blurb: 'Countries of Europe',
    family: 'countries',
    pool: [
      'Iceland', 'Ireland', 'United Kingdom', 'Portugal', 'Spain', 'France',
      'Belgium', 'Netherlands', 'Germany', 'Switzerland', 'Austria', 'Italy',
      'Denmark', 'Norway', 'Sweden', 'Finland', 'Poland', 'Czechia', 'Hungary',
      'Romania', 'Ukraine', 'Greece', 'Croatia', 'Serbia', 'Albania', 'Slovenia',
      'Slovakia', 'Kosovo', 'Bulgaria', 'Belarus', 'Moldova', 'Latvia', 'North Cyprus',
      'Cyprus', 'Faeroe Is.', 'Luxembourg', 'Åland', 'Lithuania', 'Estonia'
    ],
  },
  {
    id: 'africa',
    label: 'Africa',
    icon: '🦁',
    blurb: 'Countries of Africa',
    family: 'countries',
    pool: [
      'Morocco', 'Algeria', 'Tunisia', 'Libya', 'Egypt', 'Mauritania', 'Mali',
      'Niger', 'Chad', 'Sudan', 'Senegal', 'Guinea', "Côte d'Ivoire", 'Ghana',
      'Nigeria', 'Cameroon', 'Ethiopia', 'Kenya', 'Tanzania', 'Uganda',
      'Dem. Rep. Congo', 'Angola', 'Zambia', 'Zimbabwe', 'Mozambique',
      'Madagascar', 'Namibia', 'Botswana', 'South Africa', 'Rwanda', 'Burundi',
      'Lesotho', 'eSwatini', 'Benin', 'Togo', 'Guinea-Bissau', 'Eq. Guinea',
      'Djibouti', 'Eritrea', 'Liberia', 'West Sahara', 'Burkina Faso', 
      'Central African Rep.',  'Gambia', 'Somalia', 'Somaliland',
      'Sierra Leone', 'Gabon', 'Congo', 'Cabo Verde', 'Comoros', 'Mauritius',
      'Malawi'
    ],
  },
  {
    id: 'asia',
    label: 'Asia',
    icon: '🏯',
    blurb: 'Asia, the Middle East & Oceania',
    family: 'countries',
    // Asia proper + the Middle East + the Australasian/Pacific islands.
    pool: [
      'Turkey', 'Israel', 'Jordan', 'Saudi Arabia', 'United Arab Emirates',
      'Iraq', 'Iran', 'Kazakhstan', 'Uzbekistan', 'Afghanistan', 'Pakistan',
      'India', 'Nepal', 'Bangladesh', 'Sri Lanka', 'Myanmar', 'Thailand',
      'Cambodia', 'Vietnam', 'Malaysia', 'Indonesia', 'Philippines', 'China',
      'Mongolia', 'North Korea', 'South Korea', 'Japan', 'Australia',
      'New Zealand', 'Papua New Guinea', 'Fiji', 'Samoa', 'Turkmenistan',
      'Kyrgystan', 'Tajikistan', 'Armenia', 'Qatar', 'Kuwait', 'Azerbaijan',
      'Georgia', 'Siachen Glacier', 'Brunei', 'Timor-Leste', 'Fr. Polynesia',
    ],
  },
]

// ---- CITIES: locate a city on the globe. ----------------------------------
// World Capitals is capitals-only; the regional modes are the largest cities
// (capital or not) within a set of countries — so the US mode surfaces New York,
// Los Angeles, Chicago, … not just Washington.
const CITY_SUBMODES: SubMode[] = [
  { id: 'world-capitals', label: 'World Capitals', icon: '📍', blurb: 'Drop a pin on the capital — closest wins', family: 'cities', cities: { capitalsOnly: true } },
  {
    id: 'cities-north-america',
    label: 'United States',
    icon: '🗽',
    blurb: 'Every state capital + the 100 largest US cities',
    family: 'cities',
    cities: {
      countries: [
        'United States of America',
      ],
      // Top 100 by population, plus all 50 state capitals (+ D.C.) even when
      // tiny — deduped so a capital in the top 100 isn't listed twice.
      limit: 100,
      includeStateCapitals: true,
      usStateLines: true,
    },
  },
  {
    id: 'cities-latin-america',
    label: 'Latin America',
    icon: '🌆',
    blurb: 'Largest Latin American cities',
    family: 'cities',
    // Central + South America.
    cities: {
      countries: [
        'Mexico', 'Guatemala', 'Honduras', 'El Salvador', 'Nicaragua',
        'Costa Rica', 'Panama', 'Cuba', 'Dominican Rep.', 'Haiti', 'Colombia',
        'Venezuela', 'Ecuador', 'Peru', 'Bolivia', 'Brazil', 'Paraguay',
        'Uruguay', 'Argentina', 'Chile',
      ],
      minPopulation: 100_000,
      limit: 100,
    },
  },
  {
    id: 'cities-europe',
    label: 'Europe',
    icon: '🏙️',
    blurb: 'Largest European cities',
    family: 'cities',
    cities: {
      countries: [
        'Ireland', 'United Kingdom', 'Portugal', 'Spain', 'France', 'Belgium',
        'Netherlands', 'Germany', 'Switzerland', 'Austria', 'Italy', 'Denmark',
        'Norway', 'Sweden', 'Finland', 'Poland', 'Czechia', 'Hungary', 'Greece',
        'Ukraine', 'Romania', 'Croatia', 'Serbia',
      ],
      minPopulation: 100_000,
      limit: 100,
    },
  },
]

// ---- STATES: locate the US state on the globe. -----------------------------
// Same behaviour as the countries family (classic, 9 rounds, hit/miss) — just
// a different polygon dataset (US state borders instead of country borders)
// wired up in WorldViewer.tsx / store.ts wherever `family === 'states'`.
const STATE_SUBMODES: SubMode[] = [
  {
    id: 'us-states',
    label: 'US States',
    icon: '🗺️',
    blurb: 'Every US state',
    family: 'states',
    pool: 'all',
  },
]

// ---- DRAW: freehand-trace the country's outline from memory. ---------------
// A curated list rather than "All" or a region — picked for shapes that are
// distinctive enough to draw from memory and geometrically simple enough for
// a freehand-drawn loop to score meaningfully against (no razor-thin slivers,
// no sprawling archipelagos, nothing that crosses the antimeridian).
const DRAW_SUBMODES: SubMode[] = [
  {
    id: 'draw-countries',
    label: 'Draw the Border',
    icon: '✏️',
    blurb: 'Freehand-trace a country’s outline from memory',
    family: 'draw',
    pool: [
      'Egypt', 'Italy', 'Spain', 'Portugal', 'France', 'United Kingdom',
      'Ireland', 'Norway', 'Iceland', 'Greece', 'India', 'China', 'Japan',
      'South Korea', 'Thailand', 'Saudi Arabia', 'Turkey', 'Sri Lanka',
      'United States of America', 'Canada', 'Mexico', 'Brazil', 'Argentina',
      'Chile', 'Cuba', 'South Africa', 'Madagascar', 'Somalia', 'Kenya',
      'Australia', 'New Zealand',
    ],
  },
]

export const SUB_MODES: SubMode[] = [
  ...COUNTRY_SUBMODES,
  ...CITY_SUBMODES,
  ...STATE_SUBMODES,
  ...DRAW_SUBMODES,
]

export const subModesFor = (family: ModeFamily): SubMode[] =>
  SUB_MODES.filter((m) => m.family === family)

const BY_ID = new Map(SUB_MODES.map((m) => [m.id, m]))

// Resolve a selection string to a sub-mode. Accepts a sub-mode id, or a legacy
// GameMode string ('classic'/'capitals') for backward compatibility with old
// callers, saves, and shared URLs. Defaults to the "All" countries sub-mode —
// this also gracefully absorbs old 'worldcup' saves/links (now removed) into
// the classic All pool instead of erroring.
export const resolveSubMode = (sel: string | undefined): SubMode => {
  if (sel) {
    const direct = BY_ID.get(sel)
    if (direct) return direct
    if (sel === 'capitals') return BY_ID.get('world-capitals')!
    // 'classic' and anything unknown (incl. the retired 'worldcup') fall
    // through to All.
  }
  return BY_ID.get('all')!
}
