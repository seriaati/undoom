package moe.seria.undoom

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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

private data class Question(val text: String, val answer: Int)

// Same sums as newQuestion in the extension's question.ts.
private fun newQuestion(): Question = if (Random.nextBoolean()) {
    val a = Random.nextInt(3, 13)
    val b = Random.nextInt(3, 13)
    Question("$a × $b", a * b)
} else {
    val a = Random.nextInt(12, 90)
    val b = Random.nextInt(12, 90)
    Question("$a + $b", a + b)
}

@Composable
private fun BlockScreen(targetId: String, close: () -> Unit) {
    val saved by Repo.saved.collectAsState()
    val now = rememberNow()
    val target = Repo.effective(saved, now).targets.find { it.id == targetId }
    val status = target?.let { status(Repo.localState(it, saved), it.limits, now) }

    LaunchedEffect(status?.blocked) {
        if (status?.blocked != true) close()
    }
    val restUntil = status?.restUntil
    if (target == null || restUntil == null) return

    var showUnlock by remember { mutableStateOf(false) }
    val colors = MaterialTheme.colorScheme

    // Scrolls so the open keyboard can't push the unlock field off screen; heightIn keeps the card centred otherwise.
    BoxWithConstraints(Modifier.fillMaxSize()) {
        Box(
            Modifier.verticalScroll(rememberScrollState()).fillMaxWidth().heightIn(min = maxHeight).padding(horizontal = 16.dp, vertical = 24.dp),
            contentAlignment = Alignment.Center,
        ) {
            OutlinedCard(Modifier.widthIn(max = 380.dp).fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
                Column(Modifier.animateContentSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Brand()
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Tile(targetEntries(target, saved), 56.dp)
                        Text("${displayName(target, saved)} is resting", fontSize = 20.sp, lineHeight = 25.sp, fontWeight = FontWeight.Bold)
                    }
                    Countdown(restUntil - now, "until the next session", colors.error, fontSize = 40.sp)
                    Bar(1f - (restUntil - now).toFloat() / target.restMs, colors.error)
                    AnimatedContent(showUnlock, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "unlock") { unlocking ->
                        if (unlocking) {
                            Unlock { Repo.unlock(target.id) }
                        } else {
                            TextButton(
                                onClick = { showUnlock = true },
                                contentPadding = PaddingValues(vertical = 8.dp),
                                colors = ButtonDefaults.textButtonColors(contentColor = colors.onSurfaceVariant),
                            ) { IconLabel(R.drawable.ic_lock_open, "I need it now") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Unlock(unlock: () -> Unit) {
    var question by remember { mutableStateOf(newQuestion()) }
    var answer by remember { mutableStateOf("") }
    var wrong by remember { mutableStateOf(false) }

    fun submit() {
        if (answer.toIntOrNull() == question.answer) {
            unlock()
        } else {
            wrong = true
            question = newQuestion()
            answer = ""
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        HorizontalDivider(Modifier.padding(bottom = 8.dp), color = MaterialTheme.colorScheme.outlineVariant)
        Text("Emergency unlock", fontSize = 17.sp, fontWeight = FontWeight.Bold)
        Text("This ends the rest and starts a new session.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${question.text} =")
            OutlinedTextField(
                value = answer,
                onValueChange = { answer = it.filter(Char::isDigit) },
                modifier = Modifier.weight(1f),
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() }),
            )
            Button(onClick = ::submit) { IconLabel(R.drawable.ic_lock_open, "Unlock") }
        }
        AnimatedVisibility(wrong) { Text("Not quite. Try this one.", color = MaterialTheme.colorScheme.error) }
    }
}
