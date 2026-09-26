# Muse Event Bridge (Android)

A small background app that watches which app is in the foreground and publishes a
JSON event every time it changes. Events are written to a single silent, ongoing
**notification** that Muse reads on-device (e.g. "you just opened the game again").
Nothing is sent over the network.

- Kotlin, single module, minSdk 30, targetSdk 34, **no third-party dependencies**
  (framework Views, SQLite, framework notifications).
- Foreground service (`specialUse` type, Android 14+ compliant) with a persistent
  status notification; restarts after reboot and app updates.
- Events are queued in SQLite so nothing is lost across restarts; the queue is
  published to the sync notification in batches.

## Event schema

```json
{
  "device_id": "3f0c…-uuid",
  "timestamp": "2026-09-26T16:07:28.250Z",
  "event_type": "app_foreground | app_background | test",
  "package_name": "com.example.game",
  "app_label": "Once Upon a Galaxy",
  "priority": "normal | high",
  "session_seconds": 320
}
```

`session_seconds` only appears on `app_background`. `priority` is `high` for watchlisted
apps, `normal` otherwise.

## How it works

Detection: every poll interval (15s by default) the service reads
`UsageStatsManager.queryEvents()` since the last poll and replays each `ACTIVITY_RESUMED`,
so even switches shorter than the interval are reported with their real timestamps.
Screen-off (`SCREEN_NON_INTERACTIVE`) ends the current session, so you get an `app_background`
event with its duration. The watchlist decides what is reported (in watchlist-only mode) and
which events are `priority: high`.

Transport — the **notification**:

- A dedicated `NotificationChannel` at `IMPORTANCE_MIN`: completely silent, no sound, no
  vibration, minimal visual interruption.
- **One** persistent notification (fixed ID, `setOngoing`, never auto-cancelled). Each flush
  rewrites it in place with `BigTextStyle`.
- Title `Muse Event Bridge`; summary `Synced <N> events` (N = running total published).
- Big text is a compact JSON array of the most recent events — the exact same event objects
  the app would otherwise send — kept as a rolling window of ~50 events and always under 4 KB.
  If a batch would exceed 4 KB it is split across flushes. The notification is never cleared;
  a receiver dedupes by event identity (`device_id` + `timestamp` + `event_type` + `package_name`).
- Batching: a flush publishes once the window is due (60s) or 20 events are queued; each update
  is logged as `notify (N events)`. Only one update is ever in flight at a time.
- **Send test event** publishes/refreshes the notification immediately with a test payload.

The transport can be toggled independently of monitoring in **Settings**: with it off, events
still capture into the queue but aren't published.

## Build

```bash
cd apps/muse-event-bridge
./gradlew testDebugUnitTest assembleDebug
# APK: apps/muse-event-bridge/build/outputs/apk/debug/muse-event-bridge-debug.apk
```

You need JDK 17+ and an Android SDK with platform 34 (`ANDROID_HOME` or `local.properties`).
CI (`.github/workflows/android-muse-event-bridge.yml`) builds the APK on every push touching
this folder and uploads it as the `muse-event-bridge-debug-apk` workflow artifact.

## Install & permissions (adb)

```bash
adb install -r build/outputs/apk/debug/muse-event-bridge-debug.apk

# Usage access: normally toggled in Settings > Apps > Special app access > Usage access.
# The app has an explanation screen that deep-links there. Over adb:
adb shell appops set com.muse.eventbridge GET_USAGE_STATS allow
adb shell appops get com.muse.eventbridge GET_USAGE_STATS      # -> "GET_USAGE_STATS: allow"

# Notifications (Android 13+) — required for the transport, if you skipped the prompt:
adb shell pm grant com.muse.eventbridge android.permission.POST_NOTIFICATIONS

# Read the current sync notification's big text (the event array)
adb shell dumpsys notification --noredact | grep -A3 "Muse Event Bridge"

# Is the service running?
adb shell dumpsys activity services com.muse.eventbridge | grep -E "ServiceRecord|isForeground"

# Logs
adb logcat -s MonitorService NotificationTransport BootReceiver

# Simulate a reboot broadcast to test the boot receiver
adb shell am broadcast -a android.intent.action.BOOT_COMPLETED -p com.muse.eventbridge
```

The Watchlist screen lists apps used in the last 7 days (with Add/Remove), and also offers
**Pick from installed apps**. To look up a package name by hand:
`adb shell pm list packages | grep -i galaxy`

## Acceptance test (Pixel)

1. Install the APK, open **Muse Event Bridge**, and allow notifications when prompted.
2. Tap **Grant usage access…**, then **Open Usage access settings**, and turn on
   *Permit usage access*. Press back.
3. **Settings**: confirm *Publish events to the sync notification* is on, keep 15s, leave
   *Track ALL apps* on. Tap **Save**.
4. **Watchlist**: tap **Add** on an app under *Recently used* (or use *Pick from installed apps*),
   choosing one you'll open in step 6.
5. **Event log & test event**: tap **Send test event**. A silent "Muse Event Bridge"
   notification appears reading `Synced 1 events`; expand it to see the `test` event JSON. The
   log shows `notify (1 events)`.
6. Back on the main screen, tap **Start monitoring**. Open three different apps, ~10s each, then
   go home. Within a poll interval, expand the notification: its big-text JSON array holds the
   recent `app_foreground` / `app_background` events with the correct `package_name`s. The
   watchlisted app's events carry `"priority": "high"` and a `session_seconds` on `app_background`.
   Read the array programmatically with the `dumpsys notification` command above.

## Privacy

Events (package names, app labels and timestamps only, plus a random install id) are written to
a local, silent notification for Muse to read on-device — nothing leaves the phone over the
network (the app has no `INTERNET` permission). It does not use accessibility services or a
notification listener, does not capture the screen, and does not read input. Backups are disabled
(`allowBackup=false`).

## Notes / limits

- Android may batch usage events slightly. Detection latency is about one poll interval.
- Monitoring stops if you force-stop the app; it resumes the next time you open it or on reboot.
- The notification shows a rolling window (~50 events, ≤4 KB), so a reader that polls slower than
  events arrive should read on every change and dedupe; older events scroll out of the window.
