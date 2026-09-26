package com.muse.eventbridge

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class OutgoingEvent(
    val type: String,
    val packageName: String,
    val appLabel: String,
    val priority: String,
    val timeMs: Long,
    val payload: String,
)

data class QueuedEvent(val id: Long, val payload: String, val attempts: Int, val createdMs: Long)

data class LogRow(
    val id: Long,
    val createdMs: Long,
    val type: String,
    val packageName: String,
    val appLabel: String,
    val priority: String,
    val state: String,
    val attempts: Int,
    val nextAttemptMs: Long,
    val httpCode: Int?,
    val detail: String?,
)

/**
 * One SQLite table is both the retry queue (state = pending) and the event log
 * (the most recent rows, whatever their state). Survives process death and reboot.
 */
class EventStore private constructor(context: Context) :
    SQLiteOpenHelper(context, "events.db", null, 1) {

    companion object {
        const val PENDING = "pending"
        const val SENT = "sent"
        const val FAILED = "failed"

        /** Synthetic log-only row recording a notification update; never queued for sending. */
        const val EVENT_TYPE_NOTIFY = "notify"

        private const val KEEP_HISTORY = 200
        private const val MAX_PENDING = 5000

        @Volatile private var instance: EventStore? = null

        fun get(context: Context): EventStore = instance ?: synchronized(this) {
            instance ?: EventStore(context.applicationContext).also { instance = it }
        }
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_ms INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                package_name TEXT NOT NULL,
                app_label TEXT NOT NULL,
                priority TEXT NOT NULL,
                payload TEXT NOT NULL,
                state TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt_ms INTEGER NOT NULL DEFAULT 0,
                http_code INTEGER,
                detail TEXT
            )"""
        )
        db.execSQL("CREATE INDEX idx_events_state ON events(state, next_attempt_ms)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS events")
        onCreate(db)
    }

    /** Returns the new row id so a single/immediate send can update just that row. */
    fun enqueue(event: OutgoingEvent): Long {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val id = db.insert("events", null, ContentValues().apply {
                put("created_ms", event.timeMs)
                put("event_type", event.type)
                put("package_name", event.packageName)
                put("app_label", event.appLabel)
                put("priority", event.priority)
                put("payload", event.payload)
                put("state", PENDING)
                put("detail", "Queued")
            })
            // Keep the log bounded, and cap the backlog if the endpoint is down for days.
            db.execSQL(
                "DELETE FROM events WHERE state != ? AND id NOT IN " +
                    "(SELECT id FROM events WHERE state != ? ORDER BY id DESC LIMIT $KEEP_HISTORY)",
                arrayOf(PENDING, PENDING)
            )
            db.execSQL(
                "DELETE FROM events WHERE state = ? AND id NOT IN " +
                    "(SELECT id FROM events WHERE state = ? ORDER BY id DESC LIMIT $MAX_PENDING)",
                arrayOf(PENDING, PENDING)
            )
            db.setTransactionSuccessful()
            return id
        } finally {
            db.endTransaction()
        }
    }

    fun due(nowMs: Long, limit: Int): List<QueuedEvent> =
        readableDatabase.rawQuery(
            "SELECT id, payload, attempts, created_ms FROM events WHERE state = ? AND next_attempt_ms <= ? ORDER BY id LIMIT $limit",
            arrayOf(PENDING, nowMs.toString())
        ).use { c ->
            buildList {
                while (c.moveToNext()) add(QueuedEvent(c.getLong(0), c.getString(1), c.getInt(2), c.getLong(3)))
            }
        }

    fun markSent(id: Long, attempts: Int, code: Int) = update(id, ContentValues().apply {
        put("state", SENT)
        put("attempts", attempts)
        put("http_code", code)
        put("detail", "Delivered")
    })

    fun markFailed(id: Long, attempts: Int, code: Int, detail: String) = update(id, ContentValues().apply {
        put("state", FAILED)
        put("attempts", attempts)
        put("http_code", code)
        put("detail", detail)
    })

    /** Mark every event published in a notification update as synced, in one transaction. */
    fun markSyncedBatch(events: List<QueuedEvent>) = inTransaction {
        for (e in events) markSynced(e.id)
    }

    /** Mark one event as published to the notification (no HTTP code involved). */
    fun markSynced(id: Long) = update(id, ContentValues().apply {
        put("state", SENT)
        putNull("http_code")
        put("detail", "Synced")
    })

    /** Records one notification update in the event log. Not queued for sending. */
    fun logNotify(count: Int) {
        writableDatabase.insert("events", null, ContentValues().apply {
            put("created_ms", System.currentTimeMillis())
            put("event_type", EVENT_TYPE_NOTIFY)
            put("package_name", "")
            put("app_label", "")
            put("priority", "normal")
            put("payload", "")
            put("state", SENT)
            put("attempts", count)
            putNull("http_code")
            put("detail", "notify ($count events)")
        })
    }

    /** Payloads of the most recent synced app/test events, oldest first (for the rolling window). */
    fun recentSyncedPayloads(limit: Int): List<String> =
        readableDatabase.rawQuery(
            "SELECT payload FROM events WHERE state = ? AND event_type != ? ORDER BY id DESC LIMIT $limit",
            arrayOf(SENT, EVENT_TYPE_NOTIFY)
        ).use { c ->
            buildList { while (c.moveToNext()) add(c.getString(0)) }.asReversed()
        }

    fun reschedule(id: Long, attempts: Int, nextAttemptMs: Long, code: Int?, detail: String) =
        update(id, ContentValues().apply {
            put("attempts", attempts)
            put("next_attempt_ms", nextAttemptMs)
            if (code == null) putNull("http_code") else put("http_code", code)
            put("detail", detail)
        })

    /** After a transient failure, hold the rest of the queue back too so we don't hammer a dead endpoint. */
    fun deferPending(untilMs: Long) {
        writableDatabase.execSQL(
            "UPDATE events SET next_attempt_ms = ? WHERE state = ? AND next_attempt_ms < ?",
            arrayOf(untilMs, PENDING, untilMs)
        )
    }

    /** Network came back (or user tapped retry): everything pending is due now. */
    fun makePendingDueNow() {
        writableDatabase.execSQL("UPDATE events SET next_attempt_ms = 0 WHERE state = ?", arrayOf(PENDING))
    }

    fun setPendingDetail(detail: String) {
        writableDatabase.execSQL("UPDATE events SET detail = ? WHERE state = ?", arrayOf(detail, PENDING))
    }

    fun nextPendingAttemptMs(): Long? =
        readableDatabase.rawQuery(
            "SELECT MIN(next_attempt_ms) FROM events WHERE state = ?", arrayOf(PENDING)
        ).use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null }

    fun pendingCount(): Int =
        readableDatabase.rawQuery("SELECT COUNT(*) FROM events WHERE state = ?", arrayOf(PENDING))
            .use { c -> if (c.moveToFirst()) c.getInt(0) else 0 }

    fun oldestPendingCreatedMs(): Long? =
        readableDatabase.rawQuery(
            "SELECT MIN(created_ms) FROM events WHERE state = ?", arrayOf(PENDING)
        ).use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null }

    fun recent(limit: Int = 50): List<LogRow> =
        readableDatabase.rawQuery(
            "SELECT id, created_ms, event_type, package_name, app_label, priority, state, attempts, " +
                "next_attempt_ms, http_code, detail FROM events ORDER BY id DESC LIMIT $limit",
            null
        ).use { c ->
            buildList {
                while (c.moveToNext()) add(
                    LogRow(
                        id = c.getLong(0),
                        createdMs = c.getLong(1),
                        type = c.getString(2),
                        packageName = c.getString(3),
                        appLabel = c.getString(4),
                        priority = c.getString(5),
                        state = c.getString(6),
                        attempts = c.getInt(7),
                        nextAttemptMs = c.getLong(8),
                        httpCode = if (c.isNull(9)) null else c.getInt(9),
                        detail = if (c.isNull(10)) null else c.getString(10),
                    )
                )
            }
        }

    private fun update(id: Long, values: ContentValues) {
        writableDatabase.update("events", values, "id = ?", arrayOf(id.toString()))
    }

    private inline fun inTransaction(body: () -> Unit) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            body()
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }
}
