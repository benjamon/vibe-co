package com.muse.eventbridge

import android.content.Context
import android.util.Log
import java.io.IOException
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

object EventSender {
    private const val TAG = "EventSender"
    private const val BATCH = 25

    /** For sends triggered from the UI (test event, retry) outside the service thread. */
    val io: ExecutorService = Executors.newSingleThreadExecutor()

    private class PostResult(val code: Int?, val error: String?)

    /**
     * Sends every due pending event, oldest first. Returns milliseconds until the
     * next pending event becomes due, or null if nothing is waiting on a timer.
     */
    @Synchronized
    fun flush(context: Context): Long? {
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

        sending@ while (true) {
            val batch = store.due(System.currentTimeMillis(), BATCH)
            if (batch.isEmpty()) break
            for (event in batch) {
                val result = post(url, token, event.payload)
                val code = result.code
                val attempts = event.attempts + 1
                when {
                    code != null && code in 200..299 -> store.markSent(event.id, attempts, code)
                    code != null && isPermanentFailure(code) ->
                        store.markFailed(event.id, attempts, code, "Rejected by endpoint (not retried)")
                    else -> {
                        val retryAt = System.currentTimeMillis() + backoffMillis(attempts)
                        val why = result.error ?: "HTTP $code"
                        store.reschedule(event.id, attempts, retryAt, code, "Retry #$attempts scheduled: $why")
                        store.deferPending(retryAt)
                        Log.w(TAG, "send failed ($why); backing off")
                        break@sending
                    }
                }
            }
        }

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
            // Drain so the connection can be reused.
            (if (code >= 400) conn.errorStream else conn.inputStream)?.use { it.readBytes() }
            PostResult(code, null)
        } catch (e: IOException) {
            PostResult(null, "${e.javaClass.simpleName}: ${e.message}")
        } finally {
            conn?.disconnect()
        }
    }
}
