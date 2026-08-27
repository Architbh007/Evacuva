import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { ScenarioStateVersionRecordSchema } from "@evacuva/contracts";

import { generateScenario } from "../scenario/generateScenario.js";
import {
  createScenarioStateRecord,
  createScenarioStateVersionRecord,
  restoreScenarioState,
  restoreScenarioStateVersion,
} from "./scenarioStateRecord.js";

const DYNAMODB_ITEM_LIMIT_BYTES = 400 * 1024;

test("a scenario state record excludes the large generated floorplan", () => {
  const state = generateScenario();
  const record = createScenarioStateRecord(state);
  const recordSize = Buffer.byteLength(JSON.stringify(record));

  assert.equal(Object.hasOwn(record, "floorplan"), false);
  assert.ok(recordSize < DYNAMODB_ITEM_LIMIT_BYTES);
});

test("a compact state record restores the complete deterministic state", () => {
  const state = generateScenario({
    seed: 9_104,
    timestamp: "2026-08-16T08:00:00.000Z",
  });
  const record = createScenarioStateRecord(state);

  assert.deepEqual(restoreScenarioState(record), state);
});

test("an immutable state-version record uses and restores its exact version", () => {
  const state = generateScenario({
    seed: 6_309,
    timestamp: "2026-08-22T08:00:00.000Z",
  });
  state.stateVersion = 7;
  const record = createScenarioStateVersionRecord(state);

  assert.equal(record.recordKey, "STATE#7");
  assert.deepEqual(restoreScenarioStateVersion(record), state);
  assert.equal(
    ScenarioStateVersionRecordSchema.safeParse({
      ...record,
      recordKey: "STATE#8",
    }).success,
    false,
  );
});

test("a stored reading for another scenario is rejected during restoration", () => {
  const record = createScenarioStateRecord(generateScenario());
  record.latestReadings[0].scenarioId = "scenario-other";

  assert.throws(() => restoreScenarioState(record), /Reading scenario ID must match/);
});
