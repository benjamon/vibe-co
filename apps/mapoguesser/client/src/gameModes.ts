import type { GameMode } from './store'

// ---------------------------------------------------------------------------
// DATA-DRIVEN GAME MODES
// ---------------------------------------------------------------------------
// A "sub-mode" is just a named pool of things to guess layered on top of one of
// the two underlying behaviours:
//   - 'countries' family → locate the COUNTRY on the globe (9 rounds, hit/miss)
//   - 'cities'    family → locate the CAPITAL city (5 rounds, golf-scored)
//
// World Cup was the first example of this idea (country guessing with a
// different list of countries); every regional mode below is the same pattern.
//
// To add or reshape a mode, edit the `pool` array here — nothing else needs to
// change. Country names MUST match Natural Earth's NAME field exactly (the same
// strings the globe loads); a name that doesn't load is simply skipped, so a
// typo just drops that one entry rather than breaking the mode.
// ---------------------------------------------------------------------------

export type ModeFamily = 'countries' | 'cities'

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
  //   'worldcup'  → the World Cup qualifier set
  //   string[]    → an explicit list of Natural Earth country NAMEs
  pool?: 'all' | 'worldcup' | string[]
  // CITIES family — which cities are in play (see CitySpec).
  cities?: CitySpec
}

// The behaviour (round count, scoring, HUD, map label) each family maps onto.
// Only the dedicated World Cup sub-mode keeps the 'worldcup' branding; every
// other country region behaves like 'classic'.
export const behavioralModeOf = (sm: SubMode): GameMode =>
  sm.family === 'cities' ? 'capitals' : sm.id === 'worldcup' ? 'worldcup' : 'classic'

// ---- COUNTRIES: locate the country on the globe. --------------------------
const COUNTRY_SUBMODES: SubMode[] = [
  { id: 'all', label: 'All', icon: '🌐', blurb: 'Every country on the globe', family: 'countries', pool: 'all' },
  { id: 'worldcup', label: 'World Cup', icon: '⚽', blurb: 'The 2026 World Cup qualifiers', family: 'countries', pool: 'worldcup' },
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
      'Paraguay', 'Uruguay', 'Argentina', 'Chile',
    ],
  },
  {
    id: 'europe',
    label: 'Europe',
    icon: '🏰',
    blurb: 'Countries of Europe',
    family: 'countries',
    pool: [
      'Iceland', 'Ireland', 'United Kingdom', 'Portugal', 'Spain', 'France',
      'Belgium', 'Netherlands', 'Germany', 'Switzerland', 'Austria', 'Italy',
      'Denmark', 'Norway', 'Sweden', 'Finland', 'Poland', 'Czechia', 'Hungary',
      'Romania', 'Ukraine', 'Greece', 'Croatia', 'Serbia',
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
      'Madagascar', 'Namibia', 'Botswana', 'South Africa',
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
      'New Zealand', 'Papua New Guinea', 'Fiji', 'Samoa',
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
    label: 'North America',
    icon: '🗽',
    blurb: 'Largest US & North American cities',
    family: 'cities',
    cities: {
      countries: [
        'United States of America', 'Canada', 'Mexico', 'Guatemala', 'Belize',
        'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama', 'Cuba',
        'Bahamas', 'Jamaica', 'Haiti', 'Dominican Rep.',
      ],
      minPopulation: 100_000,
      limit: 50,
      // The largest cities here are overwhelmingly US — show state lines to help.
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
      limit: 50,
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
      limit: 50,
    },
  },
]

export const SUB_MODES: SubMode[] = [...COUNTRY_SUBMODES, ...CITY_SUBMODES]

export const subModesFor = (family: ModeFamily): SubMode[] =>
  SUB_MODES.filter((m) => m.family === family)

const BY_ID = new Map(SUB_MODES.map((m) => [m.id, m]))

// Resolve a selection string to a sub-mode. Accepts a sub-mode id, or a legacy
// GameMode string ('classic'/'worldcup'/'capitals') for backward compatibility
// with old callers, saves, and shared URLs. Defaults to the "All" countries
// sub-mode.
export const resolveSubMode = (sel: string | undefined): SubMode => {
  if (sel) {
    const direct = BY_ID.get(sel)
    if (direct) return direct
    if (sel === 'capitals') return BY_ID.get('world-capitals')!
    if (sel === 'worldcup') return BY_ID.get('worldcup')!
    // 'classic' and anything unknown fall through to All.
  }
  return BY_ID.get('all')!
}
