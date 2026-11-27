package moe.seria.undoom

import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

private val lightColors = lightColorScheme(
    primary = Color(0xFF2B5A8A),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFE2EBF6),
    onPrimaryContainer = Color(0xFF162033),
    secondaryContainer = Color(0xFFE2EBF6),
    onSecondaryContainer = Color(0xFF162033),
    background = Color(0xFFF2F4F8),
    onBackground = Color(0xFF162033),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF162033),
    surfaceVariant = Color(0xFFE8EDF4),
    onSurfaceVariant = Color(0xFF5E6A80),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFFFFFFF),
    surfaceContainer = Color(0xFFFFFFFF),
    surfaceContainerHigh = Color(0xFFFFFFFF),
    surfaceContainerHighest = Color(0xFFFFFFFF),
    outline = Color(0xFFDFE5EE),
    outlineVariant = Color(0xFFDFE5EE),
    error = Color(0xFFBF4A30),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFBE8E2),
    onErrorContainer = Color(0xFF162033),
)

private val darkColors = darkColorScheme(
    primary = Color(0xFF8DB8E6),
    onPrimary = Color(0xFF0B1627),
    primaryContainer = Color(0xFF1C2B42),
    onPrimaryContainer = Color(0xFFE5EAF3),
    secondaryContainer = Color(0xFF1C2B42),
    onSecondaryContainer = Color(0xFFE5EAF3),
    background = Color(0xFF0E131B),
    onBackground = Color(0xFFE5EAF3),
    surface = Color(0xFF171F2C),
    onSurface = Color(0xFFE5EAF3),
    surfaceVariant = Color(0xFF232D40),
    onSurfaceVariant = Color(0xFF98A3B8),
    surfaceContainerLowest = Color(0xFF171F2C),
    surfaceContainerLow = Color(0xFF171F2C),
    surfaceContainer = Color(0xFF171F2C),
    surfaceContainerHigh = Color(0xFF171F2C),
    surfaceContainerHighest = Color(0xFF171F2C),
    outline = Color(0xFF26304A),
    outlineVariant = Color(0xFF26304A),
    error = Color(0xFFF29A84),
    onError = Color(0xFF0B1627),
    errorContainer = Color(0xFF3A2420),
    onErrorContainer = Color(0xFFE5EAF3),
)

// extraSmall is what text fields use, small the preset chips, medium the cards.
private val shapes = Shapes(
    extraSmall = RoundedCornerShape(12.dp),
    small = RoundedCornerShape(9.dp),
    medium = RoundedCornerShape(16.dp),
)

@Composable
fun UndoomTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColors else lightColors, shapes = shapes) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Box(Modifier.safeDrawingPadding()) { content() }
        }
    }
}

@Composable
fun Logo(size: Dp) {
    Image(painterResource(R.drawable.logo), contentDescription = null, Modifier.size(size))
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

/** A limit such as "45 min", "2 h" or "1 h 30 min". */
fun formatLimit(ms: Long): String {
    val minutes = ms / 60_000
    val h = minutes / 60
    val m = minutes % 60
    return when {
        h == 0L -> "$m min"
        m == 0L -> "$h h"
        else -> "$h h $m min"
    }
}

fun entries(saved: Saved) = Repo.catalog + saved.snapshot?.config?.customEntries.orEmpty()

fun entryName(id: String, saved: Saved) = entries(saved).find { it.id == id }?.name ?: id

fun appNames(entryIds: List<String>, saved: Saved) = entryIds.joinToString { entryName(it, saved) }

fun displayName(target: Target, saved: Saved) = target.name ?: appNames(target.entryIds, saved)
