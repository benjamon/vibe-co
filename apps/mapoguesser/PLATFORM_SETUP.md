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
