package com.muse.eventbridge

import android.content.Context
import android.util.Log
import java.io.IOException
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

/**
 * Delivers queued events to the webhook in batches: every [BATCH_WINDOW_MS], or
 * immediately once [BATCH_MAX_SIZE] are queued, all due events go out as a single
 * JSON array. Failures back off (exponential + jitter, 429 honours Retry-After) and
 * only the events actually accepted are cleared. The test event is sent on its own,
 * immediately, as a single JSON object.
 *
 * Every entry point is @Synchronized on this singleton, so at most one POST is in
 * flight at a time — we never hammer the endpoint.
 */
object EventSender {
    private const val TAG = "EventSender"

    /** Cap on events per POST so a long outage can't build one enormous request. */
    private const val MAX_BATCH_READ = 500

    /** For sends triggered from the UI (test event, retry) outside the service thread. */
    val io: ExecutorService = Executors.newSingleThreadExecutor()

    private class PostResult(val code: Int?, val error: String?, val retryAfterMs: Long? = null)

    /**
     * Sends due events in batches. When [force] is false, a partial batch waits out the
     * batch window; when true (explicit retry), it goes now. Returns milliseconds until the
     * next flush should be attempted, or null when nothing is pending.
     */
    @Synchronized
    fun flush(context: Context, force: Boolean = false): Long? {
        val prefs = Prefs(context)
        val store = EventStore.get(context)
        val url = prefs.endpoint
        if (!isHttpsUrl(url)) {
            store.setPendingDetail(
                if (url.isBlank()) "Waiting: no endpoint configured"
                else "Blocked: endpoint must be https://"
            )
            return null
        }
        val token = prefs.token

        var batch = store.due(System.currentTimeMillis(), MAX_BATCH_READ)
        if (batch.isEmpty()) return timeUntilNext(store)

        // Batch-window gate: hold a small, fresh batch back until it fills or ages out.
        // A due retry (attempts > 0) or an explicit flush always sends now.
        if (!force) {
            val now = System.currentTimeMillis()
            val hasRetry = batch.any { it.attempts > 0 }
            val oldest = batch.minOf { it.createdMs }
            if (batch.size < BATCH_MAX_SIZE && !hasRetry && now - oldest < BATCH_WINDOW_MS) {
                return (oldest + BATCH_WINDOW_MS - now).coerceAtLeast(1_000L)
            }
        }

        while (batch.isNotEmpty()) {
            val result = post(url, token, batchArrayJson(batch.map { it.payload }))
            val code = result.code
            when {
                code != null && code in 200..299 -> {
                    store.markSentBatch(batch, code)
                    store.logBatch(batch.size, code, ok = true, detail = "batch (${batch.size} events) -> HTTP $code")
                    // More may have queued or come due while we were sending.
                    batch = store.due(System.currentTimeMillis(), MAX_BATCH_READ)
                }
                code != null && isPermanentFailure(code) -> {
                    store.markFailedBatch(batch, code, "Rejected by endpoint (not retried)")
                    store.logBatch(
                        batch.size, code, ok = false,
                        detail = "batch (${batch.size} events) -> HTTP $code (rejected, not retried)"
                    )
                    break // one bad-request batch is enough; don't fire the whole backlog at a 4xx
                }
                else -> {
                    val attempts = batch.maxOf { it.attempts } + 1
                    val delay = when {
                        code == 429 && result.retryAfterMs != null -> result.retryAfterMs
                        else -> withJitter(batchBackoffMillis(attempts), Math.random())
                    }.coerceIn(1_000L, BATCH_RETRY_CAP_MS)
                    val retryAt = System.currentTimeMillis() + delay
                    val why = result.error ?: "HTTP $code"
                    store.rescheduleBatch(batch, retryAt, code, "Retry in ${delay / 1000}s: $why")
                    store.deferPending(retryAt) // hold the rest of the queue back too
                    val label = code?.let { "HTTP $it" } ?: "no response"
                    store.logBatch(
                        batch.size, code, ok = false,
                        detail = "batch (${batch.size} events) -> $label (retry in ${delay / 1000}s)"
                    )
                    Log.w(TAG, "batch send failed ($why); backing off ${delay}ms")
                    break
                }
            }
        }
        return timeUntilNext(store)
    }

    /**
     * The "Send test event" button: one event, one immediate POST of a single JSON object.
     * On success it's cleared; on transient failure it stays queued and rides the next batch.
     */
    @Synchronized
    fun sendTestEvent(context: Context): Boolean {
        val prefs = Prefs(context)
        val store = EventStore.get(context)
        val url = prefs.endpoint
        if (!isHttpsUrl(url)) return false

        val event = EventFactory.test(context, prefs)
        val id = store.enqueue(event)
        val result = post(url, prefs.token, event.payload)
        val code = result.code
        return when {
            code != null && code in 200..299 -> {
                store.markSent(id, 1, code); true
            }
            code != null && isPermanentFailure(code) -> {
                store.markFailed(id, 1, code, "Rejected by endpoint (not retried)"); false
            }
            else -> {
                // Leave it pending so the batch flusher retries it with everything else.
                val why = result.error ?: "HTTP $code"
                store.reschedule(id, 1, System.currentTimeMillis(), code, "Queued for retry: $why")
                false
            }
        }
    }

    private fun timeUntilNext(store: EventStore): Long? {
        val next = store.nextPendingAttemptMs() ?: return null
        return (next - System.currentTimeMillis()).coerceAtLeast(1_000L)
    }

    private fun post(url: String, token: String, body: String): PostResult {
        var conn: HttpsURLConnection? = null
        return try {
            // The cast is the last line of defence: a non-TLS URL never gets a connection.
            conn = URL(url).openConnection() as? HttpsURLConnection
                ?: return PostResult(null, "Blocked: not an HTTPS connection")
            val bytes = body.toByteArray(Charsets.UTF_8)
            conn.requestMethod = "POST"
            conn.connectTimeout = 10_000
            conn.readTimeout = 15_000
            conn.doOutput = true
            conn.useCaches = false
            conn.instanceFollowRedirects = false
            conn.setFixedLengthStreamingMode(bytes.size)
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("X-Event-Token", token)
            conn.setRequestProperty("User-Agent", "MuseEventBridge/1.0")
            conn.outputStream.use { it.write(bytes) }
            val code = conn.responseCode
            val retryAfter = if (code == 429) parseRetryAfter(conn) else null
            // Drain so the connection can be reused.
            (if (code >= 400) conn.errorStream else conn.inputStream)?.use { it.readBytes() }
            PostResult(code, null, retryAfter)
        } catch (e: IOException) {
            PostResult(null, "${e.javaClass.simpleName}: ${e.message}")
        } finally {
            conn?.disconnect()
        }
    }

    /** Retry-After may be a number of seconds or an HTTP-date; honour either. */
    private fun parseRetryAfter(conn: HttpsURLConnection): Long? {
        val header = conn.getHeaderField("Retry-After") ?: return null
        retryAfterMillis(header)?.let { return it }
        val dateMs = conn.getHeaderFieldDate("Retry-After", -1L)
        if (dateMs <= 0) return null
        val delta = dateMs - System.currentTimeMillis()
        return if (delta <= 0) 1_000L else delta.coerceIn(1_000L, BATCH_RETRY_CAP_MS)
    }
}
