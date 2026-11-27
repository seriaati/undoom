import { env, SELF } from "cloudflare:test";
import { describe, expect, test } from "vitest";
import { SoftAuthenticator } from "./authenticator.ts";

const MIN = 60_000;
const BASE = "https://undoom.test";

async function call(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function signUp(name = "Tester") {
  const authenticator = new SoftAuthenticator(env.RP_ID, env.ORIGIN);
  const { body: start } = await call("/api/auth/register/options", { body: { name } });
  const response = await authenticator.create(start.options);
  const { status, body } = await call("/api/auth/register/verify", { body: { flowId: start.flowId, response } });
  expect(status).toBe(200);
  return { authenticator, token: body.token as string, userId: body.userId as string };
}

const reddit = { id: "t1", name: null, entryIds: ["reddit"], sessionMs: 5 * MIN, restMs: 60 * MIN };

describe("auth", () => {
  test("sign up, then sign in with the same passkey", async () => {
    const { authenticator, token, userId } = await signUp();
    expect((await call("/api/me", { token })).body).toEqual({ id: userId, name: "Tester" });

    const { body: start } = await call("/api/auth/login/options", { body: {} });
    const response = await authenticator.get(start.options);
    const login = await call("/api/auth/login/verify", { body: { flowId: start.flowId, response } });
    expect(login.status).toBe(200);
    expect(login.body.userId).toBe(userId);
    expect(login.body.token).not.toBe(token);
  });

  test("a challenge can't be used twice", async () => {
    const { authenticator } = await signUp();
    const { body: start } = await call("/api/auth/login/options", { body: {} });
    const response = await authenticator.get(start.options);
    expect((await call("/api/auth/login/verify", { body: { flowId: start.flowId, response } })).status).toBe(200);
    expect((await call("/api/auth/login/verify", { body: { flowId: start.flowId, response } })).status).toBe(400);
  });

  test("a response signed for another challenge is rejected", async () => {
    const { authenticator } = await signUp();
    const { body: a } = await call("/api/auth/login/options", { body: {} });
    const { body: b } = await call("/api/auth/login/options", { body: {} });
    const response = await authenticator.get(a.options);
    expect((await call("/api/auth/login/verify", { body: { flowId: b.flowId, response } })).status).toBe(400);
  });

  test("requests without a valid token are rejected", async () => {
    expect((await call("/api/me")).status).toBe(401);
    expect((await call("/api/sync/state", { token: "nope" })).status).toBe(401);
  });

  test("logout revokes the token", async () => {
    const { token } = await signUp();
    expect((await call("/api/auth/logout", { token, body: {} })).status).toBe(200);
    expect((await call("/api/me", { token })).status).toBe(401);
  });

  test("a signed-in device can add a passkey, which then signs in", async () => {
    const { token, userId } = await signUp();
    const second = new SoftAuthenticator(env.RP_ID, env.ORIGIN);
    const { body: start } = await call("/api/passkeys/options", { token, body: {} });
    expect(start.options.excludeCredentials).toHaveLength(1);
    const added = await call("/api/passkeys/verify", {
      token,
      body: { flowId: start.flowId, response: await second.create(start.options) },
    });
    expect(added.status).toBe(200);

    const { body: passkeys } = await call("/api/passkeys", { token });
    expect(passkeys.passkeys).toHaveLength(2);

    const { body: login } = await call("/api/auth/login/options", { body: {} });
    const res = await call("/api/auth/login/verify", {
      body: { flowId: login.flowId, response: await second.get(login.options) },
    });
    expect(res.body.userId).toBe(userId);
  });

  test("the last passkey can't be deleted", async () => {
    const { token } = await signUp();
    const { body } = await call("/api/passkeys", { token });
    const res = await call(`/api/passkeys/${body.passkeys[0].id}`, { token, method: "DELETE" });
    expect(res.status).toBe(400);
  });
});

describe("sync", () => {
  test("new accounts start with an empty config", async () => {
    const { token } = await signUp();
    const { body } = await call("/api/sync/state", { token });
    expect(body.config).toEqual({ version: 0, targets: [], customEntries: [] });
    expect(typeof body.serverTime).toBe("number");
  });

  test("usage from several devices adds up and starts a rest", async () => {
    const { token } = await signUp();
    await call("/api/sync/config", { token, method: "PUT", body: { targets: [reddit], customEntries: [] } });
    const now = Date.now();
    const events = [
      { kind: "usage", eventId: "phone:1", targetId: "t1", startAt: now - 6 * MIN, durationMs: 3 * MIN },
      { kind: "usage", eventId: "pc:1", targetId: "t1", startAt: now - 3 * MIN, durationMs: 3 * MIN },
    ];
    const { body } = await call("/api/sync/events", { token, body: { events } });
    expect(body.states.t1.restUntil).toBe(now + 60 * MIN);

    // Re-uploading the same events changes nothing.
    const again = await call("/api/sync/events", { token, body: { events } });
    expect(again.body.states.t1).toEqual(body.states.t1);
  });

  test("users' data is separate", async () => {
    const a = await signUp();
    const b = await signUp();
    await call("/api/sync/config", { token: a.token, method: "PUT", body: { targets: [reddit], customEntries: [] } });
    expect((await call("/api/sync/state", { token: b.token })).body.config.targets).toEqual([]);
  });

  test("loosening a resting target waits; tightening applies now", async () => {
    const { token } = await signUp();
    await call("/api/sync/config", { token, method: "PUT", body: { targets: [reddit], customEntries: [] } });
    const now = Date.now();
    await call("/api/sync/events", {
      token,
      body: { events: [{ kind: "usage", eventId: "pc:1", targetId: "t1", startAt: now - 5 * MIN, durationMs: 5 * MIN }] },
    });

    const loose = await call("/api/sync/config", {
      token,
      method: "PUT",
      body: {
        targets: [{ ...reddit, sessionMs: 30 * MIN, restMs: 90 * MIN, excludeDomains: ["old.reddit.com"] }],
        customEntries: [],
      },
    });
    expect(loose.body.config.targets[0]).toMatchObject({
      sessionMs: 5 * MIN,
      restMs: 90 * MIN,
      excludeDomains: [],
      pending: { kind: "update", sessionMs: 30 * MIN, excludeDomains: ["old.reddit.com"] },
    });

    // An emergency unlock ends the rest, so the pending change applies.
    const unlocked = await call("/api/sync/events", {
      token,
      body: { events: [{ kind: "unlock", eventId: "pc:2", targetId: "t1", at: Date.now() }] },
    });
    expect(unlocked.body.config.targets[0]).toMatchObject({
      sessionMs: 30 * MIN,
      excludeDomains: ["old.reddit.com"],
      pending: null,
    });
  });

  test("invalid config is rejected", async () => {
    const { token } = await signUp();
    const bad = { targets: [{ ...reddit, sessionMs: 1 }], customEntries: [] };
    expect((await call("/api/sync/config", { token, method: "PUT", body: bad })).status).toBe(400);
  });

  test("connected devices receive state over the WebSocket", async () => {
    const { token } = await signUp();
    const res = await SELF.fetch(`${BASE}/api/sync/ws?token=${token}`, { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket;
    expect(ws).toBeTruthy();
    if (!ws) return;
    ws.accept();
    const messages: any[] = [];
    ws.addEventListener("message", (e) => {
      messages.push(JSON.parse(e.data as string));
    });

    await call("/api/sync/config", { token, method: "PUT", body: { targets: [reddit], customEntries: [] } });
    await expect.poll(() => messages.at(-1)?.config?.version).toBe(1);
    expect(messages[0]).toMatchObject({ type: "state", config: { version: 0 } });
    ws.close();
  });
});

test("assetlinks lists the Android app for passkeys", async () => {
  const res = await SELF.fetch(`${BASE}/.well-known/assetlinks.json`);
  const body = (await res.json()) as any;
  expect(body[0].relation).toContain("delegate_permission/common.get_login_creds");
  expect(body[0].target.package_name).toBe(env.ANDROID_PACKAGE);
});
