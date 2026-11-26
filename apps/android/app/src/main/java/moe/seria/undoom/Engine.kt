package moe.seria.undoom

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Port of packages/engine. Behaviour must match the TypeScript; spec/vectors checks both.

/** All times are epoch milliseconds in server time. */
@Serializable
data class TargetState(val usedMs: Long, val lastActiveAt: Long?, val restUntil: Long?)

val initialState = TargetState(0, null, null)

data class Limits(val sessionMs: Long, val restMs: Long)

data class Status(val blocked: Boolean, val restUntil: Long?, val remainingMs: Long)

@Serializable
sealed interface SyncEvent {
    val eventId: String
    val targetId: String
    val time: Long
}

@Serializable
@SerialName("usage")
data class Usage(
    override val eventId: String,
    override val targetId: String,
    val startAt: Long,
    val durationMs: Long,
) : SyncEvent {
    override val time get() = startAt
}

@Serializable
@SerialName("unlock")
data class Unlock(override val eventId: String, override val targetId: String, val at: Long) : SyncEvent {
    override val time get() = at
}

fun applyUsage(state: TargetState, limits: Limits, startAt: Long, durationMs: Long): TargetState {
    val lastActiveAt = maxOf(state.lastActiveAt ?: Long.MIN_VALUE, startAt + durationMs)

    // Usage inside a rest only happens when offline usage from several devices is
    // merged. The user wasn't actually resting, so the rest restarts after it.
    if (state.restUntil != null && startAt < state.restUntil) {
        return TargetState(0, lastActiveAt, lastActiveAt + limits.restMs)
    }

    val awayLongEnough = state.lastActiveAt != null && startAt - state.lastActiveAt >= limits.restMs
    val usedMs = (if (awayLongEnough) 0 else state.usedMs) + durationMs

    if (usedMs >= limits.sessionMs) {
        return TargetState(0, lastActiveAt, lastActiveAt + limits.restMs)
    }
    return TargetState(usedMs, lastActiveAt, null)
}

fun applyUnlock(state: TargetState) = TargetState(0, state.lastActiveAt, null)

fun status(state: TargetState, limits: Limits, now: Long): Status {
    if (state.restUntil != null && now < state.restUntil) {
        return Status(true, state.restUntil, 0)
    }
    val awayLongEnough = state.lastActiveAt != null && now - state.lastActiveAt >= limits.restMs
    val usedMs = if (awayLongEnough) 0 else state.usedMs
    return Status(false, null, limits.sessionMs - usedMs)
}

/** Order-independent and idempotent: events are deduplicated by eventId and applied in time order. */
fun replay(limits: Limits, events: List<SyncEvent>, from: TargetState = initialState): TargetState =
    events.associateBy { it.eventId }.values
        .sortedWith(compareBy<SyncEvent> { it.time }.thenBy { it.eventId })
        .fold(from) { state, e ->
            when (e) {
                is Usage -> applyUsage(state, limits, e.startAt, e.durationMs)
                is Unlock -> applyUnlock(state)
            }
        }

@Serializable
data class Entry(val id: String, val name: String, val domains: List<String>, val packages: List<String>)

@Serializable
sealed interface PendingChange {
    @Serializable
    @SerialName("update")
    data class Update(val entryIds: List<String>, val sessionMs: Long, val restMs: Long) : PendingChange

    @Serializable
    @SerialName("delete")
    data object Delete : PendingChange
}

@Serializable
data class Target(
    val id: String,
    /** null for a single-entry target; groups have a name. */
    val name: String?,
    val entryIds: List<String>,
    val sessionMs: Long,
    val restMs: Long,
    /** A loosening change made while the target was resting. It applies when the rest ends. */
    val pending: PendingChange?,
) {
    val limits get() = Limits(sessionMs, restMs)
}

@Serializable
data class Config(val version: Long, val targets: List<Target>, val customEntries: List<Entry>)

@Serializable
data class TargetEdit(
    val id: String,
    val name: String?,
    val entryIds: List<String>,
    val sessionMs: Long,
    val restMs: Long,
)

@Serializable
data class ConfigEdit(val targets: List<TargetEdit>, val customEntries: List<Entry>)

val emptyConfig = Config(0, emptyList(), emptyList())

/** Applies the pending change of every target that isn't resting. */
fun effectiveConfig(config: Config, isResting: (String) -> Boolean): Config =
    config.copy(targets = config.targets.mapNotNull { target ->
        val pending = target.pending
        when {
            pending == null || isResting(target.id) -> target
            pending is PendingChange.Update -> target.copy(
                entryIds = pending.entryIds,
                sessionMs = pending.sessionMs,
                restMs = pending.restMs,
                pending = null,
            )
            else -> null
        }
    })

/**
 * Applies a user's edit. Targets that aren't resting take the edit as is. For a resting
 * target, tightening applies now and loosening waits for the rest to end: the target keeps
 * the stricter of old and new settings, with the edit stored as pending.
 */
fun applyEdit(current: Config, edit: ConfigEdit, isResting: (String) -> Boolean): Config {
    val existing = LinkedHashMap(effectiveConfig(current, isResting).targets.associateBy { it.id })
    val targets = mutableListOf<Target>()

    for (next in edit.targets) {
        val old = existing.remove(next.id)
        if (old == null || !isResting(next.id)) {
            targets += next.toTarget(null)
            continue
        }
        val sessionMs = minOf(old.sessionMs, next.sessionMs)
        val restMs = maxOf(old.restMs, next.restMs)
        val entryIds = (old.entryIds + next.entryIds).distinct()
        val loosens = sessionMs != next.sessionMs || restMs != next.restMs || entryIds.size != next.entryIds.size
        targets += Target(
            next.id,
            next.name,
            entryIds,
            sessionMs,
            restMs,
            if (loosens) PendingChange.Update(next.entryIds, next.sessionMs, next.restMs) else null,
        )
    }

    for (removed in existing.values) {
        if (isResting(removed.id)) targets += removed.copy(pending = PendingChange.Delete)
    }

    return Config(current.version + 1, targets, edit.customEntries)
}

fun TargetEdit.toTarget(pending: PendingChange?) = Target(id, name, entryIds, sessionMs, restMs, pending)

fun targetsForPackage(config: Config, catalog: List<Entry>, pkg: String): List<Target> {
    val matched = (catalog + config.customEntries).filter { pkg in it.packages }.map { it.id }.toSet()
    return config.targets.filter { t -> t.entryIds.any { it in matched } }
}

/** What the user asked for, with every pending change applied. Clients edit from this. */
fun desiredEdit(config: Config): ConfigEdit {
    val effective = effectiveConfig(config) { false }
    return ConfigEdit(
        effective.targets.map { TargetEdit(it.id, it.name, it.entryIds, it.sessionMs, it.restMs) },
        effective.customEntries,
    )
}
