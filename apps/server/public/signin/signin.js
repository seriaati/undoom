// The Firefox extension can't use passkeys for this site from its own pages, so it opens
// this page with browser.identity.launchWebAuthFlow and receives the token in the
// redirect's fragment. Only Firefox's extension redirect host is accepted.
const EXTENSION_REDIRECT = /^https:\/\/[0-9a-f]+\.extensions\.allizom\.org\/$/;

const params = new URLSearchParams(location.search);
const redirectUri = params.get("redirect_uri");
const mode = params.get("mode");
const $ = (id) => document.getElementById(id);

function show(id) {
  for (const section of ["signin", "add", "done"]) $(section).hidden = section !== id;
}

function fail(message) {
  $("error").textContent = message;
  $("error").hidden = false;
}

async function post(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

async function createPasskey(optionsPath, verifyPath, body, token) {
  const { flowId, options } = await post(optionsPath, body, token);
  const credential = await navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
  });
  return post(verifyPath, { flowId, response: credential.toJSON() }, token);
}

function finish(fragment, text) {
  if (redirectUri !== null) {
    location.href = `${redirectUri}#${new URLSearchParams(fragment)}`;
    return;
  }
  $("done-text").textContent = text;
  show("done");
}

async function run(button, action) {
  $("error").hidden = true;
  button.disabled = true;
  try {
    await action();
  } catch (e) {
    fail(e.name === "NotAllowedError" ? "The passkey prompt was cancelled." : e.message);
  } finally {
    button.disabled = false;
  }
}

if (redirectUri !== null && !EXTENSION_REDIRECT.test(redirectUri)) {
  fail("This sign-in link isn't from the Undoom extension.");
  $("signin").hidden = true;
} else if (typeof PublicKeyCredential?.parseCreationOptionsFromJSON !== "function") {
  fail("This browser doesn't support passkeys. Update it and try again.");
  $("signin").hidden = true;
} else if (mode === "add") {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  history.replaceState(null, "", location.pathname + location.search);
  show("add");
  $("add-button").addEventListener("click", () =>
    run($("add-button"), async () => {
      await createPasskey("/api/passkeys/options", "/api/passkeys/verify", {}, token);
      finish({ added: "1" }, "Your new passkey is ready.");
    }),
  );
} else {
  if (redirectUri !== null) $("purpose").textContent = "Sign in to connect the Undoom extension.";

  $("login").addEventListener("click", () =>
    run($("login"), async () => {
      const { flowId, options } = await post("/api/auth/login/options", {});
      const credential = await navigator.credentials.get({
        publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
      });
      const { token } = await post("/api/auth/login/verify", { flowId, response: credential.toJSON() });
      finish({ token }, "You're signed in. You can close this page.");
    }),
  );

  $("register").addEventListener("click", () =>
    run($("register"), async () => {
      const name = $("name").value.trim() || undefined;
      const { token } = await createPasskey("/api/auth/register/options", "/api/auth/register/verify", { name });
      finish({ token }, "Your account is ready. You can close this page.");
    }),
  );
}
