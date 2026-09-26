package com.muse.eventbridge


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

private val PACKAGE_NAME = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$")

fun isValidPackageName(name: String): Boolean = PACKAGE_NAME.matches(name)

fun shouldReport(packageName: String, trackAllApps: Boolean, watchlist: Set<String>): Boolean =
    trackAllApps || packageName in watchlist

fun priorityFor(packageName: String, watchlist: Set<String>): String =
    if (packageName in watchlist) Priority.HIGH else Priority.NORMAL

// --- Batch delivery ---

/** Trigger a batch publish once this many events are queued, without waiting for the window. */
const val BATCH_MAX_SIZE = 20

/** Otherwise publish whatever is queued once the oldest event has waited this long. */
const val BATCH_WINDOW_MS = 60_000L

/** Notification big-text payloads stay under this so Android never truncates them. */
const val NOTIFY_MAX_BYTES = 4096

/** Number of most-recent events the sync notification keeps in its rolling window. */
const val NOTIFY_WINDOW = 50

/** Each payload is already a JSON object; join them into one array without re-parsing. */
fun batchArrayJson(payloads: List<String>): String =
    payloads.joinToString(separator = ",", prefix = "[", postfix = "]")

/** UTF-8 byte size of the JSON array these payloads would form. */
fun batchArrayBytes(payloads: List<String>): Int =
    batchArrayJson(payloads).toByteArray(Charsets.UTF_8).size

/**
 * Longest prefix of [payloads] (oldest first) whose JSON array fits within [maxBytes].
 * Always returns at least the first event, so an over-large single event still makes
 * progress instead of wedging the queue. The rest ride the next flush.
 */
fun takePrefixWithinBytes(payloads: List<String>, maxBytes: Int): List<String> {
    if (payloads.isEmpty()) return emptyList()
    var end = 1
    while (end < payloads.size && batchArrayBytes(payloads.subList(0, end + 1)) <= maxBytes) end++
    return payloads.subList(0, end)
}

/**
 * Longest suffix of [payloads] (chronological in, most-recent kept) whose JSON array
 * fits within [maxBytes]. Used to build the rolling notification window; always keeps
 * at least the most recent event.
 */
fun takeSuffixWithinBytes(payloads: List<String>, maxBytes: Int): List<String> {
    if (payloads.isEmpty()) return emptyList()
    var start = payloads.size - 1
    while (start > 0 && batchArrayBytes(payloads.subList(start - 1, payloads.size)) <= maxBytes) start--
    return payloads.subList(start, payloads.size)
}

/**
 * Collapses (package, lastUsedMs) samples (one per usage-stats bucket) into one
 * entry per package, most recent first.
 */
fun mostRecentPackages(
    samples: List<Pair<String, Long>>,
    exclude: Set<String>,
    limit: Int,
): List<Pair<String, Long>> =
    samples
        .filter { (pkg, t) -> t > 0 && pkg !in exclude }
        .groupBy({ it.first }, { it.second })
        .map { (pkg, times) -> pkg to times.max() }
        .sortedByDescending { it.second }
        .take(limit)
