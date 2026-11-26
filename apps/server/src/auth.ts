import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticatorTransport,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { ceremonyBodySchema, registerOptionsBodySchema } from "./schema.ts";

export type AppEnv = { Bindings: Env; Variables: { userId: string } };

const CHALLENGE_TTL_MS = 5 * 60_000;

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Origins WebAuthn responses may come from: the website, plus the Android app's signing certificates. */
export function expectedOrigins(env: Env): string[] {
  const android = env.ANDROID_CERT_FINGERPRINTS.split(",")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => {
      const bytes = new Uint8Array(f.split(":").map((h) => Number.parseInt(h, 16)));
      return `android:apk-key-hash:${base64url(bytes)}`;
    });
  return [env.ORIGIN, ...android];
}

async function createSession(env: Env, userId: string): Promise<string> {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
  )
    .bind(await sha256Hex(token), userId, now, now)
    .run();
  return token;
}

export async function userForToken(env: Env, token: string): Promise<string | null> {
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT user_id FROM sessions WHERE token_hash = ?")
    .bind(hash)
    .first<{ user_id: string }>();
  if (row === null) return null;
  await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").bind(Date.now(), hash).run();
  return row.user_id;
}

function bearerToken(c: Context<AppEnv>): string | null {
  const header = c.req.header("Authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  // Browsers can't set headers on WebSocket requests.
  if (c.req.header("Upgrade") === "websocket") return c.req.query("token") ?? null;
  return null;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearerToken(c);
  const userId = token === null ? null : await userForToken(c.env, token);
  if (userId === null) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", userId);
  await next();
};

interface ChallengeData {
  userId?: string;
  name?: string;
}

async function saveChallenge(env: Env, challenge: string, data: ChallengeData): Promise<string> {
  const flowId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM challenges WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO challenges (id, challenge, data, expires_at) VALUES (?, ?, ?, ?)").bind(
      flowId,
      challenge,
      JSON.stringify(data),
      now + CHALLENGE_TTL_MS,
    ),
  ]);
  return flowId;
}

/** Each challenge can be used once. */
async function takeChallenge(
  env: Env,
  flowId: string,
): Promise<{ challenge: string; data: ChallengeData } | null> {
  const row = await env.DB.prepare("DELETE FROM challenges WHERE id = ? AND expires_at >= ? RETURNING challenge, data")
    .bind(flowId, Date.now())
    .first<{ challenge: string; data: string }>();
  return row === null ? null : { challenge: row.challenge, data: JSON.parse(row.data) };
}

async function registrationOptions(env: Env, userId: string, name: string, exclude: { id: string }[]) {
  return generateRegistrationOptions({
    rpName: "Undoom",
    rpID: env.RP_ID,
    userName: name,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    excludeCredentials: exclude,
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
}

async function verifyRegistration(env: Env, challenge: string, response: unknown) {
  const verification = await verifyRegistrationResponse({
    response: response as RegistrationResponseJSON,
    expectedChallenge: challenge,
    expectedOrigin: expectedOrigins(env),
    expectedRPID: env.RP_ID,
    requireUserVerification: false,
  });
  return verification.verified ? verification.registrationInfo.credential : null;
}

function insertCredential(env: Env, userId: string, credential: WebAuthnCredential) {
  return env.DB.prepare(
    "INSERT INTO credentials (id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(
    credential.id,
    userId,
    credential.publicKey,
    credential.counter,
    JSON.stringify(credential.transports ?? []),
    Date.now(),
  );
}

async function verifyOrNull<T>(verify: () => Promise<T>): Promise<T | null> {
  try {
    return await verify();
  } catch {
    return null;
  }
}

export const auth = new Hono<AppEnv>();

auth.post("/auth/register/options", async (c) => {
  const body = registerOptionsBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid body" }, 400);
  const userId = crypto.randomUUID();
  const name = body.data.name ?? "Undoom";
  const options = await registrationOptions(c.env, userId, name, []);
  const flowId = await saveChallenge(c.env, options.challenge, { userId, name });
  return c.json({ flowId, options });
});

auth.post("/auth/register/verify", async (c) => {
  const body = ceremonyBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid body" }, 400);
  const flow = await takeChallenge(c.env, body.data.flowId);
  if (flow?.data.userId === undefined || flow.data.name === undefined) {
    return c.json({ error: "unknown or expired flow" }, 400);
  }
  const credential = await verifyOrNull(() => verifyRegistration(c.env, flow.challenge, body.data.response));
  if (credential === null) return c.json({ error: "verification failed" }, 400);
  const { userId, name } = flow.data;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)").bind(userId, name, Date.now()),
    insertCredential(c.env, userId, credential),
  ]);
  return c.json({ token: await createSession(c.env, userId), userId });
});

