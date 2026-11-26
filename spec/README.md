# Engine test vectors

Each file is one scenario for the session engine. Every engine implementation
(TypeScript in `packages/engine`, Kotlin in `apps/android`) must pass all of them.

- `limits`: `sessionMs` and `restMs` for the target.
- `events`: usage and unlock events, in any order. Replay sorts them by time and
  drops duplicate `eventId`s.
- `expect`: the status at each time `at`, after replaying all events.

Times are milliseconds.
