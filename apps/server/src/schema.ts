import { z } from "zod";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const id = z.string().min(1).max(128);
const domain = z
  .string()
  .max(253)
  .regex(/^(?=.*[a-z])[a-z0-9-]+(\.[a-z0-9-]+)+$/, "lowercase hostname");
const androidPackage = z.string().max(255).regex(/^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/);

export const entrySchema = z.object({
  id: z.string().startsWith("custom:").max(128),
  name: z.string().min(1).max(100),
  domains: z.array(domain).max(50),
  packages: z.array(androidPackage).max(50),
});

export const targetEditSchema = z.object({
  id,
  name: z.string().min(1).max(100).nullable(),
  entryIds: z.array(id).min(1).max(100),
  sessionMs: z.number().int().min(MINUTE).max(DAY),
  restMs: z.number().int().min(MINUTE).max(7 * DAY),
  excludeDomains: z.array(domain).max(50).optional(),
});

export const configEditSchema = z.object({
  targets: z.array(targetEditSchema).max(200),
  customEntries: z.array(entrySchema).max(200),
});

const usageEvent = z.object({
  kind: z.literal("usage"),
  eventId: id,
  targetId: id,
  startAt: z.number().int().nonnegative(),
  durationMs: z.number().int().min(1).max(60 * MINUTE),
});

const unlockEvent = z.object({
  kind: z.literal("unlock"),
  eventId: id,
  targetId: id,
  at: z.number().int().nonnegative(),
});

export const eventSchema = z.discriminatedUnion("kind", [usageEvent, unlockEvent]);
export const eventsBodySchema = z.object({ events: z.array(eventSchema).max(1000) });

export type SyncEvent = z.infer<typeof eventSchema>;

export const ceremonyBodySchema = z.object({
  flowId: z.uuid(),
  // Validated by @simplewebauthn/server.
  response: z.any(),
});

export const registerOptionsBodySchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
});
