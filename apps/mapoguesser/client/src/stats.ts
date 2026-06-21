/**
 * SpacetimeDB-backed stats for mapoguesser.
 *
 * Every guess the player makes is recorded to a maincloud SpacetimeDB module
 * (see ../../server). We keep two rolling aggregate snapshots in memory:
 *   - `global` — per-country totals across all users
 *   - `mine`   — per-country totals for this client's random user id
 * and can pull up to the most-recent 200 raw guesses for a single country on
 * demand (for painting dots on the globe in "global" mode).
 *
 * The module is connected lazily and degrades gracefully: if the network is
 * down or the bindings are missing, recording no-ops and the snapshots stay
 * empty, so the game (which keeps its own localStorage stats) still works.
 *
 * Mirrors the connection/lazy-import pattern used by sky-strike's highscore.ts.
 */

const USER_ID_KEY = 'mapoguesser:userId'

// maincloud module published as `mapoguesser-stats` (see server/package.json).
const DEFAULT_URI = 'wss://maincloud.spacetimedb.com'
const DEFAULT_DB = 'mapoguesser-stats'
const SPACETIME_URI_KEY = 'mapoguesser:spacetimeUri'
const SPACETIME_DB_KEY = 'mapoguesser:spacetimeDb'

function readLocalStorage(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  } catch {
    /* quota / unavailable — ignore */
  }
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // RFC4122-ish fallback for environments without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// The random user id is generated once and persisted locally. It is the key
// used to record and retrieve this player's per-country stats from the server.
let cachedUserId: string | null = null
export function getUserId(): string {
  if (cachedUserId) return cachedUserId
  let id = readLocalStorage(USER_ID_KEY)
  if (!id) {
    id = uuid()
    writeLocalStorage(USER_ID_KEY, id)
  }
  cachedUserId = id
  return id
}

// ---------- snapshots ----------

export interface CountryAgg {
  correct: number
  total: number
}

export interface StatsSnapshot {
  // Keyed by country name (the Natural Earth NAME, stable across clients).
  global: Record<string, CountryAgg>
  mine: Record<string, CountryAgg>
}

export interface GuessDot {
  target: string
  guess: string
  correct: boolean
  lat: number
  lon: number
}

let globalStats: Record<string, CountryAgg> = {}
let myStats: Record<string, CountryAgg> = {}

type StatsListener = (snap: StatsSnapshot) => void
const statsListeners = new Set<StatsListener>()

function snapshot(): StatsSnapshot {
  return { global: globalStats, mine: myStats }
}

function notifyStats(): void {
  const snap = snapshot()
  for (const fn of statsListeners) fn(snap)
}

export function subscribeStats(fn: StatsListener): () => void {
  statsListeners.add(fn)
  fn(snapshot())
  return () => {
    statsListeners.delete(fn)
  }
}

// Per-country guess dots, exposed to whoever paints the globe.
type GuessesListener = (country: string | null, guesses: GuessDot[]) => void
const guessesListeners = new Set<GuessesListener>()
let selectedCountry: string | null = null

function notifyGuesses(): void {
  const guesses = selectedCountry ? readCountryGuesses(selectedCountry) : []
  for (const fn of guessesListeners) fn(selectedCountry, guesses)
}

export function subscribeCountryGuesses(fn: GuessesListener): () => void {
  guessesListeners.add(fn)
  fn(selectedCountry, selectedCountry ? readCountryGuesses(selectedCountry) : [])
  return () => {
    guessesListeners.delete(fn)
  }
}

// ---------- connection ----------

type AnyConn = any

let connection: AnyConn | null = null
let connectAttempted = false
// Guesses made before the connection is live are buffered and flushed on
// connect so the very first rounds aren't silently dropped.
const pending: GuessDot[] = []
// Active subscription handle for the currently-selected country's guesses.
let guessSub: { unsubscribe: () => void; isActive?: () => boolean } | null = null

function tableHandle(name: 'countryStat' | 'userCountryStat' | 'guess'): AnyConn {
  if (!connection) return null
  const db = connection.db
  // The generated accessor may be camelCase or snake_case depending on the
  // SDK's case-conversion policy; accept either.
  switch (name) {
    case 'countryStat':
      return db.countryStat ?? db.country_stat ?? null
    case 'userCountryStat':
      return db.userCountryStat ?? db.user_country_stat ?? null
    case 'guess':
      return db.guess ?? null
  }
}

function aggFromRow(row: AnyConn): { country: string; agg: CountryAgg } | null {
  const country = row?.country
  if (typeof country !== 'string') return null
  const correct = Number(row.correct ?? 0)
  const total = Number(row.total ?? 0)
  return { country, agg: { correct, total } }
}

function refreshGlobal(): void {
  const tbl = tableHandle('countryStat')
  if (!tbl) return
  const next: Record<string, CountryAgg> = {}
  try {
    for (const row of tbl.iter()) {
      const parsed = aggFromRow(row)
      if (parsed) next[parsed.country] = parsed.agg
    }
    globalStats = next
    notifyStats()
  } catch (e) {
    console.warn('[stats] global iter failed:', e)
  }
}

function refreshMine(): void {
  const tbl = tableHandle('userCountryStat')
  if (!tbl) return
  const myId = getUserId()
  const next: Record<string, CountryAgg> = {}
  try {
    for (const row of tbl.iter()) {
      if ((row.userId ?? row.user_id) !== myId) continue
      const parsed = aggFromRow(row)
      if (parsed) next[parsed.country] = parsed.agg
    }
    myStats = next
    notifyStats()
  } catch (e) {
    console.warn('[stats] mine iter failed:', e)
  }
}

