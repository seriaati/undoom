# Undoom architecture

Undoom takes the doom out of doomscrolling without taking away the scrolling.
Users get short sessions on the sites and apps they choose, with a required
rest between sessions.

Platforms: a Firefox extension (desktop) and an Android app distributed as an
APK. Both sync through one account.

## Concepts

- **Entry**: one service. It covers that service's web domains and Android
  packages, e.g. `reddit` → `reddit.com`, `redd.it`, `com.reddit.frontpage`.
  Entries come from a built-in catalog, or users add their own.
- **Target**: what limits apply to. It is either a single entry or a **group**
  of entries that share one budget. Each entry belongs to at most one target.
- **Limits** for each target: `sessionMs` (the longest a session can run) and
  `restMs` (the shortest break before the next session).

## How sessions work

All time is **foreground time**: the target's site is the active tab in the
focused Firefox window, or the target's app is in the foreground on Android
with the screen on.

State for each target: `usedMs` (in the current session), `lastActiveAt`, and
`restUntil`.

1. Foreground time on any of the target's entries adds to `usedMs`.
2. When `usedMs >= sessionMs`, the session ends: `restUntil = now + restMs` and
   `usedMs = 0`.
3. While `now < restUntil`, the target is blocked on every device.
4. A session that never reached its limit resets (`usedMs = 0`) once the user
   has been away from the target for at least `restMs`. They have already
   rested that long.
5. **Emergency unlock**: the user solves a simple math question on the block
   screen. This clears `restUntil` and starts a fresh session. Unlocks are
   recorded as events.

Blocking:

- **Web**: the tab is redirected to the extension's block page. It shows a
  countdown to `restUntil`, the emergency unlock, and a link back to the
  original URL once the rest is over. Every open tab of the target is blocked,
  not just the active one.
- **Android**: Undoom sends the user to the home screen, then opens a full-screen
  block activity with the same countdown and unlock.

## Sync model

Each device runs the session engine locally and makes every block decision
itself. Blocking never waits on the network, and offline mode uses the same
code path as online mode.

The device records its usage as an append-only event log:

```
{ eventId: "<deviceId>:<seq>", kind: "usage", targetId, startAt, durationMs }
{ eventId: "<deviceId>:<seq>", kind: "unlock", targetId, at }
```

- **Online**: the device flushes events every ~10s while a target is in use, and
  the server pushes the merged state back over a WebSocket. Within a few seconds
  every device knows about a session started on another device.
- **Offline**: each device keeps its own timers (independent state). When the
  device reconnects, it uploads its queued events. The server merges them with
  every other device's events in `startAt` order and replays them through the
  same engine. Offline usage from different devices therefore adds up, and if
  the total passed `sessionMs`, the target rests from the point where it
  crossed. Usage that the merge places inside a rest means the user wasn't
  resting, so the rest restarts after that usage ends.
- `eventId` makes uploads idempotent, so retries are safe.
- Device timestamps are corrected by a clock offset measured at each sync.
- The server keeps a snapshot of state and replays only events newer than the
  snapshot window. Older events are compacted away.

### Config sync

Config means targets, groups, limits, and custom entries. **The server is the
source of truth for config.** Each device downloads it and keeps a cached copy
so the rules still apply offline.

- The config is one versioned document for each user. When it changes, the
  server pushes it to every connected device. Devices also re-fetch it
  periodically and whenever they reconnect.
- An edit made offline is queued and sent on reconnect. The server applies
  edits in the order it receives them (last write wins) and sends the result
  back to every device.
- **Loosening is deferred.** For a target that is resting, any change that
  loosens it takes effect only when the current rest ends. Loosening means a
  longer `sessionMs` or shorter `restMs`, removing an entry from the target, or
  deleting the target. The server stores such a change as pending with
  `effectiveAt = restUntil`, and devices apply it at that time. Tightening
  changes apply immediately. An emergency unlock ends the rest, so it also
  applies pending changes.

### Shared engine spec

The session engine exists twice: in TypeScript (extension and server) and in
Kotlin (Android). To keep the two in step, `spec/vectors/*.json` holds
scenarios, each a config plus an event sequence plus the state expected at given
times. Both implementations must pass every vector in CI.

