# Auto-Battles

An asynchronous auto-battler where you build a team once, then watch it fight five random opponents pulled from a shared pool of recent runs.

## Concept

- Players build a team by making **changes** (draft picks, upgrades, item equips, stat boosts) on top of a fixed base roster
- When a run begins, five opponent teams are pulled at random from the most recent ~100 runs stored in SpacetimeDB
- Battles play out automatically — no player input during combat
- After all five battles, the player's run (their list of changes) is uploaded, replacing the oldest entry in the ring buffer

## Architecture: Delta-Based Team Storage

Instead of serializing the full team state for every run, we store only the **changes** applied to a well-known base template. This keeps payloads small and makes the system easy to extend.

```
BaseTeam (shared constant)
  + TeamChange[]  →  fully resolved team
```

### TeamChange types

| Change Type     | Data                          | Effect                                 |
|-----------------|-------------------------------|----------------------------------------|
| `draft_unit`    | `unitId`, `slot`              | Place a unit from the pool into a slot |
| `upgrade_unit`  | `slot`, `upgradeId`           | Apply an upgrade to a slotted unit     |
| `equip_item`    | `slot`, `itemId`              | Give an item to a unit                 |
| `boost_stat`    | `slot`, `stat`, `amount`      | Flat stat modifier                     |

A run is fully described by its ordered list of `TeamChange` entries. The client replays these on top of `BaseTeam` to reconstruct the full team for battle simulation.

### Why deltas?

- **Small storage**: a run is ~200-500 bytes instead of a full team snapshot
- **Forward-compatible**: adding new change types doesn't invalidate old runs
- **Replayable**: you can scrub through team-building decisions for spectating or debugging
- **Diffable**: easy to compare two runs by diffing their change lists

## SpacetimeDB Schema

### Tables

- **`RecentRun`** — ring buffer of the last 100 runs
  - `slot: u32` (0-99, primary key) — position in the ring buffer
  - `player_name: string`
  - `changes: string` — JSON-encoded `TeamChange[]`
  - `score: u32` — wins out of 5 from their run
  - `timestamp: u64`

- **`RingCursor`** — singleton tracking the next write position
  - `id: u32` (always 0, primary key)
  - `next_slot: u32` — next slot to overwrite (0-99, wraps around)

### Reducers

- **`submit_run(player_name, changes_json)`** — writes to `RecentRun[next_slot]`, advances cursor
- **`get_opponents()`** — returns 5 random entries from `RecentRun` (client calls this at run start)

## Project Structure

```
client/
  src/
    main.ts              — Phaser game setup
    store.ts             — Zustand state (team changes, opponents, battle results)
    types.ts             — TeamChange, Unit, RunData types
    team-resolver.ts     — Applies TeamChange[] to BaseTeam to produce final team
    battle-sim.ts        — Deterministic auto-battle simulation
    scenes/
      BootScene.ts       — Asset loading / texture generation
      DraftScene.ts      — Team building (apply changes)
      BattleScene.ts     — Watch auto-battle play out
      ResultsScene.ts    — Show W/L record, upload run
server/
  src/
    index.ts             — SpacetimeDB tables + reducers
shared/
  src/                   — Input system, shared types
```

## Running

```bash
cd apps/auto-battles
npm install
npm run dev          # client at localhost:5173
```

### With SpacetimeDB (multiplayer)

```bash
spacetime start
spacetime publish auto-battles -s local -y --module-path ./server
spacetime generate --lang typescript --out-dir ./client/src/module_bindings --module-path ./server
npm run dev
```

### Without SpacetimeDB (local only)

The client includes a local mock that simulates the ring buffer in memory. You can build and battle against bot-generated teams without any server.
