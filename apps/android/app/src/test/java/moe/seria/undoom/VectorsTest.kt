package moe.seria.undoom

import java.io.File
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VectorsTest {
    @Serializable
    data class VectorEvent(
        val kind: String,
        val eventId: String,
        val startAt: Long = 0,
        val durationMs: Long = 0,
        val at: Long = 0,
    )

    @Serializable
    data class Expected(val at: Long, val blocked: Boolean, val restUntil: Long?, val remainingMs: Long)

    @Serializable
    data class Vector(val description: String, val limits: VectorLimits, val events: List<VectorEvent>, val expect: List<Expected>)

    @Serializable
    data class VectorLimits(val sessionMs: Long, val restMs: Long)

    @Test
    fun allVectors() {
        val files = File(System.getProperty("undoom.vectors")!!).listFiles { f -> f.name.endsWith(".json") }!!.sorted()
        assertTrue(files.isNotEmpty())
        for (file in files) {
            val vector = Json.decodeFromString<Vector>(file.readText())
            val limits = Limits(vector.limits.sessionMs, vector.limits.restMs)
            val events = vector.events.map {
                if (it.kind == "usage") Usage(it.eventId, "t", it.startAt, it.durationMs) else Unlock(it.eventId, "t", it.at)
            }
            val state = replay(limits, events)
            for (e in vector.expect) {
                assertEquals("${file.name} at ${e.at}", Status(e.blocked, e.restUntil, e.remainingMs), status(state, limits, e.at))
            }
        }
    }
}
