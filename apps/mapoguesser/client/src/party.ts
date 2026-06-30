/**
 * "Play With Friends" multiplayer networking, backed by the same SpacetimeDB
 * module as stats (see ../../server). A party is a 4-char room: players gather
 * in a lobby, ready up, then race through the same ROUNDS-question match.
 *
 * The match draw is deterministic from the room `seed` (the client runs the
 * identical mulberry32 shuffle in store.ts), so the server tracks only the room
 * lifecycle — who's in it, the current question index, and a 30s deadline. Round
 * advancement is client-driven but idempotent (see advanceQuestion).
 *
 * Identity is per-TAB via sessionStorage rather than the shared localStorage id
 * stats.ts uses — two tabs on one origin share localStorage (so they'd collide
 * to a single player), but each tab gets its own sessionStorage, which is
 * exactly what local multi-player testing needs.
 *
 * Connection + lazy-import pattern mirrors stats.ts; it degrades gracefully when
 * offline (reducers no-op, snapshots stay empty).
 */

const DEFAULT_URI = 'wss://maincloud.spacetimedb.com'
const DEFAULT_DB = 'mapoguesser-stats'
const SPACETIME_URI_KEY = 'mapoguesser:spacetimeUri'
const SPACETIME_DB_KEY = 'mapoguesser:spacetimeDb'
const PARTY_ID_KEY = 'mapoguesser:partyUserId'
const PARTY_NAME_KEY = 'mapoguesser:partyName'

// Keep these in lockstep with the server module (PARTY_ROUNDS / QUESTION_MS)
// and the client store (ROUNDS). The 30s deadline is authoritative server-side;
// this constant only drives the local countdown display + when to call advance.
export const PARTY_ROUNDS = 9
export const QUESTION_MS = 30_000
export const MAX_PLAYER_NAME_LEN = 10
export const PARTY_CODE_LEN = 4

// Unambiguous code alphabet — no 0/O/1/I so a code is easy to read out loud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function readLocalStorage(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}

function readSession(key: string): string | null {
  try {
    return typeof sessionStorage === 'undefined'
      ? null
      : sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSession(key: string, value: string): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, value)
  } catch {
    /* private mode / unavailable — ignore */
  }
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Per-tab id, generated once per session. Distinct tabs → distinct players.
let cachedUserId: string | null = null
export function getPartyUserId(): string {
  if (cachedUserId) return cachedUserId
  let id = readSession(PARTY_ID_KEY)
  if (!id) {
    id = uuid()
    writeSession(PARTY_ID_KEY, id)
  }
  cachedUserId = id
  return id
}

export function getSavedName(): string {
  return readSession(PARTY_NAME_KEY) ?? ''
}
export function saveName(name: string): void {
  writeSession(PARTY_NAME_KEY, name.slice(0, MAX_PLAYER_NAME_LEN))
}

// 6-char base36 match seed — same shape store.generateSeed produces, so the
// deterministic draw lines up across all clients in the room.
export function generatePartySeed(): string {
  return Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0')
}

function randomCode(): string {
  let out = ''
  for (let i = 0; i < PARTY_CODE_LEN; i++) {
    out += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0]
  }
  return out
}

// ---------- snapshot types ----------

export type PartyPhase = 'lobby' | 'playing' | 'finished'

export interface PartyPlayer {
  userId: string
  name: string
  ready: boolean
  score: number
  joinedAt: number
}

export interface PartyRoom {
  code: string
  hostId: string
  seed: string
  phase: PartyPhase
  currentQuestion: number
  // Epoch ms when the active question stops accepting guesses (0 in lobby).
  questionDeadline: number
}

export interface PartySnapshot {
  room: PartyRoom | null
  players: PartyPlayer[]
  myUserId: string
}

// Emitted once per newly-observed guess row, for the toast feed.
export interface PartyGuessEvent {
  userId: string
  name: string
  question: number
  correct: boolean
}

// ---------- listeners ----------

type SnapshotListener = (snap: PartySnapshot) => void
const snapshotListeners = new Set<SnapshotListener>()
type GuessListener = (e: PartyGuessEvent) => void
const guessListeners = new Set<GuessListener>()

let room: PartyRoom | null = null
let players: PartyPlayer[] = []
// Guess keys already turned into toasts, so a re-iteration doesn't double-toast.
const seenGuessKeys = new Set<string>()

function snapshot(): PartySnapshot {
  return { room, players, myUserId: getPartyUserId() }
}

function notify(): void {
  const snap = snapshot()
  for (const fn of snapshotListeners) fn(snap)
}

