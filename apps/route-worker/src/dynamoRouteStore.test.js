import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateSafestRoute,
  createScenarioStateVersionRecord,
  generateScenario,
} from "@evacuva/core";

import { createDynamoRouteStore } from "./dynamoRouteStore.js";

const TABLE_NAME = "evacuva-routing-data";
const COMPLETED_AT = "2026-08-22T10:20:34.750Z";

function routeRequest(state) {
  const occupant = state.occupants[0];
  return {
    requestId: "request-store-test",
    occupantId: occupant.occupantId,
    scenarioId: state.scenarioId,
    stateVersion: state.stateVersion,
    start: occupant.start,
    priority: "normal",
    submittedAt: "2026-08-22T10:20:34.000Z",
  };
}

function routeResultEvent(state, request) {
  return {
    messageType: "route-calculation-result",
    eventId: `route-calculation-result-${request.requestId}`,
    completedAt: COMPLETED_AT,
    result: calculateSafestRoute(state, request),
  };
}

test("the route store consistently loads the requested immutable state", async () => {
  const state = generateScenario();
  const commands = [];
  const documentClient = {
    async send(command) {
      commands.push(command);
      return { Item: createScenarioStateVersionRecord(state) };
    },
  };
  const store = createDynamoRouteStore({ documentClient, tableName: TABLE_NAME });

  const loadedState = await store.loadStateVersion(state.scenarioId, state.stateVersion);

  assert.deepEqual(loadedState, state);
  assert.equal(commands[0].constructor.name, "GetCommand");
  assert.deepEqual(commands[0].input.Key, {
    scenarioId: state.scenarioId,
    recordKey: `STATE#${state.stateVersion}`,
  });
  assert.equal(commands[0].input.ConsistentRead, true);
});

test("the route store conditionally writes one result without updating state", async () => {
  const state = generateScenario();
  const request = routeRequest(state);
  const resultEvent = routeResultEvent(state, request);
  const commands = [];
  const store = createDynamoRouteStore({
    documentClient: {
      async send(command) {
        commands.push(command);
        return {};
      },
    },
    tableName: TABLE_NAME,
    now: () => Date.parse("2026-08-22T10:20:34.800Z"),
  });

  const stored = await store.saveRouteResult({ request, resultEvent });

  assert.equal(stored.status, "saved");
  assert.equal(stored.resultRecord.recordKey, "RESULT#request-store-test");
  assert.equal(commands[0].constructor.name, "PutCommand");
  assert.match(commands[0].input.ConditionExpression, /attribute_not_exists/);
  assert.equal(commands[0].input.Item.resultEvent.result.validationPassed, true);
  assert.equal(commands[0].input.Item.recordKey.startsWith("STATE"), false);
});

test("the route store consistently loads a previously committed result", async () => {
  const state = generateScenario();
  const request = routeRequest(state);
  const writer = createDynamoRouteStore({
    documentClient: { send: async () => ({}) },
    tableName: TABLE_NAME,
    now: () => Date.parse("2026-08-22T10:20:34.800Z"),
  });
  const saved = await writer.saveRouteResult({
    request,
    resultEvent: routeResultEvent(state, request),
  });
  const commands = [];
  const reader = createDynamoRouteStore({
    documentClient: {
      async send(command) {
        commands.push(command);
        return { Item: saved.resultRecord };
      },
    },
    tableName: TABLE_NAME,
  });

  const result = await reader.loadRouteResult(state.scenarioId, request.requestId);

  assert.equal(result.recordKey, "RESULT#request-store-test");
  assert.equal(commands[0].input.ConsistentRead, true);
});

test("a simultaneous conditional write is reported as an existing result", async () => {
  const state = generateScenario();
  const request = routeRequest(state);
  const conflict = new Error("Result already exists");
  conflict.name = "ConditionalCheckFailedException";
  const store = createDynamoRouteStore({
    documentClient: { send: async () => Promise.reject(conflict) },
    tableName: TABLE_NAME,
  });

  const outcome = await store.saveRouteResult({
    request,
    resultEvent: routeResultEvent(state, request),
  });

  assert.deepEqual(outcome, { status: "exists" });
});

test("a non-conditional DynamoDB failure remains visible to the worker", async () => {
  const state = generateScenario();
  const request = routeRequest(state);
  const unavailable = new Error("DynamoDB unavailable");
  unavailable.name = "ServiceUnavailable";
  const store = createDynamoRouteStore({
    documentClient: { send: async () => Promise.reject(unavailable) },
    tableName: TABLE_NAME,
  });

  await assert.rejects(
    () =>
      store.saveRouteResult({
        request,
        resultEvent: routeResultEvent(state, request),
      }),
    /DynamoDB unavailable/,
  );
});

test("the route store rejects a missing immutable state version", async () => {
  const store = createDynamoRouteStore({
    documentClient: {
      async send() {
        return {};
      },
    },
    tableName: TABLE_NAME,
  });

  await assert.rejects(
    () => store.loadStateVersion("scenario-missing", 7),
    /No stored state version 7 exists/,
  );
});
