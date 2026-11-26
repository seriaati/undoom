import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { type EngineEvent, type Limits, replay, type Status, status } from "../src/index.ts";

interface Vector {
  description: string;
  limits: Limits;
  events: EngineEvent[];
  expect: (Status & { at: number })[];
}

const dir = join(import.meta.dirname, "../../../spec/vectors");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

test.each(files)("%s", (file) => {
  const vector: Vector = JSON.parse(readFileSync(join(dir, file), "utf8"));
  const state = replay(vector.limits, vector.events);
  for (const { at, ...expected } of vector.expect) {
    expect(status(state, vector.limits, at), `at ${at}`).toEqual(expected);
  }
});
