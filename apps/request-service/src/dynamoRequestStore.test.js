import assert from "node:assert/strict";
import test from "node:test";

import { createScenarioStateVersionRecord, generateScenario } from "@evacuva/core";

import { createDynamoRequestStore } from "./dynamoRequestStore.js";

const TABLE_NAME = "evacuva-routing-data";

function routeRequest(state) {
  return {
    requestId: "route-request-state-1-occupant-01",
    occupantId: state.occupants[0].occupantId,
    scenarioId: state.scenarioId,
    stateVersion: state.stateVersion,
    start: state.occupants[0].start,
    priority: "normal",
    submittedAt: "2026-08-22T10:15:00.000Z",
  };
}

function routeResultRecord(state) {
  const request = routeRequest(state);
  return {
    scenarioId: state.scenarioId,
    recordKey: `RESULT#${request.requestId}`,
    request,
    resultEvent: {
      messageType: "route-calculation-result",
      eventId: `route-calculation-result-${request.requestId}`,
      completedAt: "2026-08-22T10:15:00.100Z",
      result: {
        status: "failure",
        reason: "unreachable_exit",
        requestId: request.requestId,
        scenarioId: request.scenarioId,
        stateVersion: request.stateVersion,
        visitedNodeCount: 100,
        queueTimeMs: 10,
        computeTimeMs: 80,
        totalLatencyMs: 100,
        algorithmVersion: "safest-route-v1",
      },
    },
    storedAt: "2026-08-22T10:15:00.101Z",
  };
}

test("the request store loads the exact immutable state version", async () => {
  const state = generateScenario();
  const commands = [];
  const store = createDynamoRequestStore({
    documentClient: {
      async send(command) {
        commands.push(command);
        return { Item: createScenarioStateVersionRecord(state) };
      },
    },
    tableName: TABLE_NAME,
  });

  const loadedState = await store.loadStateVersion(state.scenarioId, state.stateVersion);

  assert.deepEqual(loadedState, state);
  assert.deepEqual(commands[0].input.Key, {
    scenarioId: state.scenarioId,
    recordKey: `STATE#${state.stateVersion}`,
  });
  assert.equal(commands[0].input.ConsistentRead, true);
});

test("the request store returns undefined when a result is still pending", async () => {
  const store = createDynamoRequestStore({
    documentClient: {
      async send() {
        return {};
      },
    },
    tableName: TABLE_NAME,
  });

  assert.equal(
    await store.loadRouteResult("scenario-48291", "route-request-pending"),
    undefined,
  );
});

test("the request store validates a completed per-request result", async () => {
  const state = generateScenario();
  const expectedRecord = routeResultRecord(state);
  const store = createDynamoRequestStore({
    documentClient: {
      async send() {
        return { Item: expectedRecord };
      },
    },
    tableName: TABLE_NAME,
  });

  const record = await store.loadRouteResult(
    state.scenarioId,
    expectedRecord.request.requestId,
  );

  assert.deepEqual(record, expectedRecord);
});
