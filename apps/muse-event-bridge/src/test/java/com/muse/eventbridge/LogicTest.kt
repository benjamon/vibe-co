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
    fun batchArrayJoinsObjectsIntoOneArray() {
        assertEquals("[]", batchArrayJson(emptyList()))
        assertEquals("[{\"a\":1}]", batchArrayJson(listOf("{\"a\":1}")))
        assertEquals(
            "[{\"a\":1},{\"b\":2}]",
            batchArrayJson(listOf("{\"a\":1}", "{\"b\":2}"))
        )
    }


    @Test
    fun prefixFitsWithinByteBudget() {
        // "[e]"=3, "[e,e]"=5, "[e,e,e]"=7 bytes: a 5-byte budget fits exactly two.
        val payloads = List(5) { "e" }
        assertEquals(listOf("e", "e"), takePrefixWithinBytes(payloads, maxBytes = 5))
        assertEquals(listOf("e"), takePrefixWithinBytes(payloads, maxBytes = 4))
    }

    @Test
    fun prefixAlwaysMakesProgressEvenWhenSingleEventIsTooBig() {
        val big = "x".repeat(100)
        assertEquals(listOf(big), takePrefixWithinBytes(listOf(big, "y"), maxBytes = 4))
        assertEquals(emptyList<String>(), takePrefixWithinBytes(emptyList(), maxBytes = 4))
    }

    @Test
    fun suffixKeepsMostRecentEventsWithinBudget() {
        val payloads = listOf("a", "b", "c", "d") // chronological; newest = "d"
        // "[c,d]" is 5 bytes, "[b,c,d]" is 7 bytes.
        assertEquals(listOf("c", "d"), takeSuffixWithinBytes(payloads, maxBytes = 6))
        // Always keeps at least the newest, even if it alone overflows.
        assertEquals(listOf("d"), takeSuffixWithinBytes(payloads, maxBytes = 1))
    }

    @Test
    fun windowUnderFourKilobytes() {
        val event = """{"device_id":"abc","timestamp":"2026-09-26T00:00:00Z","event_type":"app_foreground","package_name":"com.example.game","app_label":"Game","priority":"high"}"""
        val kept = takeSuffixWithinBytes(List(100) { event }, NOTIFY_MAX_BYTES)
        assertTrue(batchArrayBytes(kept) <= NOTIFY_MAX_BYTES)
        assertTrue(kept.isNotEmpty())
    }
}
