package com.muse.eventbridge

import java.net.URI

// Pure (Android-free) logic, covered by src/test unit tests.

object EventTypes {
    const val FOREGROUND = "app_foreground"
    const val BACKGROUND = "app_background"
    const val TEST = "test"
}

object Priority {
    const val NORMAL = "normal"
    const val HIGH = "high"
}

data class Transition(
    val type: String,
    val packageName: String,
    val timeMs: Long,
    val sessionSeconds: Long? = null,
)

/**
 * Turns a stream of "this package is now in front" observations into
 * foreground/background transitions. A null package means nothing is in front
 * (screen turned off), which ends the current session.
 */
class SessionTracker(current: String? = null, since: Long = 0L) {
    var current: String? = current
        private set
    var since: Long = since
        private set

    fun observe(packageName: String?, timeMs: Long): List<Transition> {
        if (packageName == current) return emptyList()
        val out = ArrayList<Transition>(2)
        current?.let { prev ->
            val seconds = (timeMs - since).coerceAtLeast(0L) / 1000L
            out += Transition(EventTypes.BACKGROUND, prev, timeMs, seconds)
        }
        if (packageName != null) out += Transition(EventTypes.FOREGROUND, packageName, timeMs)
        current = packageName
        since = timeMs
        return out
    }
}

fun isHttpsUrl(url: String): Boolean = try {
    val uri = URI(url.trim())
    uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank()
} catch (e: Exception) {
    false
}

private val PACKAGE_NAME = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$")

fun isValidPackageName(name: String): Boolean = PACKAGE_NAME.matches(name)

fun shouldReport(packageName: String, trackAllApps: Boolean, watchlist: Set<String>): Boolean =
    trackAllApps || packageName in watchlist

fun priorityFor(packageName: String, watchlist: Set<String>): String =
    if (packageName in watchlist) Priority.HIGH else Priority.NORMAL

const val BACKOFF_BASE_MS = 10_000L
const val BACKOFF_MAX_MS = 30 * 60_000L

/** Delay before retry number [attempts] (1-based): 10s, 20s, 40s ... capped at 30 min. */
fun backoffMillis(attempts: Int): Long {
    val exp = (attempts - 1).coerceIn(0, 20)
    return minOf(BACKOFF_BASE_MS shl exp, BACKOFF_MAX_MS)
}

/** Status codes that retrying won't fix (bad token, bad URL, redirects we refuse to follow). */
fun isPermanentFailure(code: Int): Boolean =
    code in 300..499 && code != 408 && code != 429
