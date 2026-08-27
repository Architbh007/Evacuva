import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceBuildingState,
  createScenarioStateRecord,
  generateScenario,
} from "@evacuva/core";

import { createDynamoStateStore } from "./dynamoStateStore.js";

const TABLE_NAME = "evacuva-routing-data";
const BATCH_TIME = "2026-08-22T11:30:00.000Z";

function automaticBatch(state) {
  return {
    messageType: "sensor-reading-batch",
    batchId: "automatic-batch-coordinator-store-test",
    scenarioId: state.scenarioId,
    batchSource: "automatic-interval",
    collectedAt: BATCH_TIME,
    readings: state.latestReadings.slice(0, 5).map((reading, index) => ({
      messageType: "sensor-reading",
      readingSource: "automatic-simulator",
      reading: {
        ...reading,
        eventId: `${reading.sensorId}-coordinator-store-event-2`,
        timestamp: BATCH_TIME,
        sequence: 2,
        value: 20 + index * 10,
      },
    })),
  };
}

test("the state store loads current state and an applied-batch marker consistently", async () => {
  const state = generateScenario();
  const marker = {
    scenarioId: state.scenarioId,
    recordKey: "BATCH#automatic-batch-1",
    batchId: "automatic-batch-1",
    stateVersion: 2,
    appliedAt: BATCH_TIME,
  };
  const commands = [];
  const store = createDynamoStateStore({
    documentClient: {
      async send(command) {
        commands.push(command);
        return commands.length === 1
          ? { Item: createScenarioStateRecord(state) }
          : { Item: marker };
      },
    },
    tableName: TABLE_NAME,
  });

  assert.deepEqual(await store.loadScenarioState(state.scenarioId), state);
  assert.deepEqual(
    await store.loadAppliedBatch(state.scenarioId, marker.batchId),
    marker,
  );
  assert.equal(
    commands.every((command) => command.input.ConsistentRead),
    true,
  );
});

test("the state store atomically writes current, versioned, and batch records", async () => {
  const state = generateScenario();
  const batch = automaticBatch(state);
  const update = advanceBuildingState(state, batch);
  const commands = [];
  const store = createDynamoStateStore({
    documentClient: {
      async send(command) {
        commands.push(command);
        return {};
      },
    },
    tableName: TABLE_NAME,
    now: () => Date.parse("2026-08-22T11:30:01.000Z"),
  });

  const stored = await store.saveStateUpdate({
    batch,
    previousStateVersion: state.stateVersion,
    update,
  });

  const transaction = commands[0].input.TransactItems;
  assert.equal(transaction.length, 3);
  assert.equal(transaction[0].Put.Item.recordKey, "STATE");
  assert.equal(transaction[1].Put.Item.recordKey, "STATE#2");
  assert.equal(transaction[2].Put.Item.recordKey, `BATCH#${batch.batchId}`);
  assert.equal(stored.status, "saved");
  assert.equal(stored.appliedBatchRecord.stateVersion, 2);
});

test("a conditional cancellation is returned as a retryable state conflict", async () => {
  const state = generateScenario();
  const batch = automaticBatch(state);
  const conflict = new Error("Transaction cancelled");
  conflict.name = "TransactionCanceledException";
  conflict.CancellationReasons = [{ Code: "ConditionalCheckFailed" }];
  const store = createDynamoStateStore({
    documentClient: {
      async send() {
        throw conflict;
      },
    },
    tableName: TABLE_NAME,
  });

  assert.deepEqual(
    await store.saveStateUpdate({
      batch,
      previousStateVersion: state.stateVersion,
      update: advanceBuildingState(state, batch),
    }),
    { status: "conflict" },
  );
});

test("a DynamoDB service failure remains visible to the coordinator", async () => {
  const state = generateScenario();
  const batch = automaticBatch(state);
  const store = createDynamoStateStore({
    documentClient: {
      async send() {
        throw new Error("DynamoDB unavailable");
      },
    },
    tableName: TABLE_NAME,
  });

  await assert.rejects(
    () =>
      store.saveStateUpdate({
        batch,
        previousStateVersion: state.stateVersion,
        update: advanceBuildingState(state, batch),
      }),
    /DynamoDB unavailable/,
  );
});
