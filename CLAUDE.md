# vibe-co

Game template monorepo for AI-assisted game development.

## Templates

### 3D Template (`templates/three/`)
Three.js + React Three Fiber + Rapier physics + Vite + TypeScript monorepo.

**Structure:** `client/` (R3F app), `server/` (SpacetimeDB stub), `shared/` (input system, types)

**Build:**
```bash
cd templates/three
npm install
npm run dev        # dev server at localhost:5173
npm run build      # production build
npm run test:unit  # vitest unit tests
npm run test:e2e   # playwright integration tests
```

### 2D Template (`templates/phaser/`)
Phaser 4 + Arcade physics + Vite + TypeScript monorepo.

**Structure:** `client/` (Phaser app), `server/` (SpacetimeDB stub), `shared/` (input system, types)

**Build:**
```bash
cd templates/phaser
npm install
npm run dev        # dev server at localhost:5173
npm run build      # production build
npm run test:unit  # vitest unit tests
npm run test:e2e   # playwright integration tests
```

## Creating a New Game

```bash
./scripts/create-game-3d.sh <project-name>   # 3D (Three.js)
./scripts/create-game-2d.sh <project-name>   # 2D (Phaser)
```

Games are created in `apps/<project-name>` within the monorepo.

## Asset Management

Assets live in `public/assets/` with a `manifest.json` index.
- **3D:** `.glb` (models), `.webp` (textures), `.ogg` (audio), `.woff2` (fonts), `.json` (data)
- **2D:** `.webp`/`.png` (spritesheets), `.json` (tilemaps), `.ogg` (audio), `.woff2` (fonts), `.json` (data)

## Input System

The shared input system (`shared/src/input/`) provides a unified `GameActions` type across keyboard, mouse, touch, and gamepad. Game code reads `GameActions`, never device-specific state.

## Cross-Platform

- **Web:** `npm run build` → deploy `client/dist/`
- **Desktop:** Tauri (see `src-tauri/`)
- **Android/iOS:** Capacitor (see `capacitor.config.ts`)
- See `PLATFORM_SETUP.md` in each template for details.

## Package Management

Uses npm with workspaces. If disk/speed starts to matter (multiple game projects from the templates), switching to pnpm is a one-liner: `npm install -g pnpm && pnpm import && pnpm install`.

## SpacetimeDB Integration

**Setup:**
```bash
curl -sSf https://install.spacetimedb.com | sh -s -- -y   # install CLI
spacetime start                                            # start local server on :3000
spacetime publish <name> -s local -y --module-path ./server # publish module
spacetime generate --lang typescript --out-dir ./client/src/module_bindings --module-path ./server
```

**SDK API gotchas (v2.1.0):**
- Builder method is `withDatabaseName()`, NOT `withModuleName()`
- Subscribe method is `subscribeToAllTables()`, NOT `subscribeToAll()`
- Reducer calls use object syntax: `conn.reducers.foo({ param: 'value' })`, NOT positional args
- Import `DbConnection` from generated `./module_bindings`, NOT from `spacetimedb`
- All u64 fields use BigInt: `0n`, `1n`, NOT `0`, `1`

**Multi-tab / multi-player local testing:**
Do NOT persist auth tokens in localStorage — tabs on the same origin share localStorage, so both tabs get the same identity and the second connection kicks the first. For local testing, omit `.withToken()` so each tab gets a fresh anonymous identity. For production, use per-session token storage or incognito windows.

**Room/match patterns:**
- Single database with `room_id` columns on every game table + filtered subscriptions (`SELECT * FROM player WHERE room_id = X`) handles 10-20 concurrent matches
- Open world: spatial partitioning with `cell_id` columns, clients subscribe to surrounding cells, re-subscribe on boundary crossing
- For 50+ concurrent matches: multiple database instances + external orchestrator
- No built-in room/lobby abstraction — you build it with tables and reducers

**Asset storage:** Don't store large binary data in tables (everything is in-memory, synced to all subscribers). Store URLs/filenames in tables, serve actual files from public/ or a CDN.

## Testing

- **Unit tests:** `vitest` in `client/src/*.test.ts`
- **E2E tests:** `playwright` in `client/e2e/*.spec.ts`
- Game state exposed via `window.__gameState` for Playwright introspection.
