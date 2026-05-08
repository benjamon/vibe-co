import type { RunBuild } from './store'

export interface HighScoreEntry {
  userId: string
  name: string
  score: number
  build: RunBuild
  timestamp: number
  source: 'local' | 'remote'
}

const USER_ID_KEY = 'skyStrike.userId'
const USER_NAME_KEY = 'skyStrike.userName'
const LOCAL_SCORES_KEY = 'skyStrike.localHighscores'
const SPACETIME_URI_KEY = 'skyStrike.spacetimeUri'
const SPACETIME_DB_KEY = 'skyStrike.spacetimeDb'

const DEFAULT_URI = 'wss://maincloud.spacetimedb.com'
const DEFAULT_DB = 'ss-hs-70fxp'
const MAX_LOCAL_SCORES = 50

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // RFC4122-ish fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

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

let cachedUserName: string | null = null
export function getUserName(): string {
  if (cachedUserName) return cachedUserName
  let name = readLocalStorage(USER_NAME_KEY)
  if (!name) {
    const idTail = getUserId().replace(/-/g, '').slice(0, 4).toUpperCase()
    name = `PILOT-${idTail}`
    writeLocalStorage(USER_NAME_KEY, name)
  }
  cachedUserName = name
  return name
}

const nameListeners = new Set<(name: string) => void>()

export function subscribeUserName(fn: (name: string) => void): () => void {
  nameListeners.add(fn)
  fn(getUserName())
  return () => {
    nameListeners.delete(fn)
  }
}

export function setUserName(name: string): void {
  const trimmed = name.trim().slice(0, 24)
  if (!trimmed) return
  if (trimmed === cachedUserName) return
  cachedUserName = trimmed
  writeLocalStorage(USER_NAME_KEY, trimmed)
  // Rename any local entries owned by this user so the panel reflects the
  // change immediately. Remote rows update once the user beats their score.
  const userId = getUserId()
  let changed = false
  for (const entry of localScores) {
    if (entry.userId === userId && entry.name !== trimmed) {
      entry.name = trimmed
      changed = true
    }
  }
  if (changed) writeLocalScores(localScores)
  for (const fn of nameListeners) fn(trimmed)
  notifyListeners()
}

function readLocalScores(): HighScoreEntry[] {
  const raw = readLocalStorage(LOCAL_SCORES_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((e) => e && typeof e.score === 'number' && typeof e.userId === 'string')
      .map((e) => ({
        userId: String(e.userId),
        name: typeof e.name === 'string' ? e.name : 'PILOT',
        score: Math.max(0, Math.floor(e.score)),
        build: e.build && typeof e.build === 'object' ? (e.build as RunBuild) : {},
        timestamp: typeof e.timestamp === 'number' ? e.timestamp : Date.now(),
        source: 'local' as const,
      }))
  } catch {
    return []
  }
}

function writeLocalScores(scores: HighScoreEntry[]): void {
  writeLocalStorage(LOCAL_SCORES_KEY, JSON.stringify(scores))
}

let localScores: HighScoreEntry[] = readLocalScores()
let remoteScores: HighScoreEntry[] = []

type Listener = (scores: HighScoreEntry[]) => void
const listeners = new Set<Listener>()

function combinedScores(): HighScoreEntry[] {
  // Remote replaces local rows for the same user when present (server is authoritative
  // for the player's best). Other-user remote rows simply add to the list.
  const byUser = new Map<string, HighScoreEntry>()
  for (const s of localScores) byUser.set(s.userId, s)
  for (const s of remoteScores) byUser.set(s.userId, s)
  return [...byUser.values()].sort((a, b) => b.score - a.score)
}

function notifyListeners(): void {
  const scores = combinedScores()
  for (const fn of listeners) fn(scores)
}

export function subscribeHighscores(fn: Listener): () => void {
  listeners.add(fn)
  fn(combinedScores())
  return () => {
    listeners.delete(fn)
  }
}

export function getHighscores(): HighScoreEntry[] {
  return combinedScores()
}

function upsertLocal(entry: HighScoreEntry): boolean {
  const idx = localScores.findIndex((s) => s.userId === entry.userId)
  if (idx >= 0) {
    if (entry.score <= localScores[idx].score) return false
    localScores[idx] = entry
  } else {
    localScores.push(entry)
  }
  localScores.sort((a, b) => b.score - a.score)
  if (localScores.length > MAX_LOCAL_SCORES) localScores = localScores.slice(0, MAX_LOCAL_SCORES)
  writeLocalScores(localScores)
  return true
}