export function subscribeParty(fn: SnapshotListener): () => void {
  snapshotListeners.add(fn)
  fn(snapshot())
  return () => {
    snapshotListeners.delete(fn)
  }
}

export function subscribePartyGuesses(fn: GuessListener): () => void {
  guessListeners.add(fn)
  return () => {
    guessListeners.delete(fn)
  }
}

// ---------- connection ----------

type AnyConn = any

let connection: AnyConn | null = null
let connectPromise: Promise<AnyConn | null> | null = null
// Code of the room whose rows we're currently subscribed to.
let activeCode: string | null = null
let roomSub: { unsubscribe: () => void; isActive?: () => boolean } | null = null

// Resolve a generated db table handle across the SDK's camelCase / snake_case
// accessor naming (same defensive trick stats.ts uses).
function dbTable(conn: AnyConn, names: string[]): AnyConn {
  if (!conn?.db) return null
  for (const n of names) if (conn.db[n]) return conn.db[n]
  return null
}
const partyTable = (c: AnyConn) => dbTable(c, ['party'])
const playerTable = (c: AnyConn) => dbTable(c, ['partyPlayer', 'party_player'])
const guessTable = (c: AnyConn) => dbTable(c, ['partyGuess', 'party_guess'])

function invokeReducer(r: AnyConn, names: string[], args: Record<string, unknown>): boolean {
  for (const n of names) {
    if (typeof r[n] === 'function') {
      try {
        r[n](args)
      } catch (e) {
        console.warn('[party] reducer', n, 'failed:', e)
      }
      return true
    }
  }
  return false
}

function callReducer(names: string[], args: Record<string, unknown>): void {
  const r = connection?.reducers
  if (r) {
    invokeReducer(r, names, args)
    return
  }
  // Connection momentarily down (e.g. a network blip mid-match) — reconnect and
  // send once it's back, so an action like Ready Up / Play Again isn't lost.
  void connect().then(() => {
    const r2 = connection?.reducers
    if (r2) invokeReducer(r2, names, args)
  })
}

