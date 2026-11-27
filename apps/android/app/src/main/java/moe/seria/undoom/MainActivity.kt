package moe.seria.undoom

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.annotation.DrawableRes
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialCancellationException
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val MINUTE = 60_000L

private sealed interface Screen {
    data object Targets : Screen
    data object Account : Screen
    data class Edit(val targetId: String?) : Screen
}

class MainActivity : ComponentActivity() {
    private var resumes by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Repo.init(this)
        enableEdgeToEdge()
        setContent { UndoomTheme { App(this, resumes) } }
    }

    override fun onResume() {
        super.onResume()
        resumes++
    }
}

@Composable
private fun App(activity: MainActivity, resumes: Int) {
    val saved by Repo.saved.collectAsState()
    val token = saved.token ?: return SignInScreen(activity)
    var screen by remember { mutableStateOf<Screen>(Screen.Targets) }
    LaunchedEffect(resumes, token) { Repo.refresh() }
    BackHandler(screen != Screen.Targets) { screen = Screen.Targets }
    AnimatedContent(screen, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(150)) }, label = "screen") { s ->
        when (s) {
            Screen.Targets -> TargetsScreen(activity, resumes, saved, open = { screen = it })
            Screen.Account -> AccountScreen(activity, token, back = { screen = Screen.Targets })
            is Screen.Edit -> EditScreen(activity, saved, s.targetId, done = { screen = Screen.Targets })
        }
    }
}

/** Runs [block], showing failures in [error]. Cancelling a passkey prompt isn't an error worth showing. */
private suspend fun attempt(error: (String?) -> Unit, block: suspend () -> Unit) {
    error(null)
    try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        if (e !is GetCredentialCancellationException && e !is CreateCredentialCancellationException) {
            error(e.message ?: e.javaClass.simpleName)
        }
    }
}

@Composable
private fun SignInScreen(activity: MainActivity) {
    val scope = rememberCoroutineScope()
    var creating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var pasted by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Spacer(Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Logo(40.dp)
            Text("Undoom", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
        }
        Spacer(Modifier.height(24.dp))
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            listOf("Sign in", "Create account").forEachIndexed { index, label ->
                SegmentedButton(
                    selected = creating == (index == 1),
                    onClick = {
                        creating = index == 1
                        error = null
                    },
                    shape = SegmentedButtonDefaults.itemShape(index, 2),
                ) { Text(label) }
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(
            if (creating) "Your account is tied to a passkey. There's no password to remember." else "Use the passkey saved on this device or in your password manager.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = { scope.launch { attempt({ error = it }) { Repo.signIn(if (creating) registerWithPasskey(activity) else signInWithPasskey(activity)) } } },
            Modifier.fillMaxWidth(),
        ) { IconLabel(R.drawable.ic_key, if (creating) "Create account" else "Sign in with a passkey") }
        error?.let {
            Spacer(Modifier.height(16.dp))
            Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.weight(1f))
        // Passkeys can't work against a local server: the RP ID has to match the assetlinks domain.
        if (BuildConfig.DEBUG) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    pasted, { pasted = it.trim() }, Modifier.weight(1f),
                    placeholder = { Text("Debug token", style = MaterialTheme.typography.bodySmall) }, singleLine = true, textStyle = MaterialTheme.typography.bodySmall,
                )
                TextButton(onClick = { Repo.signIn(pasted) }, enabled = pasted.isNotEmpty()) { Text("Use") }
            }
        }
    }
}

private fun serviceEnabled(context: Context): Boolean {
    val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
    val me = ComponentName(context, UndoomService::class.java)
    return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
}

