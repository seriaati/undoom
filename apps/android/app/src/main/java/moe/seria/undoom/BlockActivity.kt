package moe.seria.undoom

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlin.random.Random

class BlockActivity : ComponentActivity() {
    companion object {
        const val EXTRA_TARGET = "target"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Repo.init(this)
        enableEdgeToEdge()
        // Back must not reveal whatever is underneath; leave to the home screen instead.
        onBackPressedDispatcher.addCallback(this) {
            startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish()
        }
        setContent { UndoomTheme { BlockScreen(intent.getStringExtra(EXTRA_TARGET).orEmpty(), ::finish) } }
    }
}

private fun question() = Random.nextInt(3, 13) to Random.nextInt(3, 13)

@Composable
private fun BlockScreen(targetId: String, close: () -> Unit) {
    val saved by Repo.saved.collectAsState()
    val now = rememberNow()
    val target = Repo.effective(saved, now).targets.find { it.id == targetId }
    val status = target?.let { status(Repo.localState(it, saved), it.limits, now) }

    LaunchedEffect(status?.blocked) {
        if (status?.blocked != true) close()
    }
    if (target == null || status?.restUntil == null) return

    var showUnlock by remember { mutableStateOf(false) }
    var q by remember { mutableStateOf(question()) }
    var answer by remember { mutableStateOf("") }
    var wrong by remember { mutableStateOf(false) }

    fun submit() {
        if (answer.toIntOrNull() == q.first * q.second) {
            Repo.unlock(target.id)
        } else {
            wrong = true
            q = question()
            answer = ""
        }
    }

    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(displayName(target, saved), style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text("Time for a break", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(24.dp))
        Text(formatDuration(status.restUntil - now), style = MaterialTheme.typography.displayLarge)
        Text("until your next session")
        Spacer(Modifier.height(48.dp))
        if (!showUnlock) {
            TextButton(onClick = { showUnlock = true }) { Text("Emergency unlock") }
        } else {
            Text("What is ${q.first} × ${q.second}?", style = MaterialTheme.typography.titleLarge)
            if (wrong) Text("Not quite. Try this one.", color = MaterialTheme.colorScheme.error)
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = answer,
                onValueChange = { answer = it.filter(Char::isDigit) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() }),
            )
            Spacer(Modifier.height(8.dp))
            Button(onClick = ::submit) { Text("Unlock") }
        }
    }
}