auth.post("/auth/login/options", async (c) => {
  const options = await generateAuthenticationOptions({ rpID: c.env.RP_ID, userVerification: "preferred" });
  const flowId = await saveChallenge(c.env, options.challenge, {});
  return c.json({ flowId, options });
});

auth.post("/auth/login/verify", async (c) => {
  const body = ceremonyBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid body" }, 400);
  const flow = await takeChallenge(c.env, body.data.flowId);
  if (flow === null) return c.json({ error: "unknown or expired flow" }, 400);
  const credentialId = (body.data.response as { id?: unknown })?.id;
  if (typeof credentialId !== "string") return c.json({ error: "invalid body" }, 400);

  const row = await c.env.DB.prepare(
    "SELECT user_id, public_key, counter, transports FROM credentials WHERE id = ?",
  )
    .bind(credentialId)
    .first<{ user_id: string; public_key: ArrayBuffer; counter: number; transports: string }>();
  if (row === null) return c.json({ error: "unknown passkey" }, 400);

  const verification = await verifyOrNull(() =>
    verifyAuthenticationResponse({
      response: body.data.response,
      expectedChallenge: flow.challenge,
      expectedOrigin: expectedOrigins(c.env),
      expectedRPID: c.env.RP_ID,
      requireUserVerification: false,
      credential: {
        id: credentialId,
        publicKey: new Uint8Array(row.public_key),
        counter: row.counter,
        transports: JSON.parse(row.transports) as AuthenticatorTransport[],
      },
    }),
  );
  if (!verification?.verified) return c.json({ error: "verification failed" }, 400);

  await c.env.DB.prepare("UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?")
    .bind(verification.authenticationInfo.newCounter, Date.now(), credentialId)
    .run();
  return c.json({ token: await createSession(c.env, row.user_id), userId: row.user_id });
});

auth.post("/auth/logout", requireAuth, async (c) => {
  const token = bearerToken(c) ?? "";
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return c.json({ ok: true });
});

auth.get("/me", requireAuth, async (c) => {
  const user = await c.env.DB.prepare("SELECT id, name FROM users WHERE id = ?")
    .bind(c.get("userId"))
    .first<{ id: string; name: string }>();
  return c.json(user);
});

auth.get("/passkeys", requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, created_at AS createdAt, last_used_at AS lastUsedAt FROM credentials WHERE user_id = ? ORDER BY created_at",
  )
    .bind(c.get("userId"))
    .all();
  return c.json({ passkeys: results });
});

auth.post("/passkeys/options", requireAuth, async (c) => {
  const userId = c.get("userId");
  const user = await c.env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(userId).first<{ name: string }>();
  const { results } = await c.env.DB.prepare("SELECT id FROM credentials WHERE user_id = ?").bind(userId).all<{ id: string }>();
  const options = await registrationOptions(c.env, userId, user?.name ?? "Undoom", results);
  const flowId = await saveChallenge(c.env, options.challenge, { userId });
  return c.json({ flowId, options });
});

auth.post("/passkeys/verify", requireAuth, async (c) => {
  const body = ceremonyBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid body" }, 400);
  const flow = await takeChallenge(c.env, body.data.flowId);
  if (flow === null || flow.data.userId !== c.get("userId")) {
    return c.json({ error: "unknown or expired flow" }, 400);
  }
  const credential = await verifyOrNull(() => verifyRegistration(c.env, flow.challenge, body.data.response));
  if (credential === null) return c.json({ error: "verification failed" }, 400);
  await insertCredential(c.env, c.get("userId"), credential).run();
  return c.json({ ok: true });
});

auth.delete("/passkeys/:id", requireAuth, async (c) => {
  const userId = c.get("userId");
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?")
    .bind(userId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) <= 1) return c.json({ error: "can't delete the last passkey" }, 400);
  const { meta } = await c.env.DB.prepare("DELETE FROM credentials WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  return meta.changes > 0 ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});
