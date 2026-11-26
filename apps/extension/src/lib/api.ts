import type { Snapshot } from "./device.ts";
import { offsetFrom } from "./device.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Throws ApiError for error responses and TypeError when offline. */
export async function call<T>(base: string, token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export async function callForSnapshot(
  base: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ snapshot: Snapshot; offset: number }> {
  const sentAt = Date.now();
  const snapshot = await call<Snapshot>(base, token, method, path, body);
  return { snapshot, offset: offsetFrom(snapshot.serverTime, sentAt, Date.now()) };
}
