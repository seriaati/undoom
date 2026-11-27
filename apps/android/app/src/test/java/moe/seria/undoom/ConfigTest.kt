package moe.seria.undoom

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private const val MIN = 60_000L

class ConfigTest {
    private val reddit = TargetEdit("t1", null, listOf("reddit"), 5 * MIN, 60 * MIN)
    private val base = Config(1, listOf(reddit.toTarget(null)), emptyList())
    private fun edit(vararg targets: TargetEdit) = ConfigEdit(targets.toList(), emptyList())
    private val resting = { _: String -> true }
    private val notResting = { _: String -> false }

    @Test
    fun appliesAnyChangeToATargetThatIsntResting() {
        val next = applyEdit(base, edit(reddit.copy(sessionMs = 30 * MIN)), notResting)
        assertEquals(2, next.version)
        assertEquals(30 * MIN, next.targets[0].sessionMs)
        assertNull(next.targets[0].pending)
    }

    @Test
    fun appliesTighteningToARestingTargetImmediately() {
        val next = applyEdit(base, edit(reddit.copy(sessionMs = 2 * MIN, restMs = 90 * MIN)), resting)
        assertEquals(reddit.copy(sessionMs = 2 * MIN, restMs = 90 * MIN).toTarget(null), next.targets[0])
    }

    @Test
    fun defersLooseningOfARestingTarget() {
        val loose = reddit.copy(sessionMs = 30 * MIN, restMs = 10 * MIN, entryIds = emptyList())
        val next = applyEdit(base, edit(loose), resting)
        assertEquals(
            reddit.toTarget(PendingChange.Update(emptyList(), 30 * MIN, 10 * MIN)),
            next.targets[0],
        )
    }

    @Test
    fun splitsAMixedEdit() {
        val mixed = reddit.copy(sessionMs = 2 * MIN, restMs = 10 * MIN, entryIds = listOf("reddit", "x"))
        val next = applyEdit(base, edit(mixed), resting)
        assertEquals(
            Target("t1", null, listOf("reddit", "x"), 2 * MIN, 60 * MIN, PendingChange.Update(listOf("reddit", "x"), 2 * MIN, 10 * MIN)),
            next.targets[0],
        )
    }

    @Test
    fun defersDeletingARestingTarget() {
        val next = applyEdit(base, edit(), resting)
        assertEquals("t1", next.targets[0].id)
        assertEquals(PendingChange.Delete, next.targets[0].pending)
        assertEquals(emptyList<Target>(), applyEdit(base, edit(), notResting).targets)
    }

    @Test
    fun aNewEditReplacesThePendingChange() {
        val first = applyEdit(base, edit(reddit.copy(sessionMs = 30 * MIN)), resting)
        val second = applyEdit(first, edit(reddit.copy(sessionMs = 10 * MIN)), resting)
        assertEquals(10 * MIN, (second.targets[0].pending as PendingChange.Update).sessionMs)
        val undone = applyEdit(second, edit(reddit), resting)
        assertNull(undone.targets[0].pending)
    }

    @Test
    fun defersNewExclusionsOfARestingTargetAndDropsRemovedOnesNow() {
        val start = applyEdit(base, edit(reddit.copy(excludeDomains = listOf("a.reddit.com", "b.reddit.com"))), notResting)
        val next = applyEdit(start, edit(reddit.copy(excludeDomains = listOf("a.reddit.com", "c.reddit.com"))), resting)
        assertEquals(listOf("a.reddit.com"), next.targets[0].excludeDomains)
        assertEquals(listOf("a.reddit.com", "c.reddit.com"), (next.targets[0].pending as PendingChange.Update).excludeDomains)
        val removed = applyEdit(start, edit(reddit), resting)
        assertEquals(emptyList<String>(), removed.targets[0].excludeDomains)
        assertNull(removed.targets[0].pending)
    }

    private val pendingConfig = applyEdit(base, edit(reddit.copy(sessionMs = 30 * MIN)), resting)

    @Test
    fun keepsTheStrictSettingsWhileResting() {
        assertEquals(5 * MIN, effectiveConfig(pendingConfig, resting).targets[0].sessionMs)
    }

    @Test
    fun appliesPendingChangesOnceTheRestIsOver() {
        assertEquals(reddit.copy(sessionMs = 30 * MIN).toTarget(null), effectiveConfig(pendingConfig, notResting).targets[0])
        val deleting = applyEdit(base, edit(), resting)
        assertEquals(emptyList<Target>(), effectiveConfig(deleting, notResting).targets)
    }

    @Test
    fun desiredEditShowsWhatTheUserAskedFor() {
        assertEquals(30 * MIN, desiredEdit(pendingConfig).targets[0].sessionMs)
        assertEquals(emptyList<TargetEdit>(), desiredEdit(applyEdit(base, edit(), resting)).targets)
    }

    @Test
    fun matchesAndroidPackages() {
        val catalog = listOf(Entry("reddit", "Reddit", listOf("reddit.com"), listOf("com.reddit.frontpage")))
        val config = base.copy(
            customEntries = listOf(Entry("custom:1", "News", emptyList(), listOf("com.example.news"))),
            targets = base.targets + reddit.copy(id = "t2", entryIds = listOf("custom:1")).toTarget(null),
        )
        assertEquals(listOf("t1"), targetsForPackage(config, catalog, "com.reddit.frontpage").map { it.id })
        assertEquals(listOf("t2"), targetsForPackage(config, catalog, "com.example.news").map { it.id })
        assertEquals(emptyList<Target>(), targetsForPackage(config, catalog, "com.example"))
    }

    @Test
    fun serializesLikeTheServer() {
        val config = applyEdit(base, edit(), resting)
        val encoded = json.encodeToString(Config.serializer(), config)
        assertEquals(
            """{"version":2,"targets":[{"id":"t1","name":null,"entryIds":["reddit"],"sessionMs":300000,"restMs":3600000,"pending":{"kind":"delete"},"excludeDomains":[]}],"customEntries":[]}""",
            encoded,
        )
        assertEquals(config, json.decodeFromString(Config.serializer(), encoded))
        val event: SyncEvent = Usage("d:1", "t1", 5, 10)
        assertEquals(
            """{"kind":"usage","eventId":"d:1","targetId":"t1","startAt":5,"durationMs":10}""",
            json.encodeToString(SyncEvent.serializer(), event),
        )
    }
}
