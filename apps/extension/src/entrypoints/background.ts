import catalog from "@undoom/catalog";
import { type ConfigEdit, desiredEdit } from "@undoom/engine";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { API_URL } from "@/lib/env";
import { ApiError, call, callForSnapshot } from "@/lib/api";
import { blockPageUrl } from "@/lib/block";
import {
  acknowledge,
  blockingTarget,
  currentConfig,
  type Device,
  emptySnapshot,
  hostOf,
  type NewSyncEvent,
  type Segment,
  type Snapshot,
  statuses,
  type SyncEvent,
  track,
} from "@/lib/device";
import type { Request, Result, View } from "@/lib/messages";

interface Stored {
  token: string | null;
  deviceId: string;
  seq: number;
  /** Server time minus local time. */
  offset: number;
  snapshot: Snapshot | null;
  queue: SyncEvent[];
  pendingEdit: ConfigEdit | null;
}

const TICK_MS = 1000;
const FLUSH_INTERVAL_MS = 10_000;
const PING_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_EVENTS_PER_UPLOAD = 1000;

export default defineBackground({
  persistent: true,
  main() {
    void start();
  },
});

async function start() {
  const stored: Partial<Stored> = await browser.storage.local.get(null);
  const s: Stored = {
    token: stored.token ?? null,
    deviceId: stored.deviceId ?? crypto.randomUUID(),
    seq: stored.seq ?? 0,
    offset: stored.offset ?? 0,
    snapshot: stored.snapshot ?? null,
    queue: stored.queue ?? [],
    pendingEdit: stored.pendingEdit ?? null,
  };
  let segment: Segment | null = null;

  function save(patch: Partial<Stored>) {
    Object.assign(s, patch);
    void browser.storage.local.set(patch);
  }
  save({ deviceId: s.deviceId });

  const now = () => Date.now() + s.offset;
  const device = (): Device => ({
    snapshot: s.snapshot ?? emptySnapshot,
    queue: s.queue,
    pendingEdit: s.pendingEdit,
    segment,
  });

  function enqueue(events: NewSyncEvent[]) {
    let seq = s.seq;
    const withIds = events.map((e) => ({ ...e, eventId: `${s.deviceId}:${seq++}` }) as SyncEvent);
    save({ queue: [...s.queue, ...withIds], seq });
  }

  function blockedTargetFor(url: string): string | null {
    const t = now();
    const config = currentConfig(device(), t);
    return blockingTarget(config, catalog, statuses(device(), config, t), url);
  }

  const blockPage = (targetId: string, url: string) =>
    blockPageUrl(browser.runtime.getURL("/blocked.html"), targetId, url);

  let focusedWindow: number = browser.windows.WINDOW_ID_NONE;
  const lastFocused = await browser.windows.getLastFocused();
  if (lastFocused.focused && lastFocused.id !== undefined) focusedWindow = lastFocused.id;
  browser.windows.onFocusChanged.addListener((id) => (focusedWindow = id));
  let locked = (await browser.idle.queryState(60)) === "locked";
  browser.idle.onStateChanged.addListener((state) => (locked = state === "locked"));

  async function foregroundHost(): Promise<string | null> {
    if (locked || focusedWindow === browser.windows.WINDOW_ID_NONE) return null;
    const [tab] = await browser.tabs.query({ active: true, windowId: focusedWindow });
    return tab?.url === undefined ? null : hostOf(tab.url);
  }

  async function enforce() {
    const tabs = await browser.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const { id, url } of tabs) {
      if (id === undefined || url === undefined) continue;
      const targetId = blockedTargetFor(url);
      if (targetId !== null) void browser.tabs.update(id, { url: blockPage(targetId, url) });
    }
  }

  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const host = await foregroundHost();
      const result = track(device(), catalog, host, now());
      segment = result.segment;
      if (result.usages.length > 0) enqueue(result.usages.map((u) => ({ kind: "usage", ...u })));
      await enforce();
      void flush(false);
      void sendPendingEdit(false);
    } finally {
      ticking = false;
    }
  }

  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      const targetId = blockedTargetFor(details.url);
      return targetId === null ? {} : { redirectUrl: blockPage(targetId, details.url) };
    },
    { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] },
    ["blocking"],
  );

  // Single-page apps change the URL without a request.
  browser.tabs.onUpdated.addListener((tabId, { url }) => {
    const targetId = url === undefined ? null : blockedTargetFor(url);
    if (url !== undefined && targetId !== null) void browser.tabs.update(tabId, { url: blockPage(targetId, url) });
  });

  let flushing = false;
  let lastFlushAt = 0;
  // A pushed snapshot may already count events that are still in the queue while an upload is
  // in flight, which would count them twice. Hold it until the upload settles.
  let held: { snapshot: Snapshot; offset: number } | null = null;

  function receive(snapshot: Snapshot, offset: number) {
    if (s.token === null) return;
    if (flushing) {
      held = { snapshot, offset };
      return;
    }
    if (s.snapshot !== null && snapshot.serverTime < s.snapshot.serverTime) return;
    save({ snapshot, offset });
  }

  async function request(method: string, path: string, body?: unknown) {
    try {
      return await callForSnapshot(API_URL, s.token!, method, path, body);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) signOutLocally();
      throw e;
    }
  }

  async function flush(force: boolean) {
    if (s.token === null || flushing || s.queue.length === 0) return;
    if (!force && Date.now() - lastFlushAt < FLUSH_INTERVAL_MS) return;
    flushing = true;
    lastFlushAt = Date.now();
    const events = s.queue.slice(0, MAX_EVENTS_PER_UPLOAD);
    let result: { snapshot: Snapshot; offset: number } | null = null;
    try {
      result = await request("POST", "/api/sync/events", { events });
      save({ queue: acknowledge(s.queue, events) });
    } catch {
      // Offline: the events stay queued for the next try.
    }
    flushing = false;
    const pushed = held;
    held = null;
    if (result !== null) receive(result.snapshot, result.offset);
    if (pushed !== null) receive(pushed.snapshot, pushed.offset);
  }

  let sendingEdit = false;
  let lastEditAttemptAt = 0;
  /** Returns an error message when the server rejects the edit; otherwise it stays pending until it goes through. */
  async function sendPendingEdit(force: boolean): Promise<string | null> {
    const edit = s.pendingEdit;
    if (s.token === null || edit === null || sendingEdit) return null;
    if (!force && Date.now() - lastEditAttemptAt < FLUSH_INTERVAL_MS) return null;
    sendingEdit = true;
    lastEditAttemptAt = Date.now();
    try {
      const { snapshot, offset } = await request("PUT", "/api/sync/config", edit);
      if (s.pendingEdit === edit) save({ pendingEdit: null });
      receive(snapshot, offset);
      return null;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 401 || e.status >= 500) return null;
      if (s.pendingEdit === edit) save({ pendingEdit: null });
      return e.message;
    } finally {
      sendingEdit = false;
    }
  }

  let socket: WebSocket | null = null;
  let backoff = 1000;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  async function connect() {
    if (s.token === null) return;
    try {
      const { snapshot, offset } = await request("GET", "/api/sync/state");
      receive(snapshot, offset);
    } catch {
      if (s.token !== null) scheduleReconnect();
      return;
    }
    if (s.token === null) return;
    const ws = new WebSocket(`${API_URL.replace(/^http/, "ws")}/api/sync/ws?token=${encodeURIComponent(s.token)}`);
    socket = ws;
    ws.onopen = () => (backoff = 1000);
    ws.onmessage = (message) => {
      if (socket !== ws || message.data === "pong") return;
      const { type, ...snapshot } = JSON.parse(message.data as string);
      if (type === "state") receive(snapshot as Snapshot, snapshot.serverTime - Date.now());
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }

  function disconnect() {
    clearTimeout(reconnectTimer);
    const ws = socket;
    socket = null;
    ws?.close();
  }

  function signOutLocally() {
    disconnect();
    segment = null;
    save({ token: null, snapshot: null, queue: [], pendingEdit: null });
  }

  async function launchSignInPage(params: Record<string, string>, fragment = ""): Promise<URLSearchParams> {
    const query = new URLSearchParams({ ...params, redirect_uri: browser.identity.getRedirectURL() });
    const result = await browser.identity.launchWebAuthFlow({
      url: `${API_URL}/signin/?${query}${fragment}`,
      interactive: true,
    });
    return new URLSearchParams(new URL(result ?? "").hash.slice(1));
  }

  async function signIn(): Promise<Result> {
    const token = (await launchSignInPage({})).get("token");
    if (token === null) return { error: "Sign-in didn't finish." };
    disconnect();
    save({ token, snapshot: null, queue: [], pendingEdit: null });
    backoff = 1000;
    void connect();
    return { error: null };
  }

  async function signOut(): Promise<Result> {
    const token = s.token;
    if (token === null) return { error: null };
    await flush(true);
    await call(API_URL, token, "POST", "/api/auth/logout", {}).catch(() => {});
    signOutLocally();
    return { error: null };
  }

  async function addPasskey(): Promise<Result> {
    if (s.token === null) return { error: "Sign in first." };
    const result = await launchSignInPage({ mode: "add" }, `#${new URLSearchParams({ token: s.token })}`);
    return { error: result.get("added") === "1" ? null : "The passkey wasn't added." };
  }

  function view(): View {
    const t = now();
    const d = device();
    const config = currentConfig(d, t);
    return {
      signedIn: s.token !== null,
      loaded: s.snapshot !== null,
      now: t,
      config,
      desired: s.pendingEdit ?? desiredEdit(d.snapshot.config),
      statuses: statuses(d, config, t),
      unsynced: s.queue.length > 0 || s.pendingEdit !== null,
    };
  }

  async function handle(message: Request): Promise<View | Result> {
    switch (message.type) {
      case "view":
        return view();
      case "signIn":
        return signIn();
      case "signOut":
        return signOut();
      case "addPasskey":
        return addPasskey();
      case "saveConfig":
        save({ pendingEdit: message.edit });
        return { error: await sendPendingEdit(true) };
      case "unlock":
        enqueue([{ kind: "unlock", targetId: message.targetId, at: now() }]);
        void flush(true);
        return { error: null };
    }
  }

  browser.runtime.onMessage.addListener((message: Request) =>
    handle(message).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) })),
  );

  setInterval(() => void tick(), TICK_MS);
  setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
  }, PING_MS);
  void connect();
}
