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

// Cumulative preference between every pair of abilities offered together at a
// level-up. pair_id is `${codeMin}-${codeMax}` (alphabetically sorted). score
// is incremented when the alphabetically-first code was picked, decremented
// when the second was picked. Positive = first preferred.
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

const spacetimedb = schema({ highscore, preference })

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

const MAX_PAIR_ID_LEN = 32

export const vote_pair = spacetimedb.reducer(
  {
    pair_id: t.string(),
    delta: t.i32(),
  },
  (ctx, { pair_id, delta }) => {
    if (!pair_id || pair_id.length > MAX_PAIR_ID_LEN) return
    if (delta !== 1 && delta !== -1) return
    const existing = ctx.db.preference.pair_id.find(pair_id)
    if (existing) {
      ctx.db.preference.pair_id.update({
        pair_id,
        score: existing.score + delta,
      })
    } else {
      ctx.db.preference.insert({ pair_id, score: delta })
    }
  },
)

export default spacetimedb
