package com.muse.eventbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Publishes events to Muse through one persistent, completely silent notification
 * instead of the network. Every flush rewrites that notification in place: its big
 * text is a compact JSON array of the most recent events (same objects the HTTP path
 * used), kept under 4 KB, and its summary counts how many have been synced in total.
 *
 * The notification is never auto-cancelled; the receiver reads the rolling window and
 * dedupes by event identity. Batching is unchanged: a flush publishes once the window
 * is due (60s) or 20 events are queued; a batch larger than 4 KB splits across flushes.
 * Every entry point is @Synchronized on this singleton, so updates never overlap.
 */
object NotificationTransport {
    const val CHANNEL = "sync"
    const val NOTIFICATION_ID = 2

    /** Never publish more than this many events per read, so an outage can't build a huge query. */
    private const val MAX_BATCH_READ = 500

    /** For publishes triggered from the UI (test event, flush) off the main thread. */
    val io: ExecutorService = Executors.newSingleThreadExecutor()

    /** Idempotent: safe to call before every publish. */
    fun ensureChannel(context: Context) {
        val channel = NotificationChannel(CHANNEL, "Event sync", NotificationManager.IMPORTANCE_MIN).apply {
            description = "Silent, ongoing feed of foreground-app events for Muse to read"
            setSound(null, null)
            enableVibration(false)
            enableLights(false)
            setShowBadge(false)
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    /**
     * Publishes due events into the notification. When [force] is false a small, fresh
     * batch waits out the 60s window; when true it goes now and the whole queue is drained.
     * Returns milliseconds until the next flush should run, or null when nothing is queued.
     */
    @Synchronized
    fun flush(context: Context, force: Boolean = false): Long? {
        val prefs = Prefs(context)
        val store = EventStore.get(context)
        if (!prefs.notifyEnabled) {
            store.setPendingDetail("Waiting: notification transport is off")
            return null
        }
        ensureChannel(context)

        var progressed = false
        while (true) {
            val now = System.currentTimeMillis()
            val due = store.due(now, MAX_BATCH_READ)
            if (due.isEmpty()) break

            // Gate only the first publish of a flush cycle; once we've started, drain if forced.
            if (!force && !progressed) {
                val hasRetry = due.any { it.attempts > 0 }
                val oldest = due.minOf { it.createdMs }
                if (due.size < BATCH_MAX_SIZE && !hasRetry && now - oldest < BATCH_WINDOW_MS) {
                    return (oldest + BATCH_WINDOW_MS - now).coerceAtLeast(1_000L)
                }
            }

            // Publish as much as fits under 4 KB; the rest rides a later flush.
            val fit = takePrefixWithinBytes(due.map { it.payload }, NOTIFY_MAX_BYTES).size
            val toSend = due.take(fit)
            store.markSyncedBatch(toSend)
            prefs.syncedTotal += toSend.size
            updateNotification(context, store, prefs)
            store.logNotify(toSend.size)
            progressed = true
            if (!force) break // one notification update per flush unless explicitly draining
        }
        return nextDelay(store)
    }

    /** "Send test event": publish/refresh the notification immediately with a test payload. */
    @Synchronized
    fun sendTestEvent(context: Context): Boolean {
        val prefs = Prefs(context)
        val store = EventStore.get(context)
        ensureChannel(context)
        val event = EventFactory.test(context, prefs)
        val id = store.enqueue(event)
        store.markSynced(id)
        prefs.syncedTotal += 1
        updateNotification(context, store, prefs)
        store.logNotify(1)
        return true
    }

    private fun nextDelay(store: EventStore): Long? {
        val oldest = store.oldestPendingCreatedMs() ?: return null
        val wait = oldest + BATCH_WINDOW_MS - System.currentTimeMillis()
        return wait.coerceIn(1_000L, BATCH_WINDOW_MS)
    }

    private fun updateNotification(context: Context, store: EventStore, prefs: Prefs) {
        // Rolling window: the most recent events that fit, newest last, capped at ~50 and 4 KB.
        val window = takeSuffixWithinBytes(store.recentSyncedPayloads(NOTIFY_WINDOW), NOTIFY_MAX_BYTES)
        val json = batchArrayJson(window)
        val summary = "Synced ${prefs.syncedTotal} events"

        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Muse Event Bridge")
            .setContentText(summary)
            .setStyle(Notification.BigTextStyle().setSummaryText(summary).bigText(json))
            .setOngoing(true)          // never swiped away
            .setOnlyAlertOnce(true)    // silent updates
            .setShowWhen(false)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
    }
}
