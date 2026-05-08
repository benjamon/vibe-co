import { schema, t, table } from 'spacetimedb/server'

const highscore = table(
  {
    name: 'highscore',
    public: true,
    indexes: [
      {
        accessor: 'byScore',
        algorithm: 'btree',
        columns: ['score'] as const,
      },
    ] as const,
  },
  {
    user_id: t.string().primaryKey(),
    name: t.string(),
    score: t.u32(),
    // JSON-encoded { code: count } using short ability codes from the client.
    build: t.string(),
    timestamp: t.u64(),
  },
)

// Legacy: kept (orphaned) so spacetime's migration system doesn't see this as
// a destructive in-place change to its schema. New writes go to ability_pref.
const preference = table(
  {
    name: 'preference',
    public: true,
  },
  {
    pair_id: t.string().primaryKey(),
    score: t.i32(),
  },
)

// One row per ability code. `picks` / `passes` track the totals each time
// this ability was offered; the per-code columns track head-to-head outcomes
// against every other ability — incremented when this ability was picked over
// that one, decremented when it was passed in favour of that one.
const ability_pref = table(
  {
    name: 'ability_pref',
    public: true,
  },
  {
    code: t.string().primaryKey(),
    picks: t.i32(),
    passes: t.i32(),
    big: t.i32(),
    brt: t.i32(),
    bsp: t.i32(),
    cn: t.i32(),
    crit: t.i32(),
    cryo: t.i32(),
    dmg: t.i32(),
    drn: t.i32(),
    emd: t.i32(),
    emp: t.i32(),
    emr: t.i32(),
    epd: t.i32(),
    epw: t.i32(),
    fr: t.i32(),
    heal: t.i32(),
    hm: t.i32(),
    hms: t.i32(),
    hp: t.i32(),
    kb: t.i32(),
    mag: t.i32(),
    mc: t.i32(),
    mov: t.i32(),
    mp: t.i32(),
    mrk: t.i32(),
    nec: t.i32(),
    oc: t.i32(),
    pen: t.i32(),
    shd: t.i32(),
    sz: t.i32(),
    vamp: t.i32(),
    btime: t.i32().default(0),
    hulk: t.i32().default(0),
    slim: t.i32().default(0),
  },
)

// Per-user mirror of ability_pref. Primary key is `${user_id}-${code}` so we
// can upsert without a composite-key index.
const user_ability_pref = table(
  {
    name: 'user_ability_pref',
    public: true,
  },
  {
    key: t.string().primaryKey(),
    user_id: t.string(),
    code: t.string(),
    picks: t.i32(),
    passes: t.i32(),
    big: t.i32(),
    brt: t.i32(),
    bsp: t.i32(),
    cn: t.i32(),
    crit: t.i32(),
    cryo: t.i32(),
    dmg: t.i32(),
    drn: t.i32(),
    emd: t.i32(),
    emp: t.i32(),
    emr: t.i32(),
    epd: t.i32(),
    epw: t.i32(),
    fr: t.i32(),
    heal: t.i32(),
    hm: t.i32(),
    hms: t.i32(),
    hp: t.i32(),
    kb: t.i32(),
    mag: t.i32(),
    mc: t.i32(),
    mov: t.i32(),
    mp: t.i32(),
    mrk: t.i32(),
    nec: t.i32(),
    oc: t.i32(),
    pen: t.i32(),
    shd: t.i32(),
    sz: t.i32(),
    vamp: t.i32(),
    btime: t.i32().default(0),
    hulk: t.i32().default(0),
    slim: t.i32().default(0),
  },
)

const spacetimedb = schema({ highscore, preference, ability_pref, user_ability_pref })

const MAX_NAME_LEN = 32
const MAX_BUILD_LEN = 4096

export const submit_score = spacetimedb.reducer(
  {
    user_id: t.string(),
    name: t.string(),
    score: t.u32(),
    build: t.string(),
  },
  (ctx, { user_id, name, score, build }) => {
    if (!user_id || user_id.length > 64) return
    const trimmedName = name.slice(0, MAX_NAME_LEN)
    const trimmedBuild = build.slice(0, MAX_BUILD_LEN)
    const ts = BigInt(Date.now())
    const existing = ctx.db.highscore.user_id.find(user_id)
    if (existing) {
      if (score <= existing.score) return
      ctx.db.highscore.user_id.update({
        user_id,
        name: trimmedName,
        score,
        build: trimmedBuild,
        timestamp: ts,
      })
    } else {
      ctx.db.highscore.insert({
        user_id,
        name: trimmedName,
        score,
        build: trimmedBuild,
        timestamp: ts,
      })
    }
  },
)