// ---------- SpacetimeDB connection ----------

type AbilityRow = {
  code?: string
  picks?: number | bigint
  passes?: number | bigint
}

type UserAbilityRow = AbilityRow & {
  user_id?: string
  userId?: string
}

type AbilityTable = {
  iter: () => Iterable<AbilityRow>
  onInsert?: Function
  onUpdate?: Function
  onDelete?: Function
}

type UserAbilityTable = {
  iter: () => Iterable<UserAbilityRow>
  onInsert?: Function
  onUpdate?: Function
  onDelete?: Function
}

type RemoteConnection = {
  reducers: {
    submitScore?: (args: SubmitArgs) => void
    submit_score?: (args: SubmitArgs) => void
    votePair?: (args: VoteArgs) => void
    vote_pair?: (args: VoteArgs) => void
  }
  db: {
    highscore: { iter: () => Iterable<RemoteRow>; onInsert?: Function; onUpdate?: Function }
    ability_pref?: AbilityTable
    abilityPref?: AbilityTable
    user_ability_pref?: UserAbilityTable
    userAbilityPref?: UserAbilityTable
  }
  subscriptionBuilder?: () => { subscribe: (queries: string[]) => void }
}

export interface AbilityStat {
  code: string
  picks: number
  passes: number
}

export interface AbilityStatsSnapshot {
  global: AbilityStat[]
  user: AbilityStat[]
}

type RemoteRow = {
  user_id?: string
  userId?: string
  name?: string
  score?: number | bigint
  build?: string
  timestamp?: number | bigint
}

type SubmitArgs = {
  user_id?: string
  userId?: string
  name: string
  score: number
  build: string
}

type VoteArgs = {
  user_id?: string
  userId?: string
  picked_code?: string
  pickedCode?: string
  passed_code?: string
  passedCode?: string
}

let connection: RemoteConnection | null = null
let connectAttempted = false

function rowToEntry(row: RemoteRow): HighScoreEntry | null {
  const userId = row.user_id ?? row.userId
  if (!userId) return null
  const score = typeof row.score === 'bigint' ? Number(row.score) : Number(row.score ?? 0)
  let build: RunBuild = {}
  if (typeof row.build === 'string' && row.build.length > 0) {
    try {
      const parsed = JSON.parse(row.build)
      if (parsed && typeof parsed === 'object') build = parsed as RunBuild
    } catch {
      /* leave empty */
    }
  }
  const ts = typeof row.timestamp === 'bigint' ? Number(row.timestamp) : Number(row.timestamp ?? 0)
  return {
    userId,
    name: typeof row.name === 'string' ? row.name : 'PILOT',
    score,
    build,
    timestamp: ts,
    source: 'remote',
  }
}

let globalAbilityStats: AbilityStat[] = []
let userAbilityStats: AbilityStat[] = []

type StatsListener = (snap: AbilityStatsSnapshot) => void
const statsListeners = new Set<StatsListener>()

function notifyStatsListeners(): void {
  const snap: AbilityStatsSnapshot = { global: globalAbilityStats, user: userAbilityStats }
  for (const fn of statsListeners) fn(snap)
}

export function subscribeAbilityStats(fn: StatsListener): () => void {
  statsListeners.add(fn)
  fn({ global: globalAbilityStats, user: userAbilityStats })
  return () => {
    statsListeners.delete(fn)
  }
}

function toAbilityStat(row: AbilityRow): AbilityStat | null {
  if (!row.code) return null
  const picks = typeof row.picks === 'bigint' ? Number(row.picks) : Number(row.picks ?? 0)
  const passes = typeof row.passes === 'bigint' ? Number(row.passes) : Number(row.passes ?? 0)
  return { code: row.code, picks, passes }
}

function refreshAbilityStats(): void {
  if (!connection) return
  const globalTable = connection.db.ability_pref ?? connection.db.abilityPref
  const userTable = connection.db.user_ability_pref ?? connection.db.userAbilityPref
  try {
    if (globalTable) {
      globalAbilityStats = Array.from(globalTable.iter())
        .map(toAbilityStat)
        .filter((s): s is AbilityStat => s !== null)
    }
  } catch (e) {
    console.warn('[stats] global iter failed:', e)
  }
  const myId = getUserId()
  try {
    if (userTable) {
      userAbilityStats = Array.from(userTable.iter())
        .filter((r) => (r.user_id ?? r.userId) === myId)
        .map(toAbilityStat)
        .filter((s): s is AbilityStat => s !== null)
    }
  } catch (e) {
    console.warn('[stats] user iter failed:', e)
  }
  notifyStatsListeners()
}

