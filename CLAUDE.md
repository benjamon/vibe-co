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

## Creating a New Game

```bash
./scripts/create-game-3d.sh <project-name> [target-dir]
```

This copies the 3D template into a new project folder, updates package names, and initializes git.

## Asset Management

Assets live in `public/assets/` with a `manifest.json` index. Use `.glb` for 3D models, `.webp` for textures, `.ogg` for audio, `.woff2` for fonts, `.json` for data.

## Input System

The shared input system (`shared/src/input/`) provides a unified `GameActions` type across keyboard, mouse, touch, and gamepad. Game code reads `GameActions`, never device-specific state.

## Cross-Platform

- **Web:** `npm run build` → deploy `client/dist/`
- **Desktop:** Tauri (see `src-tauri/`)
- **Android/iOS:** Capacitor (see `capacitor.config.ts`)
- See `PLATFORM_SETUP.md` in each template for details.

## Testing

- **Unit tests:** `vitest` in `client/src/*.test.ts`
- **E2E tests:** `playwright` in `client/e2e/*.spec.ts`
- Game state exposed via `window.__gameState` for Playwright introspection.
