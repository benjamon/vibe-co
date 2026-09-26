package com.muse.eventbridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LogicTest {
    @Test
    fun firstObservationEmitsForegroundOnly() {
        val t = SessionTracker()
        assertEquals(listOf(Transition(EventTypes.FOREGROUND, "a.game", 1_000)), t.observe("a.game", 1_000))
    }

    @Test
    fun switchingAppsEmitsBackgroundWithDurationThenForeground() {
        val t = SessionTracker()
        t.observe("a.game", 1_000)
        val out = t.observe("b.chat", 321_500)
        assertEquals(
            listOf(
                Transition(EventTypes.BACKGROUND, "a.game", 321_500, 320),
                Transition(EventTypes.FOREGROUND, "b.chat", 321_500),
            ),
            out
        )
    }

    @Test
    fun samePackageIsNotAChange() {
        val t = SessionTracker()
        t.observe("a.game", 1_000)
        assertTrue(t.observe("a.game", 5_000).isEmpty())
        // Session start is still the first resume.
        assertEquals(9L, t.observe(null, 10_000).single().sessionSeconds)
    }

    @Test
    fun screenOffEndsSessionAndNextAppStartsFresh() {
        val t = SessionTracker()
        t.observe("a.game", 0)
        assertEquals(EventTypes.BACKGROUND, t.observe(null, 60_000).single().type)
        assertTrue(t.observe(null, 70_000).isEmpty())
        assertEquals(EventTypes.FOREGROUND, t.observe("a.game", 80_000).single().type)
    }

    @Test
    fun trackerResumesFromPersistedState() {
        val t = SessionTracker("a.game", 10_000)
        assertEquals(50L, t.observe("b.chat", 60_000).first().sessionSeconds)
    }

    @Test
    fun onlyHttpsUrlsAreAccepted() {
        assertTrue(isHttpsUrl("https://webhook.site/1234-abcd"))
        assertTrue(isHttpsUrl("  HTTPS://example.com/hook?x=1 "))
        assertFalse(isHttpsUrl("http://webhook.site/1234"))
        assertFalse(isHttpsUrl("https://"))
        assertFalse(isHttpsUrl("webhook.site/1234"))
        assertFalse(isHttpsUrl(""))
        assertFalse(isHttpsUrl("https://exa mple.com"))
    }

    @Test
    fun packageNameValidation() {
        assertTrue(isValidPackageName("com.onceuponagalaxy"))
        assertTrue(isValidPackageName("com.example.game_2"))
        assertFalse(isValidPackageName("game"))
        assertFalse(isValidPackageName("com..x"))
        assertFalse(isValidPackageName("1com.x"))
    }

    @Test
    fun watchlistDrivesPriorityAndFiltering() {
        val watch = setOf("com.onceuponagalaxy")
        assertEquals(Priority.HIGH, priorityFor("com.onceuponagalaxy", watch))
        assertEquals(Priority.NORMAL, priorityFor("com.android.chrome", watch))
        assertTrue(shouldReport("com.android.chrome", trackAllApps = true, watchlist = watch))
        assertFalse(shouldReport("com.android.chrome", trackAllApps = false, watchlist = watch))
        assertTrue(shouldReport("com.onceuponagalaxy", trackAllApps = false, watchlist = watch))
    }

    @Test
    fun backoffDoublesAndCaps() {
        assertEquals(10_000L, backoffMillis(1))
        assertEquals(20_000L, backoffMillis(2))
        assertEquals(40_000L, backoffMillis(3))
        assertEquals(BACKOFF_MAX_MS, backoffMillis(12))
        assertEquals(BACKOFF_MAX_MS, backoffMillis(1_000))
    }

    @Test
    fun permanentVersusTransientFailures() {
        assertTrue(isPermanentFailure(401))
        assertTrue(isPermanentFailure(404))
        assertTrue(isPermanentFailure(301))
        assertFalse(isPermanentFailure(408))
        assertFalse(isPermanentFailure(429))
        assertFalse(isPermanentFailure(500))
        assertFalse(isPermanentFailure(503))
    }

    @Test
    fun recentPackagesAreMergedSortedAndFiltered() {
        val samples = listOf(
            "a.game" to 100L, "b.chat" to 300L, "a.game" to 500L,
            "c.mail" to 200L, "self.app" to 900L, "d.never" to 0L,
        )
        assertEquals(
            listOf("a.game" to 500L, "b.chat" to 300L),
            mostRecentPackages(samples, exclude = setOf("self.app"), limit = 2)
        )
    }

    @Test
    fun batchBackoffDoublesFrom30sAndCapsAt15Min() {
        assertEquals(30_000L, batchBackoffMillis(1))
        assertEquals(60_000L, batchBackoffMillis(2))
        assertEquals(120_000L, batchBackoffMillis(3))
        assertEquals(BATCH_BACKOFF_MAX_MS, batchBackoffMillis(6))
        assertEquals(BATCH_BACKOFF_MAX_MS, batchBackoffMillis(999))
    }

    @Test
    fun jitterStaysBetweenHalfAndFullDelay() {
        assertEquals(15_000L, withJitter(30_000L, 0.0))
        assertEquals(30_000L - 1, withJitter(30_000L, 0.999999))
        assertEquals(22_500L, withJitter(30_000L, 0.5))
        // Clamped input never escapes the band.
        val j = withJitter(60_000L, 5.0)
        assertTrue(j in 30_000L..60_000L)
    }

    @Test
    fun batchArrayJoinsObjectsIntoOneArray() {
        assertEquals("[]", batchArrayJson(emptyList()))
        assertEquals("[{\"a\":1}]", batchArrayJson(listOf("{\"a\":1}")))
        assertEquals(
            "[{\"a\":1},{\"b\":2}]",
            batchArrayJson(listOf("{\"a\":1}", "{\"b\":2}"))
        )
    }

    @Test
    fun retryAfterParsesSecondsAndRejectsGarbage() {
        assertEquals(120_000L, retryAfterMillis("120"))
        assertEquals(1_000L, retryAfterMillis("0"))          // clamped up to 1s minimum
        assertEquals(BATCH_RETRY_CAP_MS, retryAfterMillis("99999")) // clamped to cap
        assertEquals(null, retryAfterMillis(null))
        assertEquals(null, retryAfterMillis("-5"))
        assertEquals(null, retryAfterMillis("Wed, 21 Oct 2026 07:28:00 GMT")) // HTTP-date handled elsewhere
    }
}
