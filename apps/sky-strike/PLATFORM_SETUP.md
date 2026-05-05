# Platform Setup

## Web (default)
```bash
npm run dev          # dev server at localhost:5173
npm run build        # production build in client/dist/
```

## Desktop (Tauri)
```bash
# Install Tauri CLI
cargo install create-tauri-app
# From project root:
cargo tauri dev      # dev mode
cargo tauri build    # production .exe / .dmg / .AppImage
```
Requires: Rust toolchain, platform-specific system deps (see https://v2.tauri.app/start/prerequisites/)

## Android (Capacitor)
```bash
npm install @capacitor/core @capacitor/cli
npx cap add android
npm run build && npx cap sync
cd android && ./gradlew assembleDebug
```
APK output: `android/app/build/outputs/apk/debug/app-debug.apk`
Requires: Android Studio, JDK 17+

## iOS (Capacitor)
```bash
npm install @capacitor/core @capacitor/cli
npx cap add ios
npm run build && npx cap sync
cd ios && xcodebuild -workspace App/App.xcworkspace -scheme App -configuration Debug
```
Requires: macOS, Xcode 15+, Apple Developer account ($99/yr) for device testing and distribution.

## Online High Scores (SpacetimeDB)

The high-score panel always works locally (per-browser persistence in
`localStorage`). For shared cross-device scores it connects to the hosted
SpacetimeDB project at <https://spacetimedb.com/@benjamon/ss-hs-70fxp>.

The client defaults are:
- URI: `wss://maincloud.spacetimedb.com`
- Database: `ss-hs-70fxp`

These are picked up at runtime through `./module_bindings/` (created by the
SpacetimeDB CLI). Until those bindings exist, the connection module silently
no-ops and the panel stays in local-only mode.

### Generate client bindings (one-time, after cloning)

```bash
# 1) Install the SpacetimeDB CLI
curl -sSf https://install.spacetimedb.com | sh -s -- -y

# 2) Generate TypeScript bindings from the local server module into
#    client/src/module_bindings/. Once these files exist the dev server
#    will pick them up and the panel starts pulling remote scores.
npm --prefix server run generate:client
```

### Publishing changes to the hosted project

```bash
# Auth once (browser login flow)
spacetime login

# Push the module to Maincloud under @benjamon/ss-hs-70fxp
npm --prefix server run publish:maincloud

# Local SpacetimeDB instead (publishes under name ss-hs-70fxp on -s local)
spacetime start                               # in another shell
npm --prefix server run publish:local
```

The server module exposes a single `submit_score` reducer keyed on a
client-generated user id (UUID stored in `localStorage`). The reducer only
upserts when the new score beats the existing one, so duplicate submissions
are harmless.

### Pointing the client at a different deployment

Override either default at runtime via the browser console:
- `localStorage.setItem('skyStrike.spacetimeUri', 'wss://<host>')`
- `localStorage.setItem('skyStrike.spacetimeDb', '<module-name>')`

For example, to test against a local server published under the same name:
- `localStorage.setItem('skyStrike.spacetimeUri', 'ws://localhost:3000')`
