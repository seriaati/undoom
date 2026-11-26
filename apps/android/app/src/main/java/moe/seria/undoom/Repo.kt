package moe.seria.undoom

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

val json = Json {
    classDiscriminator = "kind"
    ignoreUnknownKeys = true
    encodeDefaults = true
}

@Serializable
data class Snapshot(val config: Config, val states: Map<String, TargetState>, val serverTime: Long)

@Serializable
data class Saved(
    val token: String? = null,
    val deviceId: String = UUID.randomUUID().toString(),
    val seq: Long = 0,
    /** serverTime - local clock, from the latest snapshot. */
    val offset: Long = 0,
    val snapshot: Snapshot? = null,
    val queue: List<SyncEvent> = emptyList(),
    val pendingPut: ConfigEdit? = null,
)

class ApiException(val code: Int, message: String) : IOException(message)

/** Process-wide state. Mutate only on the main thread; network calls hop to IO. */
object Repo {
    private lateinit var file: AtomicFile
    private val _saved = MutableStateFlow(Saved())
    val saved: StateFlow<Saved> = _saved
    lateinit var catalog: List<Entry>
        private set
    val scope: CoroutineScope = MainScope()
    val http = OkHttpClient()
    private var syncing = false

    fun init(context: Context) {
        if (::file.isInitialized) return
        file = AtomicFile(File(context.filesDir, "state.json"))
        _saved.value = try {
            json.decodeFromString<Saved>(file.readFully().decodeToString())
        } catch (_: IOException) {
            Saved().also(::save)
        }
        catalog = context.assets.open("catalog.json").use {
            json.decodeFromString(ListSerializer(Entry.serializer()), it.readBytes().decodeToString())
        }
    }

    private fun update(f: (Saved) -> Saved) {
        val next = f(_saved.value)
        if (next != _saved.value) save(next)
        _saved.value = next
    }

    private fun save(s: Saved) {
        val out = file.startWrite()
        try {
            out.write(json.encodeToString(Saved.serializer(), s).toByteArray())
            file.finishWrite(out)
        } catch (e: IOException) {
            file.failWrite(out)
            throw e
        }
    }

    fun now(s: Saved = _saved.value) = System.currentTimeMillis() + s.offset

    fun localState(target: Target, s: Saved = _saved.value): TargetState =
        replay(
            target.limits,
            s.queue.filter { it.targetId == target.id },
            s.snapshot?.states?.get(target.id) ?: initialState,
        )

    private fun resting(s: Saved, now: Long): (String) -> Boolean {
        val targets = s.snapshot?.config?.targets.orEmpty()
        return { id -> targets.find { it.id == id }?.let { status(localState(it, s), it.limits, now).blocked } ?: false }
    }

    /** The config to enforce: pending changes apply once the local state says the rest is over. */
    fun effective(s: Saved = _saved.value, now: Long = now(s)): Config =
        effectiveConfig(s.snapshot?.config ?: emptyConfig, resting(s, now))

    fun record(events: (deviceId: String, nextSeq: () -> Long) -> List<SyncEvent>) = update { s ->
        var seq = s.seq
        val added = events(s.deviceId) { ++seq }
        s.copy(seq = seq, queue = s.queue + added)
    }

    fun unlock(targetId: String) {
        record { device, next -> listOf(Unlock("$device:${next()}", targetId, now())) }
        flush()
    }

    /** Applies the edit locally right away (so it's enforced offline) and queues it for the server. */
    fun edit(edit: ConfigEdit) {
        update { s ->
            val withSnapshot = if (s.snapshot != null) s else s.copy(snapshot = Snapshot(emptyConfig, emptyMap(), now(s)))
            withLocalEdit(withSnapshot.copy(pendingPut = edit), edit)
        }
        flush()
    }

    private fun withLocalEdit(s: Saved, edit: ConfigEdit): Saved {
        val snapshot = s.snapshot!!
        return s.copy(snapshot = snapshot.copy(config = applyEdit(snapshot.config, edit, resting(s, now(s)))))
    }

