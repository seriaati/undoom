package moe.seria.undoom

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.IntentCompat
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.Request

/** Self-update for sideloaded installs, from the rolling "latest" GitHub release that CI publishes. */
object Updater {
    private const val RELEASE = "https://github.com/seriaati/undoom/releases/download/latest"

    @Serializable
    private data class Latest(val versionCode: Int)

    private val _available = MutableStateFlow(false)
    val available: StateFlow<Boolean> = _available

    suspend fun check() {
        // Debug builds are signed with the debug key, so a release APK can't install over them.
        if (BuildConfig.DEBUG) return
        _available.value = try {
            withContext(Dispatchers.IO) {
                Repo.http.newCall(Request.Builder().url("$RELEASE/undoom-android.json").build()).execute().use {
                    if (!it.isSuccessful) throw IOException("HTTP ${it.code}")
                    json.decodeFromString<Latest>(it.body.string()).versionCode > BuildConfig.VERSION_CODE
                }
            }
        } catch (_: IOException) {
            return
        }
    }

    /** Downloads the APK into an install session. The result arrives in [InstallReceiver]. */
    suspend fun install(context: Context) = withContext(Dispatchers.IO) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            .apply { setAppPackageName(context.packageName) }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            try {
                Repo.http.newCall(Request.Builder().url("$RELEASE/undoom.apk").build()).execute().use { response ->
                    if (!response.isSuccessful) throw IOException("Download failed: HTTP ${response.code}")
                    session.openWrite("undoom.apk", 0, response.body.contentLength()).use { out ->
                        response.body.byteStream().copyTo(out)
                        session.fsync(out)
                    }
                }
                // Mutable so the installer can add its status extras.
                val status = PendingIntent.getBroadcast(
                    context, id, Intent(context, InstallReceiver::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                )
                session.commit(status.intentSender)
            } catch (e: Exception) {
                session.abandon()
                throw e
            }
        }
    }
}

class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            // Sideloaded apps can't update silently; the system shows its own confirmation.
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java) ?: return
                context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS, PackageInstaller.STATUS_FAILURE_ABORTED -> {}
            else -> Toast.makeText(
                context,
                intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Update failed",
                Toast.LENGTH_LONG,
            ).show()
        }
    }
}

@Composable
fun UpdateCard() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var downloading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Update available", fontWeight = FontWeight.Bold)
            Text(
                "A new version of Undoom is ready to install.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            Button(
                onClick = {
                    scope.launch {
                        downloading = true
                        error = null
                        try {
                            Updater.install(context)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            error = e.message ?: e.javaClass.simpleName
                        } finally {
                            downloading = false
                        }
                    }
                },
                enabled = !downloading,
            ) { Text(if (downloading) "Downloading…" else "Update") }
        }
    }
}
