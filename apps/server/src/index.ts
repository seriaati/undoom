import { Hono } from "hono";
import { type AppEnv, auth, requireAuth } from "./auth.ts";
import { configEditSchema, eventsBodySchema } from "./schema.ts";

export { UserHub } from "./hub.ts";

const app = new Hono<AppEnv>();

app.get("/.well-known/assetlinks.json", (c) => {
  const fingerprints = c.env.ANDROID_CERT_FINGERPRINTS.split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  return c.json([
    {
      relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
      target: { namespace: "android_app", package_name: c.env.ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
    },
  ]);
});

const api = new Hono<AppEnv>();
api.route("/", auth);

const hub = (c: { env: Env; get: (k: "userId") => string }) =>
  c.env.USER_HUB.get(c.env.USER_HUB.idFromName(c.get("userId")));

api.use("/sync/*", requireAuth);

api.get("/sync/state", async (c) => c.json(await hub(c).getSnapshot()));

api.put("/sync/config", async (c) => {
  const body = configEditSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid body", issues: body.error.issues }, 400);
  return c.json(await hub(c).putConfig(body.data));
});

api.post("/sync/events", async (c) => {
  const body = eventsBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid body", issues: body.error.issues }, 400);
  return c.json(await hub(c).addEvents(body.data.events));
});

api.get("/sync/ws", (c) => hub(c).fetch(c.req.raw));

app.route("/api", api);

export default app;