const ABILITY_CODES = [
  'big', 'brt', 'bsp', 'cn', 'crit', 'cryo', 'dmg', 'drn', 'emd', 'emp',
  'emr', 'epd', 'epw', 'fr', 'heal', 'hm', 'hms', 'hp', 'kb', 'mag',
  'mc', 'mov', 'mp', 'mrk', 'nec', 'oc', 'pen', 'shd', 'sz', 'vamp',
  'btime', 'hulk', 'slim',
] as const

type AbilityCode = (typeof ABILITY_CODES)[number]

const ABILITY_CODE_SET: Set<string> = new Set(ABILITY_CODES)

type PreferenceRow = {
  code: string
  picks: number
  passes: number
} & Record<AbilityCode, number>

type UserPreferenceRow = {
  key: string
  user_id: string
  code: string
  picks: number
  passes: number
} & Record<AbilityCode, number>

function emptyPrefRow(code: string): PreferenceRow {
  const row: any = { code, picks: 0, passes: 0 }
  for (const c of ABILITY_CODES) row[c] = 0
  return row as PreferenceRow
}

function emptyUserPrefRow(user_id: string, code: string): UserPreferenceRow {
  const row: any = { key: `${user_id}-${code}`, user_id, code, picks: 0, passes: 0 }
  for (const c of ABILITY_CODES) row[c] = 0
  return row as UserPreferenceRow
}

export const vote_pair = spacetimedb.reducer(
  {
    user_id: t.string(),
    picked_code: t.string(),
    passed_code: t.string(),
  },
  (ctx, { user_id, picked_code, passed_code }) => {
    if (!ABILITY_CODE_SET.has(picked_code) || !ABILITY_CODE_SET.has(passed_code)) return
    if (picked_code === passed_code) return

    const pickedExisting = ctx.db.ability_pref.code.find(picked_code)
    const pickedRow = pickedExisting ?? emptyPrefRow(picked_code)
    pickedRow.picks += 1
    ;(pickedRow as any)[passed_code] += 1
    if (pickedExisting) {
      ctx.db.ability_pref.code.update(pickedRow)
    } else {
      ctx.db.ability_pref.insert(pickedRow)
    }

    const passedExisting = ctx.db.ability_pref.code.find(passed_code)
    const passedRow = passedExisting ?? emptyPrefRow(passed_code)
    passedRow.passes += 1
    ;(passedRow as any)[picked_code] -= 1
    if (passedExisting) {
      ctx.db.ability_pref.code.update(passedRow)
    } else {
      ctx.db.ability_pref.insert(passedRow)
    }

    if (!user_id || user_id.length === 0 || user_id.length > 64) return

    const userPickedKey = `${user_id}-${picked_code}`
    const userPickedExisting = ctx.db.user_ability_pref.key.find(userPickedKey)
    const userPickedRow = userPickedExisting ?? emptyUserPrefRow(user_id, picked_code)
    userPickedRow.picks += 1
    ;(userPickedRow as any)[passed_code] += 1
    if (userPickedExisting) {
      ctx.db.user_ability_pref.key.update(userPickedRow)
    } else {
      ctx.db.user_ability_pref.insert(userPickedRow)
    }

    const userPassedKey = `${user_id}-${passed_code}`
    const userPassedExisting = ctx.db.user_ability_pref.key.find(userPassedKey)
    const userPassedRow = userPassedExisting ?? emptyUserPrefRow(user_id, passed_code)
    userPassedRow.passes += 1
    ;(userPassedRow as any)[picked_code] -= 1
    if (userPassedExisting) {
      ctx.db.user_ability_pref.key.update(userPassedRow)
    } else {
      ctx.db.user_ability_pref.insert(userPassedRow)
    }
  },
)

export default spacetimedb
