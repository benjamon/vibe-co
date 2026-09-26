package com.muse.eventbridge

import android.content.Context
import java.util.UUID

const val DEFAULT_POLL_SECONDS = 15
const val MIN_POLL_SECONDS = 5
const val MAX_POLL_SECONDS = 3600

class Prefs(context: Context) {
    private val sp = context.applicationContext.getSharedPreferences("bridge", Context.MODE_PRIVATE)

    /** Whether the notification transport publishes events. Independent of monitoring. */
    var notifyEnabled: Boolean
        get() = sp.getBoolean("notify_enabled", true)
        set(value) = sp.edit().putBoolean("notify_enabled", value).apply()

    /** Running total of events published to the sync notification. */
    var syncedTotal: Long
        get() = sp.getLong("synced_total", 0L)
        set(value) = sp.edit().putLong("synced_total", value).apply()

    var pollSeconds: Int
        get() = sp.getInt("poll_seconds", DEFAULT_POLL_SECONDS)
        set(value) = sp.edit().putInt("poll_seconds", value.coerceIn(MIN_POLL_SECONDS, MAX_POLL_SECONDS)).apply()

    var trackAllApps: Boolean
        get() = sp.getBoolean("track_all", true)
        set(value) = sp.edit().putBoolean("track_all", value).apply()

    var watchlist: Set<String>
        get() = sp.getStringSet("watchlist", emptySet())?.toSet() ?: emptySet()
        set(value) = sp.edit().putStringSet("watchlist", value.toSet()).apply()

    var monitoringEnabled: Boolean
        get() = sp.getBoolean("monitoring", false)
        set(value) = sp.edit().putBoolean("monitoring", value).apply()

    /** Random per-install id; survives app restarts, reset only by clearing app data. */
    val deviceId: String
        @Synchronized get() = sp.getString("device_id", null)
            ?: UUID.randomUUID().toString().also { sp.edit().putString("device_id", it).commit() }

    // Tracker state, so a service restart continues the current session.
    val trackedPackage: String? get() = sp.getString("tracked_pkg", null)
    val trackedSinceMs: Long get() = sp.getLong("tracked_since", 0L)
    val lastQueryMs: Long get() = sp.getLong("last_query", 0L)

    fun saveTracker(pkg: String?, sinceMs: Long, lastQueryMs: Long) {
        sp.edit()
            .putString("tracked_pkg", pkg)
            .putLong("tracked_since", sinceMs)
            .putLong("last_query", lastQueryMs)
            .apply()
    }

    fun resetTracker() = saveTracker(null, 0L, 0L)
}
