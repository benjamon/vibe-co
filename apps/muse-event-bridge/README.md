# Muse Event Bridge (Android)

A small background app that watches which app is in the foreground and POSTs a
JSON event to your HTTPS webhook every time it changes. Muse polls that webhook
and uses the events (e.g. "you just opened the game again").

- Kotlin, single module, minSdk 30, targetSdk 34, **no third-party dependencies**
  (framework Views, SQLite, `HttpsURLConnection`).
- Foreground service (`specialUse` type, Android 14+ compliant) with a persistent
  notification; restarts after reboot and app updates.
- Unsent events are stored in SQLite and retried with exponential backoff
  (10s → 20s → 40s … capped at 30 min), and retried immediately when the network returns.

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

`session_seconds` only appears on `app_background`. Headers are `Content-Type: application/json`
and `X-Event-Token: <shared secret>`. Non-`https://` endpoints are refused, both in settings and
at send time, and cleartext traffic is disabled for the whole app.

How detection works: every poll interval (15s by default) the service reads
`UsageStatsManager.queryEvents()` since the last poll and replays each `ACTIVITY_RESUMED`,
so even switches shorter than the interval are reported with their real timestamps.
Screen-off (`SCREEN_NON_INTERACTIVE`) ends the current session, so you get an `app_background`
event with its duration. 2xx responses are marked delivered. 3xx/4xx responses (except 408/429)
are marked failed and not retried, because a bad token or URL won't fix itself. Everything
else is retried.

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

# Notifications (Android 13+), if you skipped the prompt:
adb shell pm grant com.muse.eventbridge android.permission.POST_NOTIFICATIONS

# Is the service running?
adb shell dumpsys activity services com.muse.eventbridge | grep -E "ServiceRecord|isForeground"

# Logs
adb logcat -s MonitorService EventSender BootReceiver

# Simulate a reboot broadcast to test the boot receiver
adb shell am broadcast -a android.intent.action.BOOT_COMPLETED -p com.muse.eventbridge
```

To find a package name for the watchlist, use **Watchlist → Pick from installed apps**, or:
`adb shell pm list packages | grep -i galaxy`

## Acceptance test (Pixel + webhook.site)

1. Open https://webhook.site and copy your unique URL.
2. Install the APK, open **Muse Event Bridge**, and allow notifications.
3. Tap **Grant usage access…**, then **Open Usage access settings**, and turn on
   *Permit usage access*. Press back.
4. **Webhook settings**: paste the webhook.site URL, set a token (e.g. `muse-test`), keep 15s,
   and leave *Track ALL apps* on. Tap **Save**.
5. **Watchlist**: pick one app you'll open in step 7 (e.g. Chrome, or your game).
6. **Event log & test event**: tap **Send test event**. It should show `HTTP 200 ✓`, and
   webhook.site shows a `test` event with header `x-event-token: muse-test`.
7. Back on the main screen, tap **Start monitoring**. Open three different apps, spending about
   10s in each, then go home.
8. webhook.site should show `app_foreground` / `app_background` pairs with the correct
   `package_name` values. The watchlisted app's events carry `"priority": "high"` and a
   `session_seconds` value on its `app_background`. Events usually arrive within one poll
   interval (≤15s).

## Privacy

Only package names, app labels, timestamps and a random install id leave the device. The app
does not use accessibility services or a notification listener, does not capture the screen, and
does not read input. Backups are disabled (`allowBackup=false`), so the shared secret is never
copied off the phone.

## Notes / limits

- Android may batch usage events slightly. Detection latency is about one poll interval.
- Monitoring stops if you force-stop the app; it resumes the next time you open it or on reboot.
- If Muse needs a stable stream through app restarts, it can deduplicate on
  `(device_id, timestamp, event_type, package_name)`.