function num(v: unknown): number {
  if (typeof v === 'bigint') return Number(v)
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function roomFromRow(rw: AnyConn): PartyRoom | null {
  const code = rw?.code
  if (typeof code !== 'string') return null
  const phase = String(rw.phase) as PartyPhase
  return {
    code,
    hostId: String(rw.hostId ?? rw.host_id ?? ''),
    seed: String(rw.seed ?? ''),
    phase,
    currentQuestion: num(rw.currentQuestion ?? rw.current_question),
    questionDeadline: num(rw.questionDeadline ?? rw.question_deadline),
  }
}

function playerFromRow(rw: AnyConn): PartyPlayer | null {
  const userId = rw?.userId ?? rw?.user_id
  if (typeof userId !== 'string') return null
  return {
    userId,
    name: String(rw.name ?? ''),
    ready: Boolean(rw.ready),
    score: num(rw.score),
    joinedAt: num(rw.joinedAt ?? rw.joined_at),
  }
}

// Rebuild room + player snapshots from the table caches, scoped to activeCode.
function rebuild(): void {
  const conn = connection
  if (!conn || !activeCode) {
    room = null
    players = []
    notify()
    return
  }
  let nextRoom: PartyRoom | null = null
  const pTbl = partyTable(conn)
  if (pTbl) {
    for (const rw of pTbl.iter()) {
      if (rw.code !== activeCode) continue
      nextRoom = roomFromRow(rw)
      break
    }
  }
  const nextPlayers: PartyPlayer[] = []
  const plTbl = playerTable(conn)
  if (plTbl) {
    for (const rw of plTbl.iter()) {
      if (rw.code !== activeCode) continue
      const p = playerFromRow(rw)
      if (p) nextPlayers.push(p)
    }
  }
  nextPlayers.sort((a, b) => a.joinedAt - b.joinedAt)
  room = nextRoom
  players = nextPlayers
  notify()
}

// Turn a freshly-inserted guess row into a toast, once.
function emitGuess(rw: AnyConn): void {
  if (!activeCode || rw?.code !== activeCode) return
  const key = String(rw.key ?? '')
  if (key && seenGuessKeys.has(key)) return
  if (key) seenGuessKeys.add(key)
  const e: PartyGuessEvent = {
    userId: String(rw.userId ?? rw.user_id ?? ''),
    name: String(rw.name ?? ''),
    question: num(rw.question),
    correct: Boolean(rw.correct),
  }
  for (const fn of guessListeners) fn(e)
}

// Wall-clock cap on a single connect attempt. If the WS handshake stalls past
// this we resolve null (rather than hanging forever) and let the caller retry.
const CONNECT_TIMEOUT_MS = 12000

async function connect(): Promise<AnyConn | null> {
  if (connection) return connection
  if (connectPromise) return connectPromise
  connectPromise = doConnect()
  const conn = await connectPromise
  // A failed attempt must not stick: clear the cached promise so the next call
  // (e.g. the join-code poll, or the next user action) starts a fresh attempt.
  if (!conn) connectPromise = null
  return conn
}

async function doConnect(): Promise<AnyConn | null> {
  let bindings: AnyConn = null
  try {
    bindings = await import('./module_bindings')
  } catch (e) {
    console.warn('[party] module_bindings not available:', e)
    return null
  }
  if (!bindings?.DbConnection?.builder) return null
  const uri = readLocalStorage(SPACETIME_URI_KEY) ?? DEFAULT_URI
  const dbName = readLocalStorage(SPACETIME_DB_KEY) ?? DEFAULT_DB
  return await new Promise<AnyConn | null>((resolve) => {
    let settled = false
    const finish = (v: AnyConn | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }
    // Don't wait forever on a stalled handshake.
    const timer = setTimeout(() => {
      console.warn('[party] connect timed out')
      finish(null)
    }, CONNECT_TIMEOUT_MS)
    try {
      bindings.DbConnection.builder()
        .withUri(uri)
        .withDatabaseName(dbName)
        // No .withToken(): each tab gets a fresh anonymous STDB identity. The
        // player key is our own sessionStorage id, not the STDB identity.
        .onConnectError((_c: unknown, err: unknown) => {
          console.warn('[party] connect error:', err)
          finish(null)
        })
        .onDisconnect(() => {
          console.warn('[party] disconnected')
          connection = null
          connectPromise = null
          tableEventsWired = false
          // Self-heal: if we're still in a room, reconnect and re-open its
          // subscription so a transient network blip doesn't brick the party.
          if (activeCode) {
            const code = activeCode
            setTimeout(() => {
              void connect().then((conn) => {
                if (conn && activeCode === code) openRoomSubscription(code)
              })
            }, 600)
          }
        })
        .onConnect((conn: AnyConn) => {
          connection = conn
          wireTableEvents(conn)
          // Debug hook for E2E introspection (cf. window.__gameState).
          try {
            ;(globalThis as unknown as { __partyNet: unknown }).__partyNet = {
              connected: () => !!connection,
              reducers: () => Object.keys(connection?.reducers ?? {}),
              activeCode: () => activeCode,
              me: () => getPartyUserId(),
              call: (name: string, args: Record<string, unknown>) =>
                (connection?.reducers as Record<string, (a: unknown) => void>)?.[name]?.(args),
            }
          } catch {
            /* ignore */
          }
          finish(conn)
        })
        .build()
    } catch (e) {
      console.warn('[party] build failed:', e)
      finish(null)
    }
  })
}

let tableEventsWired = false
function wireTableEvents(conn: AnyConn): void {
  if (tableEventsWired) return
  tableEventsWired = true
  const pTbl = partyTable(conn)
  const plTbl = playerTable(conn)
  const gTbl = guessTable(conn)
  // Any room/player change re-derives the scoped snapshot.
  for (const tbl of [pTbl, plTbl]) {
    if (!tbl) continue
    tbl.onInsert?.(() => rebuild())
    tbl.onUpdate?.(() => rebuild())
    tbl.onDelete?.(() => rebuild())
  }
  if (gTbl) {
    gTbl.onInsert?.((_ctx: unknown, rw: AnyConn) => emitGuess(rw))
  }
}

// Open (or replace) the live subscription scoped to one room's rows.
function openRoomSubscription(code: string): void {
  const conn = connection
  if (!conn) return
  if (roomSub) {
    try {
      if (roomSub.isActive?.() ?? true) roomSub.unsubscribe()
    } catch {
      /* already ended */
    }
    roomSub = null
  }
  const esc = code.replace(/'/g, "''")
  try {
    roomSub = conn
      .subscriptionBuilder()
      .onApplied(() => rebuild())
      .subscribe([
        `SELECT * FROM party WHERE code = '${esc}'`,
        `SELECT * FROM party_player WHERE code = '${esc}'`,
        `SELECT * FROM party_guess WHERE code = '${esc}'`,
      ])
  } catch (e) {
    console.warn('[party] room subscribe failed:', e)
  }
}

function setActiveCode(code: string | null): void {
  activeCode = code
  seenGuessKeys.clear()
  if (code) openRoomSubscription(code)
  else {
    if (roomSub) {
      try {
        if (roomSub.isActive?.() ?? true) roomSub.unsubscribe()
      } catch {
        /* already ended */
      }
      roomSub = null
    }
    room = null
    players = []
    notify()
  }
}

// Wait until `predicate(snapshot)` holds (or timeout). Used to confirm a reducer
// landed — STDB reducers are fire-and-forget, the result arrives via the sub.
function waitFor(
  predicate: (snap: PartySnapshot) => boolean,
  timeoutMs = 4000,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (predicate(snapshot())) {
      resolve(true)
      return
    }
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      unsub()
      clearTimeout(timer)
      resolve(ok)
    }
    const unsub = subscribeParty((snap) => {
      if (predicate(snap)) finish(true)
    })
    const timer = setTimeout(() => finish(false), timeoutMs)
  })
}

