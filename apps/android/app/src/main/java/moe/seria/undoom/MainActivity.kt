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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
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
    when (val s = screen) {
        Screen.Targets -> TargetsScreen(activity, resumes, saved, open = { screen = it })
        Screen.Account -> AccountScreen(activity, token, back = { screen = Screen.Targets })
        is Screen.Edit -> EditScreen(activity, saved, s.targetId, done = { screen = Screen.Targets })
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
    var error by remember { mutableStateOf<String?>(null) }
    var pasted by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Undoom", style = MaterialTheme.typography.displayMedium)
        Text("Keep scrolling. Just not forever.", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(48.dp))
        Button(onClick = { scope.launch { attempt({ error = it }) { Repo.signIn(signInWithPasskey(activity)) } } }) {
            Text("Sign in with a passkey")
        }
        OutlinedButton(onClick = { scope.launch { attempt({ error = it }) { Repo.signIn(registerWithPasskey(activity)) } } }) {
            Text("Create an account")
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        // Passkeys can't work against a local server: the RP ID has to match the assetlinks domain.
        if (BuildConfig.DEBUG) {
            Spacer(Modifier.height(32.dp))
            OutlinedTextField(pasted, { pasted = it.trim() }, label = { Text("Debug: paste a token") }, singleLine = true)
            TextButton(onClick = { Repo.signIn(pasted) }, enabled = pasted.isNotEmpty()) { Text("Use token") }
        }
    }
}

private fun serviceEnabled(context: Context): Boolean {
    val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
    val me = ComponentName(context, UndoomService::class.java)
    return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TargetsScreen(activity: MainActivity, resumes: Int, saved: Saved, open: (Screen) -> Unit) {
    val now = rememberNow()
    val enabled = remember(resumes) { serviceEnabled(activity) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Undoom") },
                actions = { TextButton(onClick = { open(Screen.Account) }) { Text("Account") } },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { open(Screen.Edit(null)) }) { Text("+", style = MaterialTheme.typography.headlineSmall) }
        },
    ) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize()) {
            if (!enabled) item { Onboarding(activity) }
            val targets = Repo.effective(saved, now).targets
            if (targets.isEmpty()) {
                item { Text("Nothing tracked yet. Tap + to add an app.", Modifier.padding(16.dp)) }
            }
            items(targets, key = { it.id }) { target ->
                val status = status(Repo.localState(target, saved), target.limits, now)
                Column(
                    Modifier.fillMaxWidth()
                        .clickable(enabled = target.pending != PendingChange.Delete) { open(Screen.Edit(target.id)) }
                        .padding(16.dp),
                ) {
                    Text(displayName(target, saved), style = MaterialTheme.typography.titleMedium)
                    val limits = "${target.sessionMs / MINUTE} min sessions, ${target.restMs / MINUTE} min rest"
                    val state = if (status.restUntil != null) {
                        "Resting, ${formatDuration(status.restUntil - now)} left"
                    } else {
                        "${formatDuration(status.remainingMs)} left in this session"
                    }
                    Text(state, color = if (status.blocked) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
                    Text(limits, style = MaterialTheme.typography.bodySmall)
                    when (target.pending) {
                        PendingChange.Delete -> Text("Will be removed after the current rest", style = MaterialTheme.typography.bodySmall)
                        is PendingChange.Update -> Text("Changes apply after the current rest", style = MaterialTheme.typography.bodySmall)
                        null -> {}
                    }
                }
                HorizontalDivider()
            }
        }
    }
}

@Composable
private fun Onboarding(activity: MainActivity) {
    Card(Modifier.padding(16.dp)) {
        Column(Modifier.padding(16.dp)) {
            Text("Turn on Undoom", style = MaterialTheme.typography.titleMedium)
            Text("Undoom uses an accessibility service to see which app is open and to close apps that are resting.")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "Android blocks this for apps installed from an APK until you allow it. " +
                        "Open App info, tap ⋮ in the top corner, then \"Allow restricted settings\".",
                )
                TextButton(onClick = {
                    activity.startActivity(
                        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.packageName, null)),
                    )
                }) { Text("1. Open App info") }
            }
            Text("Then turn on Undoom under Accessibility → Installed apps.")
            TextButton(onClick = { activity.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }) {
                Text(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) "2. Open accessibility settings" else "Open accessibility settings")
            }
        }
    }
}

@Composable
private fun AccountScreen(activity: MainActivity, token: String, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Account", style = MaterialTheme.typography.headlineMedium)
        Text("Add a passkey on another device or password manager so you can still sign in if you lose this one.")
        Button(onClick = {
            scope.launch {
                attempt({ message = it }) {
                    addPasskey(activity, token)
                    message = "Passkey added"
                }
            }
        }) { Text("Add a passkey") }
        OutlinedButton(onClick = { Repo.signOut() }) { Text("Sign out") }
        message?.let { Text(it) }
        TextButton(onClick = back) { Text("Back") }
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

@Composable
private fun EditScreen(activity: MainActivity, saved: Saved, targetId: String?, done: () -> Unit) {
    val config = saved.snapshot?.config ?: emptyConfig
    val desired = remember(config) { desiredEdit(config) }
    val existing = desired.targets.find { it.id == targetId }
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
    var session by remember { mutableStateOf(((existing?.sessionMs ?: (10 * MINUTE)) / MINUTE).toString()) }
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

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        item {
            Spacer(Modifier.height(24.dp))
            Text(if (existing == null) "Add" else "Edit", style = MaterialTheme.typography.headlineMedium)
            if (resting) Text("This is resting. Looser limits apply after the current rest.", color = MaterialTheme.colorScheme.error)
            OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("Group name (needed for more than one app)") }, singleLine = true)
            Row {
                OutlinedTextField(
                    session, { session = it.filter(Char::isDigit) }, Modifier.weight(1f),
                    label = { Text("Session (min)") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                Spacer(Modifier.width(8.dp))
                OutlinedTextField(
                    rest, { rest = it.filter(Char::isDigit) }, Modifier.weight(1f),
                    label = { Text("Rest (min)") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Row {
                Button(enabled = error == null, onClick = {
                    val edit = TargetEdit(targetId ?: UUID.randomUUID().toString(), trimmedName, selected.toList(), sessionMin!! * MINUTE, restMin!! * MINUTE)
                    save(if (existing == null) desired.targets + edit else desired.targets.map { if (it.id == edit.id) edit else it })
                }) { Text("Save") }
                if (existing != null) {
                    TextButton(onClick = { save(desired.targets.filter { it.id != targetId }) }) { Text("Delete") }
                }
                TextButton(onClick = done) { Text("Cancel") }
            }
            OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Search apps") }, singleLine = true)
        }
        val shown = all.filter { it.entry.id !in taken && (query.isBlank() || it.entry.name.contains(query, ignoreCase = true)) }
            .sortedBy { it.entry.id !in selected }
        items(shown, key = { it.entry.id }) { (entry, installed) ->
            Row(
                Modifier.fillMaxWidth().clickable { if (!selected.remove(entry.id)) selected += entry.id },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(entry.id in selected, onCheckedChange = null, Modifier.padding(12.dp))
                Column {
                    Text(entry.name)
                    Text(
                        (if (installed) "" else "Not installed · ") + entry.packages.joinToString(),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}
