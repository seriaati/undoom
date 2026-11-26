package moe.seria.undoom

import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.view.accessibility.AccessibilityEvent
import android.view.inputmethod.InputMethodManager
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

private const val SEGMENT_MS = 10_000L
private const val PING_MS = 30_000L

class UndoomService : AccessibilityService() {
    private class Segment(val pkg: String, val targetIds: List<String>, val startAt: Long)

    private val handler = Handler(Looper.getMainLooper())
    private var foreground: String? = null
    private var segment: Segment? = null
    private var lastFlushAt = 0L

    private var socket: WebSocket? = null
    private var socketToken: String? = null
    private var lastMessageAt = 0L
    private var lastPingAt = 0L
    private var reconnectDelayMs = 1_000L
    private var reconnectAt = 0L

    private val tick = object : Runnable {
        override fun run() {
            update()
            maintainSync()
            handler.postDelayed(this, 1_000)
        }
    }

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_SCREEN_OFF) closeSegment(Repo.now())
            update()
        }
    }

    override fun onServiceConnected() {
        Repo.init(this)
        registerReceiver(screenReceiver, IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_USER_PRESENT)
        })
        handler.post(tick)
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        unregisterReceiver(screenReceiver)
        closeSegment(Repo.now())
        Repo.flush()
        socket?.cancel()
        super.onDestroy()
    }

    override fun onInterrupt() {}

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        // These windows show on top of the app the user is using, so they don't end its segment.
        if (pkg == "com.android.systemui" || pkg in imePackages()) return
        foreground = pkg
        update()
    }

    private fun imePackages() =
        getSystemService(InputMethodManager::class.java).enabledInputMethodList.map { it.packageName }

    private fun screenActive() =
        getSystemService(PowerManager::class.java).isInteractive &&
            !getSystemService(KeyguardManager::class.java).isKeyguardLocked

    /** Extends, closes, or opens the foreground segment, and blocks when a target is resting or out of time. */
    private fun update() {
        val saved = Repo.saved.value
        val now = Repo.now(saved)
        val pkg = foreground.takeIf { saved.token != null && screenActive() }
        val targets = pkg?.let { targetsForPackage(Repo.effective(saved, now), Repo.catalog, it) }.orEmpty()
        val ids = targets.map { it.id }

        segment?.let {
            if (it.pkg != pkg || it.targetIds != ids || now - it.startAt >= SEGMENT_MS) closeSegment(now)
        }
        if (pkg == null || targets.isEmpty()) return

        val blocked = targets.firstOrNull { status(stateWithSegment(it, now), it.limits, now).blocked }
        if (blocked == null) {
            if (segment == null) segment = Segment(pkg, ids, now)
            return
        }
        closeSegment(now)
        foreground = null
        performGlobalAction(GLOBAL_ACTION_HOME)
        val block = Intent(this, BlockActivity::class.java)
            .putExtra(BlockActivity.EXTRA_TARGET, blocked.id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        // The home action is asynchronous; started right away, the block screen ends up behind the launcher.
        handler.postDelayed({ startActivity(block) }, 500)
    }

    private fun stateWithSegment(target: Target, now: Long): TargetState {
        val state = Repo.localState(target)
        val seg = segment ?: return state
        if (target.id !in seg.targetIds || now <= seg.startAt) return state
        return applyUsage(state, target.limits, seg.startAt, now - seg.startAt)
    }

    private fun closeSegment(now: Long) {
        val seg = segment ?: return
        segment = null
        val durationMs = now - seg.startAt
        if (durationMs <= 0) return
        Repo.record { device, next -> seg.targetIds.map { Usage("$device:${next()}", it, seg.startAt, durationMs) } }
    }

    private fun maintainSync() {
        val token = Repo.saved.value.token
        val now = System.currentTimeMillis()
        if (now - lastFlushAt >= SEGMENT_MS) {
            lastFlushAt = now
            Repo.flush()
        }
        if (token != socketToken) {
            socket?.cancel()
            socket = null
            socketToken = token
            reconnectDelayMs = 1_000
            reconnectAt = 0
        }
        if (token == null) return
        val ws = socket
        if (ws == null) {
            if (now >= reconnectAt) connect(token)
        } else if (now - lastMessageAt > 2 * PING_MS) {
            ws.cancel()
            dropSocket(ws)
        } else if (now - lastPingAt >= PING_MS) {
            lastPingAt = now
            ws.send("ping")
        }
    }

    private fun connect(token: String) {
        lastMessageAt = System.currentTimeMillis()
        lastPingAt = lastMessageAt
        val request = Request.Builder()
            .url(BuildConfig.API_URL.replaceFirst("http", "ws") + "/api/sync/ws")
            .header("Authorization", "Bearer $token")
            .build()
        socket = Repo.http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                handler.post { reconnectDelayMs = 1_000 }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handler.post {
                    if (webSocket != socket) return@post
                    lastMessageAt = System.currentTimeMillis()
                    if (text != "pong") Repo.receive(json.decodeFromString<Snapshot>(text), pushed = true)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                handler.post { dropSocket(webSocket) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                handler.post {
                    if (response?.code == 401) Repo.handleFailure(ApiException(401, "unauthorized"))
                    dropSocket(webSocket)
                }
            }
        })
    }

    private fun dropSocket(ws: WebSocket) {
        if (ws != socket) return
        socket = null
        reconnectAt = System.currentTimeMillis() + reconnectDelayMs
        reconnectDelayMs = (reconnectDelayMs * 2).coerceAtMost(60_000)
    }
}