    fun signIn(token: String) = update { Saved(token = token, deviceId = it.deviceId, seq = it.seq) }

    fun signOut() {
        val token = _saved.value.token
        update { Saved(deviceId = it.deviceId, seq = it.seq) }
        if (token != null) scope.launch {
            runCatching { call("POST", "/api/auth/logout", JsonObject(emptyMap()), token) }
        }
    }

    /**
     * Stores a snapshot from the server. A pending config PUT stays applied on top until the
     * server has it. Snapshots pushed while an upload is in flight are dropped: they may already
     * contain queued events, which would then count twice, and the upload's response is newer.
     */
    fun receive(snapshot: Snapshot, sent: List<SyncEvent> = emptyList(), putDone: ConfigEdit? = null, pushed: Boolean = false) {
        if (pushed && syncing) return
        update { s ->
            val sentIds = sent.map { it.eventId }.toSet()
            val pendingPut = s.pendingPut.takeIf { it != putDone }
            val next = s.copy(
                offset = snapshot.serverTime - System.currentTimeMillis(),
                queue = s.queue.filter { it.eventId !in sentIds },
                pendingPut = pendingPut,
                snapshot = snapshot,
            )
            if (pendingPut == null) next else withLocalEdit(next, pendingPut)
        }
    }

    /** Sends the pending config PUT, then queued events. Network failures keep both for the next try. */
    fun flush() {
        val s = _saved.value
        if (syncing || s.token == null || (s.pendingPut == null && s.queue.isEmpty())) return
        syncing = true
        scope.launch {
            try {
                while (true) {
                    val s = _saved.value
                    val token = s.token ?: break
                    val put = s.pendingPut
                    val sent = s.queue.take(1000)
                    try {
                        if (put != null) {
                            val body = json.encodeToJsonElement(ConfigEdit.serializer(), put)
                            receive(call("PUT", "/api/sync/config", body, token, Snapshot.serializer()), putDone = put)
                        } else if (sent.isNotEmpty()) {
                            val body = buildJsonObject { put("events", json.encodeToJsonElement(ListSerializer(SyncEvent.serializer()), sent)) }
                            receive(call("POST", "/api/sync/events", body, token, Snapshot.serializer()), sent = sent)
                        } else {
                            break
                        }
                    } catch (e: ApiException) {
                        // Retrying a rejected body would block everything queued behind it.
                        if (e.code != 400) throw e
                        update { if (put != null) it.copy(pendingPut = null) else it.copy(queue = it.queue - sent.toSet()) }
                    }
                }
            } catch (e: IOException) {
                handleFailure(e)
            } finally {
                syncing = false
            }
        }
    }

    suspend fun refresh() {
        val token = _saved.value.token ?: return
        try {
            receive(call("GET", "/api/sync/state", null, token, Snapshot.serializer()), pushed = true)
        } catch (e: IOException) {
            handleFailure(e)
        }
    }

    fun handleFailure(e: IOException) {
        if (e is ApiException && e.code == 401) update { Saved(deviceId = it.deviceId, seq = it.seq) }
    }

    suspend fun call(method: String, path: String, body: JsonElement?, token: String? = null): JsonObject =
        call(method, path, body, token, JsonObject.serializer())

    suspend fun <T> call(method: String, path: String, body: JsonElement?, token: String?, result: KSerializer<T>): T =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(BuildConfig.API_URL + path)
                .method(method, body?.toString()?.toRequestBody("application/json".toMediaType()))
                .apply { if (token != null) header("Authorization", "Bearer $token") }
                .build()
            http.newCall(request).execute().use { response ->
                val text = response.body.string()
                if (!response.isSuccessful) {
                    val error = runCatching { json.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.content }.getOrNull()
                    throw ApiException(response.code, error ?: "HTTP ${response.code}")
                }
                json.decodeFromString(result, text)
            }
        }
}