## Components

```
undoom/
├─ spec/                 engine test vectors (JSON)
├─ packages/engine/      TS session engine, used by the extension and the server
├─ packages/catalog/     built-in entries: domains + Android packages
├─ apps/extension/       Firefox MV2 extension (WXT + TypeScript + React)
├─ apps/server/          Cloudflare Worker + Durable Objects + D1
└─ apps/android/         Kotlin app (Jetpack Compose)
```

pnpm workspaces for the TS side. `apps/android` is a standalone Gradle project
that reads `spec/` and `packages/catalog/` as plain JSON.

### Server: Cloudflare Workers

- **One Durable Object per user**: the source of truth for that user's config,
  event log, and target state. It holds device WebSockets (hibernation API, so
  idle connections cost nothing) and broadcasts state changes. Storage is the
  DO's built-in SQLite.
- **D1**: the global tables that can't live in a per-user object: users, passkey
  credentials (credential ID → user), and devices/sessions.
- **Domain**: `undoom.seria.moe` serves the API, the sign-in page, and
  `/.well-known/assetlinks.json`.
- **Auth**: passkeys (WebAuthn) via `@simplewebauthn/server`, with RP ID
  `undoom.seria.moe`. A signed-in device can add a new passkey, which is the
  recovery path. Losing every passkey means losing the account.

### Firefox extension

- Manifest V2 with a persistent background page, so the 1 s tracking tick and
  the WebSocket stay alive (MV3 event pages get suspended), and `webRequest`
  can redirect blocked navigations synchronously.
- The background page is the device's single source of truth. It tracks the
  active tab, window focus, and `idle` state (time stops counting when the
  screen is locked), maps the URL to a target through the catalog, runs the
  engine, and redirects every tab of a blocked target to the block page. It
  also owns sync; the popup, options page, and block page ask it for state
  through `runtime.sendMessage`.
- Popup: current session/rest status for each target. Options page: targets,
  groups, limits, and the account.
- **Sign-in**: Firefox extension pages can't use the website's passkey RP ID,
  so sign-in happens on the Undoom web page, which is opened with
  `browser.identity.launchWebAuthFlow` and hands a session token back to the
  extension. Adding a passkey uses the same flow with `mode=add`. *(The
  redirect hand-off is verified in Firefox; the passkey prompt inside the
  auth window still needs a check in a normal, non-headless Firefox.)*
- Distribution: signed as an unlisted add-on on AMO and attached to the rolling
  `latest` GitHub release. Installed copies auto-update through the manifest's
  `update_url`, which points at the `updates.json` that CI writes next to the
  `.xpi` on every push to `main`.

### Android app

- **AccessibilityService** detects the foreground app from window-state events.
  System UI and keyboard windows are ignored, since they sit on top of the app
  in use. A 1 s tick extends or closes the foreground segment (every ~10 s, on
  app change, on screen off/lock) and blocks: `performGlobalAction(GLOBAL_ACTION_HOME)`,
  then the block activity about half a second later (the home action is
  asynchronous, and the activity would otherwise open behind the launcher).
- Sideloaded APKs on Android 13+ have accessibility under "restricted settings".
  Onboarding has to walk the user through App info → ⋮ → *Allow restricted
  settings* before the service can be turned on.
- The accessibility service also owns sync: it flushes the queue every ~10 s and
  keeps the WebSocket open (text `ping` every 30 s, reconnect with backoff). There
  is no separate foreground service. Local state (token, deviceId, seq, offset,
  snapshot, queue, pending config PUT) is one JSON file written with `AtomicFile`.
  Config edits are applied locally with `applyEdit` right away, so they are
  enforced offline, and sent as a pending PUT.
- **Sign-in**: Credential Manager passkeys. This needs
  `/.well-known/assetlinks.json` on `undoom.seria.moe` listing the APK signing
  certificate's SHA-256 fingerprint. That works for sideloaded APKs too, as long
  as every release is signed with the same key.
- Distribution: signed APKs attached to GitHub releases.

## License

AGPL-3.0. The network-use clause matters for `apps/server`: anyone running a
modified server must offer its source to its users.
