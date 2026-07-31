/**
 * Cross-device progress sync for mapoguesser, backed by the same SpacetimeDB
 * module as party.ts (see ../../server).
 *
 * There's no real auth here — "keep it simple". Each device holds a locally
 * generated `account_id` (persisted in localStorage). The adaptive-difficulty
 * item-weight progress the player builds up (store.ts's `itemWeights`) is
 * pushed to the server as an opaque JSON blob keyed by that id. To use the
 * same progress on a second device, the player generates a short-lived login
 * code on one device and enters it on the other — the second device then
 * adopts the first device's account_id and pulls its progress.
 *
 * Degrades gracefully when offline: pushes are fire-and-forget, pulls resolve
 * to null/an error tag, and the game keeps working from local storage alone.
 */

const ACCOUNT_ID_KEY = 'mapoguesser:userId'

// Same maincloud module party.ts connects to.
const DEFAULT_URI = 'wss://maincloud.spacetimedb.com'
const DEFAULT_DB = 'mapoguesser-stats'
const SPACETIME_URI_KEY = 'mapoguesser:spacetimeUri'
const SPACETIME_DB_KEY = 'mapoguesser:spacetimeDb'

const LOGIN_CODE_LEN = 6
const CODE_ALPHABET = '0123456789'

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
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// The account id is generated once per device and persisted locally. Redeeming
// a login code overwrites it with the source device's id, effectively merging
// this device into that account.
let cachedAccountId: string | null = null
export function getAccountId(): string {
  if (cachedAccountId) return cachedAccountId
  let id = readLocalStorage(ACCOUNT_ID_KEY)
  if (!id) {
    id = uuid()
    writeLocalStorage(ACCOUNT_ID_KEY, id)
  }
  cachedAccountId = id
  return id
}

function setAccountId(id: string): void {
  cachedAccountId = id
  writeLocalStorage(ACCOUNT_ID_KEY, id)
}

function randomLoginCode(): string {
  let out = ''
  for (let i = 0; i < LOGIN_CODE_LEN; i++) {
    out += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0]
  }
  return out
}

// ---------- connection ----------

type AnyConn = any

let connection: AnyConn | null = null
let connectPromise: Promise<AnyConn | null> | null = null

const CONNECT_TIMEOUT_MS = 12000

async function connect(): Promise<AnyConn | null> {
  if (connection) return connection
  if (connectPromise) return connectPromise
  connectPromise = doConnect()
  const conn = await connectPromise
  if (!conn) connectPromise = null
  return conn
}

async function doConnect(): Promise<AnyConn | null> {
  let bindings: AnyConn = null
  try {
    bindings = await import('./module_bindings')
  } catch (e) {
    console.warn('[account] module_bindings not available:', e)
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
    const timer = setTimeout(() => {
      console.warn('[account] connect timed out')
      finish(null)
    }, CONNECT_TIMEOUT_MS)
    try {
      bindings.DbConnection.builder()
        .withUri(uri)
        .withDatabaseName(dbName)
        .onConnectError((_c: unknown, err: unknown) => {
          console.warn('[account] connect error:', err)
          finish(null)
        })
        .onDisconnect(() => {
          console.warn('[account] disconnected')
          connection = null
          connectPromise = null
        })
        .onConnect((conn: AnyConn) => {
          connection = conn
          finish(conn)
        })
        .build()
    } catch (e) {
      console.warn('[account] build failed:', e)
      finish(null)
    }
  })
}

function dbTable(conn: AnyConn, names: string[]): AnyConn {
  if (!conn?.db) return null
  for (const n of names) if (conn.db[n]) return conn.db[n]
  return null
}
const progressTable = (c: AnyConn) => dbTable(c, ['progress'])
const loginCodeTable = (c: AnyConn) => dbTable(c, ['loginCode', 'login_code'])

function invokeReducer(r: AnyConn, names: string[], args: Record<string, unknown>): boolean {
  for (const n of names) {
    if (typeof r[n] === 'function') {
      try {
        r[n](args)
      } catch (e) {
        console.warn('[account] reducer', n, 'failed:', e)
      }
      return true
    }
  }
  return false
}

