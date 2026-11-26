# Undoom API

Base URL: `https://undoom.seria.moe` (local: `http://localhost:8787` via `pnpm dev` in
`apps/server`). JSON in and out. Authenticated endpoints take
`Authorization: Bearer <token>`. Errors are `{ "error": string }` with a 4xx status.

## Types

```ts
type Entry = { id: string; name: string; domains: string[]; packages: string[] };
// Built-in entries: packages/catalog/catalog.json. Custom entry ids start with "custom:".

type Target = {
  id: string;                 // client-generated (UUID)
  name: string | null;        // null = single site/app; groups have a name
  entryIds: string[];         // at least one
  sessionMs: number;          // 1 min .. 24 h
  restMs: number;             // 1 min .. 7 days
  pending: null
    | { kind: "update"; entryIds: string[]; sessionMs: number; restMs: number }
    | { kind: "delete" };     // loosening waiting for the current rest to end
};
type Config = { version: number; targets: Target[]; customEntries: Entry[] };

type TargetState = { usedMs: number; lastActiveAt: number | null; restUntil: number | null };
type Snapshot = { config: Config; states: Record<string, TargetState>; serverTime: number };

type SyncEvent =
  | { kind: "usage"; eventId: string; targetId: string; startAt: number; durationMs: number } // durationMs 1 ms .. 60 min
  | { kind: "unlock"; eventId: string; targetId: string; at: number };
```

All times are epoch ms **in server time**. Clients keep `offset = serverTime - Date.now()`
from the latest snapshot and add it to local timestamps.

`eventId` is `"<deviceId>:<seq>"`, where `deviceId` is a random UUID made once per
install and `seq` increases. The server ignores ids it has already seen, so retrying
an upload is always safe.

## Auth (passkeys, RP ID `undoom.seria.moe`)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/auth/register/options` | `{ name?: string }` | `{ flowId, options }` (WebAuthn creation options JSON) |
| POST | `/api/auth/register/verify` | `{ flowId, response }` (RegistrationResponseJSON) | `{ token, userId }` |
| POST | `/api/auth/login/options` | `{}` | `{ flowId, options }` (request options JSON, discoverable credentials) |
| POST | `/api/auth/login/verify` | `{ flowId, response }` (AuthenticationResponseJSON) | `{ token, userId }` |
| POST | `/api/auth/logout` 🔒 | `{}` | `{ ok: true }` |
| GET | `/api/me` 🔒 | | `{ id, name }` |
| GET | `/api/passkeys` 🔒 | | `{ passkeys: [{ id, createdAt, lastUsedAt }] }` |
| POST | `/api/passkeys/options` 🔒 | `{}` | `{ flowId, options }` |
| POST | `/api/passkeys/verify` 🔒 | `{ flowId, response }` | `{ ok: true }` |
| DELETE | `/api/passkeys/:id` 🔒 | | `{ ok: true }`; 400 for the last passkey |

Each `flowId` is single-use and expires after 5 minutes.

- **Android** passes `options` straight to Credential Manager
  (`CreatePublicKeyCredentialRequest` / `GetPublicKeyCredentialOption`) and posts
  the returned JSON as `response`. The server accepts the origin
  `android:apk-key-hash:<sha256 of signing cert>` for every fingerprint in
  `ANDROID_CERT_FINGERPRINTS`. `/.well-known/assetlinks.json` lists them for package
  `moe.seria.undoom`.
- **Firefox extension** can't run WebAuthn for this RP ID from its own pages, so it uses
  `browser.identity.launchWebAuthFlow` with:
  - sign in: `https://undoom.seria.moe/signin/?redirect_uri=<browser.identity.getRedirectURL()>`.
    The flow ends at `<redirect_uri>#token=<token>`.
  - add a passkey: `https://undoom.seria.moe/signin/?mode=add&redirect_uri=<...>#token=<token>`.
    The flow ends at `<redirect_uri>#added=1`.

## Sync 🔒

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/sync/state` | | `Snapshot` |
| PUT | `/api/sync/config` | `{ targets: TargetEdit[], customEntries: Entry[] }` | `Snapshot` |
| POST | `/api/sync/events` | `{ events: SyncEvent[] }` (max 1000) | `Snapshot` |
| GET | `/api/sync/ws?token=<token>` | WebSocket | messages `{ type: "state", ...Snapshot }` |

- `TargetEdit` is `Target` without `pending`. A config PUT sends the **whole desired
  config**: `desiredEdit(config)` from `@undoom/engine`, with the user's changes applied.
  Targets left out are deleted. The server decides what applies now and what stays
  pending (see `applyEdit`).
- The WebSocket sends a snapshot as soon as it connects and again after every change
  from any device. Send `"ping"` to get `"pong"` back as a keepalive (every 30 s is fine).
  Reconnect with backoff.

## Client algorithm (both platforms)

Local storage: `token`, `deviceId`, `seq`, `offset`, the latest `Snapshot`, and
`queue` (events not yet acknowledged).

1. **Effective config**: `effectiveConfig(snapshot.config, isResting)`. Pending
   changes apply locally once the target's rest is over.
2. **Local state** of a target: `replay(limits, queue events for it, snapshot.states[id] ?? initialState)`,
   plus the open, not-yet-recorded foreground segment. `status(state, limits, now)`
   decides `blocked` and `remainingMs`.
3. **Tracking**: while a target's site or app is in the foreground, extend an open
   segment. Close the segment as a `usage` event (append to `queue`) when the
   foreground changes, every ~10 s, and when `remainingMs` reaches 0 (then block).
   A site or app matching several targets counts toward all of them.
4. **Flush** `queue` with `POST /api/sync/events` whenever it isn't empty and the
   device is online, at most every ~10 s. On success, drop the sent events and store the
   returned snapshot. On a network failure, keep them and retry later.
5. **Offline**: steps 1–3 keep working from the cached snapshot. Config edits made
   offline are kept as a pending PUT body and sent on reconnect (last write wins).
6. **Emergency unlock**: show `a + b` or `a × b` with small random numbers. A correct
   answer appends an `unlock` event (`at = now`) and unblocks the target immediately.