@Composable
private fun TargetsScreen(activity: MainActivity, resumes: Int, saved: Saved, open: (Screen) -> Unit) {
    val now = rememberNow()
    val enabled = remember(resumes) { serviceEnabled(activity) }
    val targets = Repo.effective(saved, now).targets
    Scaffold(
        topBar = {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Undoom", Modifier.weight(1f), fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.02).em)
                OutlinedIconButton(
                    onClick = { open(Screen.Account) },
                    colors = IconButtonDefaults.outlinedIconButtonColors(
                        containerColor = MaterialTheme.colorScheme.surface,
                        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                ) {
                    Icon(painterResource(R.drawable.ic_person), contentDescription = "Account")
                }
            }
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                text = { Text("Add limit") },
                icon = { Icon(painterResource(R.drawable.ic_add), contentDescription = null) },
                onClick = { open(Screen.Edit(null)) },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            )
        },
    ) { padding ->
        LazyColumn(
            Modifier.padding(padding).fillMaxSize(),
            // The bottom padding keeps the last card scrollable out from under the FAB.
            contentPadding = PaddingValues(start = 16.dp, top = 4.dp, end = 16.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (!enabled) item(key = "onboarding") { Box(Modifier.animateItem()) { Onboarding(activity) } }
            if (targets.isEmpty()) item(key = "empty") { Box(Modifier.animateItem()) { EmptyState() } }
            items(targets, key = { it.id }) { target ->
                LimitCard(target, saved, now, onClick = { open(Screen.Edit(target.id)) }, Modifier.animateItem())
            }
        }
    }
}

