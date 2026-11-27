package moe.seria.undoom

import android.graphics.BitmapFactory
import androidx.annotation.DrawableRes
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.core.graphics.drawable.toBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.Request

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

/** Loaded icons by package or domain, so scrolling the list doesn't decode or download them again. Only touched on the main thread. */
private val icons = HashMap<String, ImageBitmap>()

/** Domains whose favicon failed to load, so scrolling past them doesn't download it again. Only touched on the main thread. */
private val missingFavicons = HashSet<String>()

/** Fetched from the site itself rather than a favicon service, so the list of limited sites stays private. */
private fun loadFavicon(domain: String): ImageBitmap? = runCatching {
    Repo.http.newCall(Request.Builder().url("https://$domain/favicon.ico").build()).execute().use { response ->
        if (!response.isSuccessful) return null
        BitmapFactory.decodeStream(response.body.byteStream())?.asImageBitmap()
    }
}.getOrNull()

/**
 * The icon of the first installed package, else the first domain's favicon, or null while loading
 * or when there is neither.
 */
@Composable
private fun rememberEntryIcon(entry: Entry): ImageBitmap? {
    val pm = LocalContext.current.packageManager
    return produceState((entry.packages + entry.domains).firstNotNullOfOrNull { icons[it] }, entry) {
        if (value != null) return@produceState
        val domain = entry.domains.firstOrNull()?.takeIf { it !in missingFavicons }
        val loaded = withContext(Dispatchers.IO) {
            entry.packages.firstNotNullOfOrNull { runCatching { it to pm.getApplicationIcon(it).toBitmap().asImageBitmap() }.getOrNull() }
                ?: domain?.let { d -> loadFavicon(d)?.let { d to it } }
        }
        if (loaded == null && domain != null) missingFavicons += domain
        value = loaded?.let { (key, icon) -> icon.also { icons[key] = it } }
    }.value
}

/** An entry's app icon or site favicon, or its first letter when it has neither. */
@Composable
fun EntryIcon(entry: Entry, size: Dp) {
    val icon = rememberEntryIcon(entry)
    Crossfade(icon, Modifier.size(size), label = "icon") {
        // Crossfade puts its content at the top start, so the box has to fill it to centre the letter.
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (it != null) {
                Image(it, contentDescription = null, Modifier.size(size))
            } else {
                // Unbounded so the theme's 24sp line height can't be squeezed into a small icon, which
                // clipped the letter; the box then centres the whole line.
                Text(
                    entry.name.take(1).uppercase(),
                    Modifier.wrapContentSize(unbounded = true),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.Bold,
                    fontSize = (size.value * 0.7f).sp,
                )
            }
        }
    }
}

/** One entry's icon, or up to four in a grid for a group. */
@Composable
fun Tile(entries: List<Entry>, size: Dp = 34.dp) {
    Box(
        Modifier.size(size).border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(size * 0.3f)),
        contentAlignment = Alignment.Center,
    ) {
        if (entries.size <= 1) {
            entries.firstOrNull()?.let { EntryIcon(it, size * 0.65f) }
        } else {
            val small = size * 0.36f
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                for (row in entries.take(4).chunked(2)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) { row.forEach { EntryIcon(it, small) } }
                }
            }
        }
    }
}

@Composable
fun Brand() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Logo(24.dp)
        Text("Undoom", fontSize = 16.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.01).em)
    }
}

@Composable
fun IconLabel(@DrawableRes icon: Int, text: String) {
    Icon(painterResource(icon), contentDescription = null, Modifier.size(ButtonDefaults.IconSize))
    Spacer(Modifier.width(ButtonDefaults.IconSpacing))
    Text(text)
}

@Composable
fun Countdown(ms: Long, label: String, color: Color, fontSize: TextUnit = 28.sp) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            formatDuration(ms),
            Modifier.alignByBaseline(),
            color = color,
            fontSize = fontSize,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = (-0.02).em,
            style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = "tnum"),
        )
        Muted(label, Modifier.alignByBaseline())
    }
}

@Composable
fun Bar(fraction: Float, color: Color) {
    // Matches the one-second tick so the bar glides instead of stepping.
    val animated by animateFloatAsState(fraction.coerceIn(0f, 1f), tween(1_000, easing = LinearEasing), label = "bar")
    Box(Modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)) {
        Box(Modifier.fillMaxWidth(animated).fillMaxHeight().clip(CircleShape).background(color))
    }
}

@Composable
fun Muted(text: String, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) {
    Text(
        text,
        modifier,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodySmall,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
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

/** The target's entries in order; ids missing from the catalog get a bare entry named after the id. */
fun targetEntries(target: Target, saved: Saved) = entries(saved).let { all ->
    target.entryIds.map { id -> all.find { it.id == id } ?: Entry(id, id, emptyList(), emptyList()) }
}
