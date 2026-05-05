import { schema, t, table } from 'spacetimedb/server'

const highscore = table(
  {
    name: 'highscore',
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
    // JSON-encoded { upgrades: { id: count } }. String keeps the schema simple
    // and avoids per-upgrade migrations as the upgrade list evolves.
    build: t.string(),
    timestamp: t.u64(),
  },
)

const spacetimedb = schema({ highscore })

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

export default spacetimedb
