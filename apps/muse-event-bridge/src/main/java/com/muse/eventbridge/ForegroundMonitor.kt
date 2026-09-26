package com.muse.eventbridge

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context

/**
 * Reads UsageStatsManager events since the last poll and feeds them to a
 * [SessionTracker]. Every resume in between polls is replayed, so a quick
 * app switch shorter than the poll interval is still reported.
 */
class ForegroundMonitor(private val context: Context) {
    private data class Observation(val packageName: String?, val timeMs: Long)

    companion object {
        /** If the last poll is older than this (service was dead, reboot), start fresh. */
        private const val MAX_CATCHUP_MS = 10 * 60_000L
        /** On a fresh start, look back this far to find what is in front right now. */
        private const val PRIME_WINDOW_MS = 60 * 60_000L

        private val IGNORED = setOf("android", "com.android.systemui")
    }

    private val usm = context.getSystemService(UsageStatsManager::class.java)
    private val store = EventStore.get(context)

    /** Returns the number of events queued. */
    fun poll(): Int {
        val prefs = Prefs(context)
        val now = System.currentTimeMillis()
        val last = prefs.lastQueryMs
        val resuming = last > 0 && now - last in 0..MAX_CATCHUP_MS

        val tracker = if (resuming) SessionTracker(prefs.trackedPackage, prefs.trackedSinceMs) else SessionTracker()
        val observed = read(if (resuming) last else now - PRIME_WINDOW_MS, now)
        // Fresh start: only the latest state matters, don't replay an hour of history.
        val toApply = if (resuming) observed else observed.takeLast(1)

        val watchlist = prefs.watchlist
        val trackAll = prefs.trackAllApps
        var queued = 0
        for (o in toApply) {
            for (t in tracker.observe(o.packageName, o.timeMs)) {
                if (!shouldReport(t.packageName, trackAll, watchlist)) continue
                store.enqueue(EventFactory.fromTransition(context, prefs, t))
                queued++
            }
        }
        prefs.saveTracker(tracker.current, tracker.since, now)
        return queued
    }

    private fun read(fromMs: Long, toMs: Long): List<Observation> {
        val events = usm.queryEvents(fromMs, toMs) ?: return emptyList()
        val out = ArrayList<Observation>()
        val e = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            when (e.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED ->
                    if (e.packageName !in IGNORED) out += Observation(e.packageName, e.timeStamp)
                // Screen off ends whatever session was running.
                UsageEvents.Event.SCREEN_NON_INTERACTIVE -> out += Observation(null, e.timeStamp)
            }
        }
        return out
    }
}
