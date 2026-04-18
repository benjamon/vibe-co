/**
 * SpacetimeDB Server Module — Auto-Battles
 *
 * Tables:
 *   RecentRun  — ring buffer of the last 100 runs (slot 0-99)
 *   RingCursor — singleton tracking the next write position
 *
 * Reducers:
 *   submit_run(player_name, changes_json, score) — writes run, advances cursor
 *
 * Clients subscribe to RecentRun to get the full pool, then pick 5 at random locally.
 *
 * To set up SpacetimeDB:
 *   1. Install: curl -sSf https://install.spacetimedb.com | sh
 *   2. Init:    spacetime init --lang typescript server
 *   3. Dev:     spacetime dev --project-path server
 *   4. Generate client bindings: spacetime generate --lang typescript
 */

// Example table definitions (uncomment when SpacetimeDB is installed):
//
// import { table, reducer, ReducerContext } from '@clockworklabs/spacetimedb-sdk/server'
//
// @table({ name: 'RecentRun', primaryKey: 'slot' })
// class RecentRun {
//   slot!: number       // 0-99, ring buffer position
//   playerName!: string
//   changesJson!: string // JSON-encoded TeamChange[]
//   score!: number       // wins out of 5
//   timestamp!: bigint   // u64, milliseconds since epoch
// }
//
// @table({ name: 'RingCursor', primaryKey: 'id' })
// class RingCursor {
//   id!: number          // always 0 (singleton)
//   nextSlot!: number    // 0-99, wraps around
// }
//
// @reducer
// function submitRun(ctx: ReducerContext, playerName: string, changesJson: string, score: number) {
//   // Get or init cursor
//   let cursor = RingCursor.filterById(0)
//   if (!cursor) {
//     cursor = new RingCursor()
//     cursor.id = 0
//     cursor.nextSlot = 0
//     RingCursor.insert(cursor)
//   }
//
//   const slot = cursor.nextSlot
//
//   // Delete existing run at this slot if any
//   const existing = RecentRun.filterBySlot(slot)
//   if (existing) {
//     RecentRun.delete(existing)
//   }
//
//   // Insert new run
//   const run = new RecentRun()
//   run.slot = slot
//   run.playerName = playerName
//   run.changesJson = changesJson
//   run.score = score
//   run.timestamp = BigInt(Date.now())
//   RecentRun.insert(run)
//
//   // Advance cursor
//   cursor.nextSlot = (slot + 1) % 100
//   RingCursor.update(cursor)
// }

export {}