// ---------- public actions ----------

// True if a room with this code currently exists. Drives the Join button's
// enabled state. Opens a transient probe subscription and reads the cache.
export async function checkCodeExists(code: string): Promise<boolean> {
  const conn = await connect()
  if (!conn) return false
  const esc = code.replace(/'/g, "''")
  return await new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (v: boolean, sub: AnyConn) => {
      if (settled) return
      settled = true
      try {
        sub?.unsubscribe?.()
      } catch {
        /* ignore */
      }
      resolve(v)
    }
    try {
      const sub = conn
        .subscriptionBuilder()
        .onApplied(() => {
          const tbl = partyTable(conn)
          let exists = false
          if (tbl) {
            for (const rw of tbl.iter()) {
              if (rw.code === code) {
                exists = true
                break
              }
            }
          }
          finish(exists, sub)
        })
        .subscribe([`SELECT * FROM party WHERE code = '${esc}'`])
      setTimeout(() => finish(false, sub), 4000)
    } catch (e) {
      console.warn('[party] checkCodeExists failed:', e)
      resolve(false)
    }
  })
}

// Create a fresh room and return its code. Picks a collision-free code, calls
// the reducer, and resolves once our own room row arrives.
export async function createParty(
  name: string,
  seed: string,
): Promise<string | null> {
  const conn = await connect()
  if (!conn) return null
  saveName(name)
  const userId = getPartyUserId()
  // Find an unused code (collisions across 32^4 ≈ 1M are rare; a couple probes
  // at most in practice).
  let code = randomCode()
  for (let i = 0; i < 5; i++) {
    if (!(await checkCodeExists(code))) break
    code = randomCode()
  }
  setActiveCode(code)
  callReducer(['createParty', 'create_party'], { userId, name, code, seed })
  // Generous window: a cold maincloud round-trip (reducer commit → row push) can
  // take several seconds on the first interaction of a session.
  const ok = await waitFor(
    (s) => s.room?.code === code && s.room.hostId === userId,
    12000,
  )
  if (!ok) {
    setActiveCode(null)
    return null
  }
  return code
}

// Join an existing room. Resolves true once our player row appears.
export async function joinParty(code: string, name: string): Promise<boolean> {
  const conn = await connect()
  if (!conn) return false
  saveName(name)
  const userId = getPartyUserId()
  setActiveCode(code)
  callReducer(['joinParty', 'join_party'], { userId, name, code })
  const ok = await waitFor(
    (s) => s.room?.code === code && s.players.some((p) => p.userId === userId),
    12000,
  )
  if (!ok) setActiveCode(null)
  return ok
}

export function setReady(ready: boolean): void {
  if (!activeCode) return
  callReducer(['setReady', 'set_ready'], {
    userId: getPartyUserId(),
    code: activeCode,
    ready,
  })
}

export function leaveParty(): void {
  if (!activeCode) return
  callReducer(['leaveParty', 'leave_party'], {
    userId: getPartyUserId(),
    code: activeCode,
  })
  setActiveCode(null)
}

export function submitGuess(question: number, correct: boolean): void {
  if (!activeCode) return
  callReducer(['submitPartyGuess', 'submit_party_guess'], {
    userId: getPartyUserId(),
    code: activeCode,
    question,
    correct,
  })
}

// "Play again": send the finished room back to the lobby with a fresh seed so
// everyone re-readies for a new match under the same code.
export function restartParty(seed: string): void {
  if (!activeCode) return
  callReducer(['restartParty', 'restart_party'], {
    userId: getPartyUserId(),
    code: activeCode,
    seed,
  })
}

export function advanceQuestion(question: number): void {
  if (!activeCode) return
  callReducer(['advanceQuestion', 'advance_question'], {
    code: activeCode,
    question,
  })
}

export function getActiveCode(): string | null {
  return activeCode
}