function readCountryGuesses(country: string): GuessDot[] {
  const tbl = tableHandle('guess')
  if (!tbl) return []
  const out: GuessDot[] = []
  try {
    for (const row of tbl.iter()) {
      if (row.target !== country) continue
      const lat = Number(row.lat)
      const lon = Number(row.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
      out.push({
        target: row.target,
        guess: row.guess,
        correct: Boolean(row.correct),
        lat,
        lon,
      })
    }
  } catch (e) {
    console.warn('[stats] guess iter failed:', e)
  }
  return out
}

export async function connectStats(): Promise<void> {
  if (connectAttempted) return
  connectAttempted = true
  // Static import path so Vite bundles the generated bindings into the
  // production build (a dynamic string would be omitted and 404 on Pages).
  let bindings: AnyConn = null
  try {
    bindings = await import('./module_bindings')
  } catch (e) {
    console.warn('[stats] module_bindings not available:', e)
    return
  }
  if (!bindings?.DbConnection?.builder) return
  const uri = readLocalStorage(SPACETIME_URI_KEY) ?? DEFAULT_URI
  const dbName = readLocalStorage(SPACETIME_DB_KEY) ?? DEFAULT_DB
  const myId = getUserId()
  try {
    bindings.DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(dbName)
      .onConnectError((_ctx: unknown, err: unknown) => {
        console.warn('[stats] connect error:', err)
      })
      .onDisconnect(() => {
        console.warn('[stats] disconnected')
      })
      .onConnect((conn: AnyConn) => {
        connection = conn
        console.log('[stats] connected to', uri, '-', dbName)

        const onGlobal = () => refreshGlobal()
        const onMine = () => refreshMine()
        try {
          const g = tableHandle('countryStat')
          g?.onInsert?.(onGlobal)
          g?.onUpdate?.(onGlobal)
          g?.onDelete?.(onGlobal)
          const u = tableHandle('userCountryStat')
          u?.onInsert?.(onMine)
          u?.onUpdate?.(onMine)
          u?.onDelete?.(onMine)
          const gs = tableHandle('guess')
          gs?.onInsert?.(() => notifyGuesses())
          gs?.onDelete?.(() => notifyGuesses())
        } catch (e) {
          console.warn('[stats] failed to register row callbacks:', e)
        }

        try {
          conn
            .subscriptionBuilder()
            .onApplied(() => {
              refreshGlobal()
              refreshMine()
            })
            .subscribe([
              'SELECT * FROM country_stat',
              `SELECT * FROM user_country_stat WHERE user_id = '${myId.replace(/'/g, "''")}'`,
            ])
        } catch (e) {
          console.warn('[stats] subscribe failed:', e)
        }

        // Flush any guesses recorded before we connected.
        if (pending.length > 0) {
          const queued = pending.splice(0, pending.length)
          for (const g of queued) sendGuess(g)
        }
        // If a country was already selected for the map, open its subscription.
        if (selectedCountry) selectGlobalCountryGuesses(selectedCountry)
      })
      .build()
  } catch (e) {
    console.warn('[stats] build failed:', e)
  }
}

function reducers(): AnyConn {
  return connection?.reducers ?? null
}

function sendGuess(g: GuessDot): void {
  const r = reducers()
  if (!r) return
  const args = {
    userId: getUserId(),
    target: g.target,
    guess: g.guess,
    lat: g.lat,
    lon: g.lon,
  }
  try {
    if (typeof r.recordGuess === 'function') r.recordGuess(args)
    else if (typeof r.record_guess === 'function') r.record_guess(args)
  } catch (e) {
    console.warn('[stats] record_guess failed:', e)
  }
}

// Record one guess to the server. `target` is the country the player was asked
// to find; `guess` is the country they clicked.
export function recordGuess(
  target: string,
  guess: string,
  lat: number,
  lon: number,
): void {
  if (!target || !guess) return
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
  const dot: GuessDot = {
    target,
    guess,
    correct: target === guess,
    lat,
    lon,
  }
  if (!connection) {
    // Bound the buffer so a long offline session can't grow without limit.
    if (pending.length < 256) pending.push(dot)
    return
  }
  sendGuess(dot)
}

// Open (or switch) a subscription for one country's most-recent guesses so the
// globe can paint them. Passing null clears the current selection. The server
// caps each country at 200 stored guesses, so this returns at most that many.
export function selectGlobalCountryGuesses(country: string | null): void {
  selectedCountry = country
  // Tear down the previous per-country subscription.
  if (guessSub) {
    try {
      if (guessSub.isActive?.() ?? true) guessSub.unsubscribe()
    } catch {
      /* already ended */
    }
    guessSub = null
  }
  if (!country) {
    notifyGuesses()
    return
  }
  if (!connection) {
    // Not connected yet — connectStats() re-invokes us once live.
    notifyGuesses()
    return
  }
  try {
    guessSub = connection
      .subscriptionBuilder()
      .onApplied(() => notifyGuesses())
      .subscribe([
        `SELECT * FROM guess WHERE target = '${country.replace(/'/g, "''")}'`,
      ])
  } catch (e) {
    console.warn('[stats] country guess subscribe failed:', e)
  }
  // Paint whatever is already cached immediately; onApplied refreshes it.
  notifyGuesses()
}
