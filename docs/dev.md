# Development

Requires Node 24+, pnpm, JDK 25 and the Android SDK.

```sh
pnpm install
pnpm test        # engine, server and extension tests
pnpm typecheck
```

## Server

```sh
cd apps/server
cp .dev.vars.example .dev.vars
pnpm exec wrangler d1 migrations apply undoom --local
pnpm dev         # http://localhost:8787
```

## Extension

```sh
cd apps/extension
WXT_API_URL=http://localhost:8787 pnpm exec wxt build -b firefox
```

Load `.output/firefox-mv2/manifest.json` from `about:debugging#/runtime/this-firefox`.

## Android

```sh
cd apps/android
./gradlew test assembleDebug
```

Debug builds talk to `http://10.0.2.2:8787`, which is the host machine's
`localhost:8787` as seen from the emulator. Passkeys only work against
`undoom.seria.moe`, so debug builds also accept a pasted token.

## Deploying

1. `pnpm exec wrangler d1 create undoom`, then put the database ID in
   `apps/server/wrangler.jsonc`.
2. `pnpm exec wrangler d1 migrations apply undoom --remote`
3. Set `ANDROID_CERT_FINGERPRINTS` in `wrangler.jsonc` to the release signing
   certificate's SHA-256 fingerprint (`keytool -list -v -keystore <keystore>`).
4. `pnpm run deploy` from `apps/server`. This serves `undoom.seria.moe` as a custom domain.
After that, pushes to `main` that touch the server, engine or catalog apply
migrations and deploy automatically (`.github/workflows/deploy.yml`, using the
`CLOUDFLARE_API_TOKEN` repository secret).
