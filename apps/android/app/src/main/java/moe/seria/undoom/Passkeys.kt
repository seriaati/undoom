package moe.seria.undoom

import android.app.Activity
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

private val empty = JsonObject(emptyMap())

/** Returns the session token. */
suspend fun registerWithPasskey(activity: Activity): String {
    val start = Repo.call("POST", "/api/auth/register/options", empty)
    val result = Repo.call("POST", "/api/auth/register/verify", ceremony(start, createPasskey(activity, start)))
    return result.getValue("token").jsonPrimitive.content
}

/** Returns the session token. */
suspend fun signInWithPasskey(activity: Activity): String {
    val start = Repo.call("POST", "/api/auth/login/options", empty)
    val option = GetPublicKeyCredentialOption(start.getValue("options").toString())
    val credential = CredentialManager.create(activity)
        .getCredential(activity, GetCredentialRequest(listOf(option)))
        .credential as PublicKeyCredential
    val result = Repo.call("POST", "/api/auth/login/verify", ceremony(start, credential.authenticationResponseJson))
    return result.getValue("token").jsonPrimitive.content
}

suspend fun addPasskey(activity: Activity, token: String) {
    val start = Repo.call("POST", "/api/passkeys/options", empty, token)
    Repo.call("POST", "/api/passkeys/verify", ceremony(start, createPasskey(activity, start)), token)
}

private suspend fun createPasskey(activity: Activity, start: JsonObject): String {
    val request = CreatePublicKeyCredentialRequest(start.getValue("options").toString())
    val response = CredentialManager.create(activity).createCredential(activity, request)
    return (response as CreatePublicKeyCredentialResponse).registrationResponseJson
}

private fun ceremony(start: JsonObject, responseJson: String) = buildJsonObject {
    put("flowId", start.getValue("flowId"))
    put("response", json.parseToJsonElement(responseJson))
}