@Composable
private fun EmptyState() {
    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("No limits yet", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(
            "Add an app to give it short sessions with a rest in between.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

private enum class Phase(val label: String, @DrawableRes val icon: Int) {
    Resting("Resting", R.drawable.ic_moon),
    Session("In session", R.drawable.ic_play),
    Ready("Ready", R.drawable.ic_check),
}

@Composable
private fun LimitCard(target: Target, saved: Saved, now: Long, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.colorScheme
    val name = displayName(target, saved)
    val members = targetEntries(target, saved)
    val status = status(Repo.localState(target, saved), target.limits, now)
    val restUntil = status.restUntil
    val ready = restUntil == null && status.remainingMs >= target.sessionMs
    val phase = when {
        restUntil != null -> Phase.Resting
        ready -> Phase.Ready
        else -> Phase.Session
    }
    OutlinedCard(onClick, modifier.fillMaxWidth(), enabled = target.pending != PendingChange.Delete) {
        Column(Modifier.animateContentSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Tile(members)
                Column(Modifier.weight(1f)) {
                    Text(name, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    target.name?.let { Muted(appNames(target.entryIds, saved), maxLines = 1) }
                }
                Pill(phase)
            }
            Identifiers(members)
            if (restUntil != null) {
                Countdown(restUntil - now, "until the next session", colors.error)
                Bar(1f - (restUntil - now).toFloat() / target.restMs, colors.error)
            } else if (!ready) {
                Countdown(status.remainingMs, "left of ${formatLimit(target.sessionMs)}", colors.onSurface)
                Bar(status.remainingMs.toFloat() / target.sessionMs, colors.primary)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                IconText(R.drawable.ic_hourglass, formatLimit(target.sessionMs), "Session")
                IconText(R.drawable.ic_moon, formatLimit(target.restMs), "Rest")
            }
            when (target.pending) {
                PendingChange.Delete -> Muted("Will be removed after the current rest")
                is PendingChange.Update -> Muted("Changes apply after the current rest")
                null -> {}
            }
        }
    }
}

/** The domains and Android packages the entries cover, one line each. */
@Composable
private fun Identifiers(entries: List<Entry>) {
    val domains = entries.flatMap { it.domains }
    val packages = entries.flatMap { it.packages }
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (domains.isNotEmpty()) IconText(R.drawable.ic_globe, domains.joinToString(), "Websites")
        if (packages.isNotEmpty()) IconText(R.drawable.ic_smartphone, packages.joinToString(), "Android apps", FontFamily.Monospace)
    }
}

@Composable
private fun IconText(@DrawableRes icon: Int, text: String, description: String, fontFamily: FontFamily? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(painterResource(icon), contentDescription = description, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            text,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
            fontFamily = fontFamily,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun IconLabel(@DrawableRes icon: Int, text: String) {
    Icon(painterResource(icon), contentDescription = null, Modifier.size(ButtonDefaults.IconSize))
    Spacer(Modifier.width(ButtonDefaults.IconSpacing))
    Text(text)
}

@Composable
private fun Pill(phase: Phase) {
    val colors = MaterialTheme.colorScheme
    val (background, content) = when (phase) {
        Phase.Resting -> colors.errorContainer to colors.error
        Phase.Session -> colors.primaryContainer to colors.primary
        Phase.Ready -> colors.background to colors.onSurfaceVariant
    }
    val animatedBackground by animateColorAsState(background, label = "pill background")
    val animatedContent by animateColorAsState(content, label = "pill content")
    AnimatedContent(phase, Modifier.background(animatedBackground, CircleShape), label = "pill") { shown ->
        Row(
            Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(painterResource(shown.icon), contentDescription = null, Modifier.size(12.dp), tint = animatedContent)
            Text(shown.label, color = animatedContent, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun Countdown(ms: Long, label: String, color: Color) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            formatDuration(ms),
            Modifier.alignByBaseline(),
            color = color,
            fontSize = 28.sp,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = (-0.02).em,
            style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = "tnum"),
        )
        Muted(label, Modifier.alignByBaseline())
    }
}

@Composable
private fun Bar(fraction: Float, color: Color) {
    // Matches the one-second tick so the bar glides instead of stepping.
    val animated by animateFloatAsState(fraction.coerceIn(0f, 1f), tween(1_000, easing = LinearEasing), label = "bar")
    Box(Modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant)) {
        Box(Modifier.fillMaxWidth(animated).fillMaxHeight().clip(CircleShape).background(color))
    }
}

@Composable
private fun Muted(text: String, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) {
    Text(
        text,
        modifier,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodySmall,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun Onboarding(activity: MainActivity) {
    val colors = MaterialTheme.colorScheme
    val stepColors = ButtonDefaults.buttonColors(containerColor = colors.onPrimary, contentColor = colors.primary)
    val restricted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
    Card(colors = CardDefaults.cardColors(containerColor = colors.primary, contentColor = colors.onPrimary)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Turn on blocking", fontWeight = FontWeight.Bold)
            Text(
                if (restricted) {
                    "Undoom needs accessibility access to close resting apps. First, in App info, tap ⋮ and " +
                        "allow restricted settings. Then turn Undoom on under Installed apps."
                } else {
                    "Undoom needs accessibility access to close resting apps. Turn it on under Installed apps."
                },
                style = MaterialTheme.typography.bodySmall,
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (restricted) {
                    Button(
                        onClick = {
                            activity.startActivity(
                                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.packageName, null)),
                            )
                        },
                        colors = stepColors,
                    ) { Text("1. Open App info") }
                }
                Button(onClick = { activity.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }, colors = stepColors) {
                    Text(if (restricted) "2. Open accessibility settings" else "Open accessibility settings")
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AccountScreen(activity: MainActivity, token: String, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf<String?>(null) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Account") },
                navigationIcon = {
                    IconButton(onClick = back) { Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = "Back") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Signed in with a passkey", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        "Add a passkey on another device or password manager so you can still sign in if you lose this one.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = {
                            scope.launch {
                                attempt({ message = it }) {
                                    addPasskey(activity, token)
                                    message = "Passkey added"
                                }
                            }
                        }) { IconLabel(R.drawable.ic_key, "Add a passkey") }
                        TextButton(onClick = { Repo.signOut() }) { IconLabel(R.drawable.ic_logout, "Sign out") }
                    }
                }
            }
            AnimatedVisibility(message != null) { Text(message.orEmpty(), Modifier.padding(horizontal = 16.dp)) }
        }
    }
}

private data class Candidate(val entry: Entry, val installed: Boolean)

/** Catalog apps and existing custom entries, plus a new custom entry for every other launcher app. */
private fun candidates(context: Context, known: List<Entry>): List<Candidate> {
    val pm = context.packageManager
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val installed = pm.queryIntentActivities(launcher, 0)
        .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
        .filter { it.first != context.packageName }
        .distinctBy { it.first }
    val installedPackages = installed.map { it.first }.toSet()
    val apps = known.filter { it.packages.isNotEmpty() }
    val custom = installed
        .filter { (pkg, _) -> apps.none { pkg in it.packages } }
        .map { (pkg, label) -> Entry("custom:$pkg", label.take(100), emptyList(), listOf(pkg)) }
    return (apps + custom)
        .map { Candidate(it, it.packages.any { p -> p in installedPackages }) }
        .sortedWith(compareBy({ !it.installed }, { it.entry.name.lowercase() }))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditScreen(activity: MainActivity, saved: Saved, targetId: String?, done: () -> Unit) {
    val config = saved.snapshot?.config ?: emptyConfig
    val desired = remember(config) { desiredEdit(config) }
    val existing = desired.targets.find { it.id == targetId }
    val existingName = existing?.let { it.name ?: appNames(it.entryIds, saved) }
    val known = entries(saved)
    val all by produceState(emptyList<Candidate>(), known) {
        value = withContext(Dispatchers.IO) { candidates(activity, known) }
    }
    val taken = (desired.targets + config.targets.map { TargetEdit(it.id, it.name, it.entryIds, it.sessionMs, it.restMs) })
        .filter { it.id != targetId }
        .flatMap { it.entryIds }
        .toSet()

    var name by remember { mutableStateOf(existing?.name.orEmpty()) }
    val selected = remember { mutableStateListOf(*existing?.entryIds.orEmpty().toTypedArray()) }
    var session by remember { mutableStateOf(((existing?.sessionMs ?: (15 * MINUTE)) / MINUTE).toString()) }
    var rest by remember { mutableStateOf(((existing?.restMs ?: (60 * MINUTE)) / MINUTE).toString()) }
    var query by remember { mutableStateOf("") }

    val sessionMin = session.toLongOrNull()?.takeIf { it in 1..24 * 60 }
    val restMin = rest.toLongOrNull()?.takeIf { it in 1..7 * 24 * 60 }
    val trimmedName = name.trim().take(100).ifEmpty { null }
    val error = when {
        selected.isEmpty() -> "Pick at least one app"
        selected.size > 1 && trimmedName == null -> "A group of apps needs a name"
        sessionMin == null -> "Sessions can be 1 to 1440 minutes"
        restMin == null -> "Rests can be 1 to 10080 minutes"
        else -> null
    }
    val resting = targetId != null && config.targets.find { it.id == targetId }
        ?.let { status(Repo.localState(it, saved), it.limits, Repo.now(saved)).blocked } == true

    fun save(targets: List<TargetEdit>) {
        val newCustom = all.map { it.entry }
            .filter { it.id in selected && it.id.startsWith("custom:") && desired.customEntries.none { e -> e.id == it.id } }
        Repo.edit(ConfigEdit(targets, desired.customEntries + newCustom))
        done()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(existingName?.let { "Edit $it" } ?: "Add limit", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = done) { Icon(painterResource(R.drawable.ic_close), contentDescription = "Close") }
                },
                actions = {
                    if (existing != null) {
                        IconButton(
                            onClick = { save(desired.targets.filter { it.id != targetId }) },
                            colors = IconButtonDefaults.iconButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        ) { Icon(painterResource(R.drawable.ic_delete), contentDescription = "Delete") }
                    }
                    Button(
                        enabled = error == null,
                        onClick = {
                            val edit = TargetEdit(targetId ?: UUID.randomUUID().toString(), trimmedName, selected.toList(), sessionMin!! * MINUTE, restMin!! * MINUTE)
                            save(if (existing == null) desired.targets + edit else desired.targets.map { if (it.id == edit.id) edit else it })
                        },
                        modifier = Modifier.padding(end = 8.dp),
                    ) { IconLabel(R.drawable.ic_check, "Save") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
    ) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp)) {
            item {
                Column(Modifier.padding(top = 8.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    if (resting) {
                        Text(
                            "$existingName is resting. Stricter limits apply right away. Looser ones start when this rest ends.",
                            Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.errorContainer, RoundedCornerShape(12.dp)).padding(12.dp),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                    AnimatedVisibility(selected.isNotEmpty()) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            FieldLabel("Selected")
                            FlowRow(Modifier.animateContentSize(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                for (id in selected) {
                                    val entry = all.find { it.entry.id == id }?.entry
                                        ?: known.find { it.id == id }
                                        ?: Entry(id, id, emptyList(), emptyList())
                                    InputChip(
                                        selected = false,
                                        onClick = { selected.remove(id) },
                                        label = { Text(entry.name) },
                                        avatar = { EntryIcon(entry, InputChipDefaults.AvatarSize) },
                                        trailingIcon = { Icon(painterResource(R.drawable.ic_close), contentDescription = "Remove", Modifier.size(16.dp)) },
                                        shape = CircleShape,
                                    )
                                }
                            }
                        }
                    }
                    // Also shown for an existing single-app limit that has a name, so the name can still be changed.
                    AnimatedVisibility(selected.size > 1 || existing?.name != null) {
                        OutlinedTextField(
                            name, { name = it }, Modifier.fillMaxWidth(),
                            label = { Text("Name") },
                            placeholder = { Text("e.g. Short videos") },
                            supportingText = { Text("These apps share one session and one rest.") },
                            singleLine = true,
                        )
                    }
                    DurationPicker("Session", listOf(5L, 10L, 15L, 30L, 60L), session) { session = it }
                    DurationPicker("Rest", listOf(30L, 60L, 120L, 240L), rest) { rest = it }
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        FieldLabel("Apps")
                        OutlinedTextField(
                            query, { query = it }, Modifier.fillMaxWidth(),
                            placeholder = { Text("Search apps") },
                            leadingIcon = { Icon(painterResource(R.drawable.ic_search), contentDescription = null) },
                            singleLine = true,
                        )
                    }
                }
            }
            val shown = all.filter { it.entry.id !in taken && (query.isBlank() || it.entry.name.contains(query, ignoreCase = true)) }
                .sortedBy { it.entry.id !in selected }
            items(shown, key = { it.entry.id }) { (entry, installed) ->
                Row(
                    Modifier.animateItem().fillMaxWidth().clickable { if (!selected.remove(entry.id)) selected += entry.id },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(entry.id in selected, onCheckedChange = null, Modifier.padding(12.dp))
                    EntryIcon(entry, 32.dp)
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(entry.name)
                        Muted((if (installed) "" else "Not installed · ") + entry.packages.joinToString())
                    }
                }
            }
        }
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelLarge)
}

/** [minutes] is the raw field text, so it can be empty or out of range while the user types. */
@Composable
private fun DurationPicker(label: String, presets: List<Long>, minutes: String, onChange: (String) -> Unit) {
    var custom by remember { mutableStateOf(minutes.toLongOrNull() !in presets) }
    val chipColors = FilterChipDefaults.filterChipColors(
        selectedContainerColor = MaterialTheme.colorScheme.primary,
        selectedLabelColor = MaterialTheme.colorScheme.onPrimary,
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FieldLabel(label)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (preset in presets) {
                FilterChip(
                    selected = !custom && minutes == preset.toString(),
                    onClick = {
                        custom = false
                        onChange(preset.toString())
                    },
                    label = { Text(formatLimit(preset * MINUTE)) },
                    colors = chipColors,
                )
            }
            FilterChip(selected = custom, onClick = { custom = true }, label = { Text("Custom") }, colors = chipColors)
        }
        AnimatedVisibility(custom) {
            OutlinedTextField(
                minutes, { onChange(it.filter(Char::isDigit)) }, Modifier.width(160.dp),
                suffix = { Text("min") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
        }
    }
}