function num(v: unknown): number {
  if (typeof v === 'bigint') return Number(v)
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ---------- progress push/pull ----------

export interface ProgressRow {
  accountId: string
  data: string
  updatedAt: number
}

// Fire-and-forget: push this device's serialized progress up to the server,
// stamped under the current account id.
export async function pushProgress(data: string): Promise<void> {
  const conn = await connect()
  if (!conn?.reducers) return
  invokeReducer(conn.reducers, ['saveProgress', 'save_progress'], {
    accountId: getAccountId(),
    data,
  })
}

// One-time fetch of an account's stored progress row (or null if it has none
// yet, or the fetch failed/timed out).
export async function pullProgress(accountId: string): Promise<ProgressRow | null> {
  const conn = await connect()
  if (!conn) return null
  const esc = accountId.replace(/'/g, "''")
  return await new Promise<ProgressRow | null>((resolve) => {
    let settled = false
    const finish = (v: ProgressRow | null, sub: AnyConn) => {
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
          const tbl = progressTable(conn)
          let row: ProgressRow | null = null
          if (tbl) {
            for (const rw of tbl.iter()) {
              if ((rw.accountId ?? rw.account_id) !== accountId) continue
              row = {
                accountId,
                data: String(rw.data ?? ''),
                updatedAt: num(rw.updatedAt ?? rw.updated_at),
              }
              break
            }
          }
          finish(row, sub)
        })
        .subscribe([`SELECT * FROM progress WHERE account_id = '${esc}'`])
      setTimeout(() => finish(null, sub), 8000)
    } catch (e) {
      console.warn('[account] pullProgress subscribe failed:', e)
      resolve(null)
    }
  })
}

// ---------- login codes ----------

async function loginCodeExists(code: string): Promise<boolean> {
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
          const tbl = loginCodeTable(conn)
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
        .subscribe([`SELECT * FROM login_code WHERE code = '${esc}'`])
      setTimeout(() => finish(false, sub), 4000)
    } catch (e) {
      console.warn('[account] loginCodeExists failed:', e)
      resolve(false)
    }
  })
}

// Generate a fresh pairing code for this device's account and return it, or
// null if offline/failed. The code is valid for 10 minutes server-side.
export async function generateLoginCode(): Promise<string | null> {
  const conn = await connect()
  if (!conn?.reducers) return null
  const accountId = getAccountId()
  let code = randomLoginCode()
  for (let i = 0; i < 5; i++) {
    if (!(await loginCodeExists(code))) break
    code = randomLoginCode()
  }
  invokeReducer(conn.reducers, ['generateLoginCode', 'generate_login_code'], {
    accountId,
    code,
  })
  // Confirm it landed before handing the code to the player.
  const ok = await new Promise<boolean>((resolve) => {
    let tries = 0
    const check = async () => {
      tries++
      if (await loginCodeExists(code)) {
        resolve(true)
        return
      }
      if (tries >= 10) {
        resolve(false)
        return
      }
      setTimeout(check, 400)
    }
    void check()
  })
  return ok ? code : null
}

export type RedeemResult =
  | { ok: true; progress: ProgressRow | null }
  | { ok: false; reason: 'not-found' | 'expired' | 'offline' }

// Look up a login code, adopt its account id on this device, pull that
// account's progress, and invalidate the code. Doesn't itself merge the
// progress into the game — the caller applies it.
export async function redeemLoginCode(code: string): Promise<RedeemResult> {
  const conn = await connect()
  if (!conn) return { ok: false, reason: 'offline' }
  const esc = code.replace(/'/g, "''")
  const row = await new Promise<{ accountId: string; expiresAt: number } | null>(
    (resolve) => {
      let settled = false
      const finish = (
        v: { accountId: string; expiresAt: number } | null,
        sub: AnyConn,
      ) => {
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
            const tbl = loginCodeTable(conn)
            let found: { accountId: string; expiresAt: number } | null = null
            if (tbl) {
              for (const rw of tbl.iter()) {
                if (rw.code !== code) continue
                found = {
                  accountId: String(rw.accountId ?? rw.account_id ?? ''),
                  expiresAt: num(rw.expiresAt ?? rw.expires_at),
                }
                break
              }
            }
            finish(found, sub)
          })
          .subscribe([`SELECT * FROM login_code WHERE code = '${esc}'`])
        setTimeout(() => finish(null, sub), 6000)
      } catch (e) {
        console.warn('[account] redeemLoginCode subscribe failed:', e)
        resolve(null)
      }
    },
  )
  if (!row || !row.accountId) return { ok: false, reason: 'not-found' }
  if (row.expiresAt > 0 && Date.now() > row.expiresAt) {
    return { ok: false, reason: 'expired' }
  }
  const prog = await pullProgress(row.accountId)
  setAccountId(row.accountId)
  invokeReducer(conn.reducers, ['redeemLoginCode', 'redeem_login_code'], { code })
  return { ok: true, progress: prog }
}
