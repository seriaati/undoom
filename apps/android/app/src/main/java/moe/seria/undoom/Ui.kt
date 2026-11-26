package moe.seria.undoom

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.delay

@Composable
fun UndoomTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val context = LocalContext.current
    val colors = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dark -> darkColorScheme()
        else -> lightColorScheme()
    }
    MaterialTheme(colorScheme = colors) {
        Surface(Modifier.fillMaxSize()) {
            Box(Modifier.safeDrawingPadding()) { content() }
        }
    }
}

/** Server time, updated every second. */
@Composable
fun rememberNow(): Long {
    var now by remember { mutableLongStateOf(Repo.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1_000 - now % 1_000)
            now = Repo.now()
        }
    }
    return now
}

fun formatDuration(ms: Long): String {
    val total = (ms + 999).coerceAtLeast(0) / 1_000
    val h = total / 3600
    val m = total % 3600 / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

fun entries(saved: Saved) = Repo.catalog + saved.snapshot?.config?.customEntries.orEmpty()

fun displayName(target: Target, saved: Saved): String {
    val all = entries(saved)
    return target.name ?: target.entryIds.joinToString { id -> all.find { it.id == id }?.name ?: id }
}