function refreshRemoteScores(): void {
  if (!connection) return
  try {
    const rows = Array.from(connection.db.highscore.iter())
    remoteScores = rows
      .map(rowToEntry)
      .filter((e): e is HighScoreEntry => e !== null)
    console.log(`[highscore] cache holds ${remoteScores.length} remote row(s)`)
    notifyListeners()
  } catch (e) {
    console.warn('[highscore] iter failed:', e)
  }
}

export async function connectToHighscoreServer(): Promise<void> {
  if (connectAttempted) return
  connectAttempted = true
  // Static path so Vite resolves and bundles the generated bindings into the
  // production build (with @vite-ignore + a runtime string concat the chunk
  // would be omitted from the bundle and the GitHub Pages build would 404 on
  // the fetch).
  let bindings: any = null
  try {
    bindings = await import('./module_bindings')
  } catch (e) {
    console.warn('[highscore] module_bindings not available:', e)
    return
  }
  if (!bindings?.DbConnection?.builder) return
  const uri = readLocalStorage(SPACETIME_URI_KEY) ?? DEFAULT_URI
  const dbName = readLocalStorage(SPACETIME_DB_KEY) ?? DEFAULT_DB
  try {
    const builder = bindings.DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(dbName)
      .onConnectError((_ctx: unknown, err: unknown) => {
        console.warn('[highscore] connect error:', err)
      })
      .onDisconnect(() => {
        console.warn('[highscore] disconnected')
      })
      .onConnect((conn: RemoteConnection) => {
        connection = conn
        console.log('[highscore] connected to', uri, '-', dbName)
        const onChange = () => refreshRemoteScores()
        try {
          conn.db.highscore.onInsert?.(onChange)
          conn.db.highscore.onUpdate?.(onChange)
        } catch (e) {
          console.warn('[highscore] failed to register row callbacks:', e)
        }
        const onStatsChange = () => refreshAbilityStats()
        try {
          const globalTable = conn.db.ability_pref ?? conn.db.abilityPref
          globalTable?.onInsert?.(onStatsChange)
          globalTable?.onUpdate?.(onStatsChange)
          globalTable?.onDelete?.(onStatsChange)
          const userTable = conn.db.user_ability_pref ?? conn.db.userAbilityPref
          userTable?.onInsert?.(onStatsChange)
          userTable?.onUpdate?.(onStatsChange)
          userTable?.onDelete?.(onStatsChange)
        } catch (e) {
          console.warn('[stats] failed to register row callbacks:', e)
        }
        const myId = getUserId()
        try {
          conn.subscriptionBuilder?.().subscribe([
            'SELECT * FROM highscore',
            'SELECT * FROM ability_pref',
            `SELECT * FROM user_ability_pref WHERE user_id = '${myId.replace(/'/g, "''")}'`,
          ])
        } catch (e) {
          console.warn('[highscore] subscribe failed:', e)
        }
      })
    builder.build()
  } catch (e) {
    console.warn('[highscore] build failed:', e)
  }
}

export function submitPreferenceVote(pickedCode: string, passedCode: string): void {
  if (!connection || !pickedCode || !passedCode || pickedCode === passedCode) return
  const userId = getUserId()
  const args: VoteArgs = {
    user_id: userId,
    userId,
    picked_code: pickedCode,
    pickedCode,
    passed_code: passedCode,
    passedCode,
  }
  try {
    connection.reducers.votePair?.(args)
    connection.reducers.vote_pair?.(args)
  } catch (e) {
    console.warn('[highscore] vote_pair failed:', e)
  }
}

export function submitHighscore(score: number, build: RunBuild): void {
  if (score <= 0) return
  const entry: HighScoreEntry = {
    userId: getUserId(),
    name: getUserName(),
    score: Math.floor(score),
    build,
    timestamp: Date.now(),
    source: 'local',
  }
  const beat = upsertLocal(entry)
  notifyListeners()
  if (!beat) return
  if (connection) {
    const args: SubmitArgs = {
      user_id: entry.userId,
      userId: entry.userId,
      name: entry.name,
      score: entry.score,
      build: JSON.stringify(build),
    }
    try {
      connection.reducers.submitScore?.(args)
      connection.reducers.submit_score?.(args)
    } catch (e) {
      console.warn('[highscore] submit failed:', e)
    }
  }
}
