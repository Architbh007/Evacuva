import assert from "node:assert/strict";
import test from "node:test";

import { generateScenario } from "@evacuva/core";

import { createRequestService } from "./requestService.js";

const SCENARIO_ID = "scenario-48291";

function requestForState(state) {
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

async function startTestService(t, { requestQueue, requestStore }) {
  const server = createRequestService({
    requestQueue,
    requestStore,
    scenarioId: SCENARIO_ID,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test("health reports that the HTTP process is available", async (t) => {
  const baseUrl = await startTestService(t, {
    requestQueue: { enqueue: async () => undefined },
    requestStore: {
      loadStateVersion: async () => undefined,
      loadRouteResult: async () => undefined,
    },
  });

  const response = await globalThis.fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "healthy",
    service: "request-service",
  });
});

test("a valid request is checked against immutable state before it is queued", async (t) => {
  const state = generateScenario();
  const routeRequest = requestForState(state);
  const events = [];
  const baseUrl = await startTestService(t, {
    requestQueue: {
      async enqueue(request) {
        events.push("enqueue");
        assert.deepEqual(request, routeRequest);
      },
    },
    requestStore: {
      async loadStateVersion(scenarioId, stateVersion) {
        events.push("load-state");
        assert.equal(scenarioId, state.scenarioId);
        assert.equal(stateVersion, state.stateVersion);
        return state;
      },
      loadRouteResult: async () => undefined,
    },
  });

  const response = await globalThis.fetch(`${baseUrl}/route-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(routeRequest),
  });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    status: "queued",
    requestId: routeRequest.requestId,
    stateVersion: state.stateVersion,
  });
  assert.deepEqual(events, ["load-state", "enqueue"]);
});

test("a request with the wrong occupant start is not queued", async (t) => {
  const state = generateScenario();
  let enqueueCount = 0;
  const baseUrl = await startTestService(t, {
    requestQueue: {
      async enqueue() {
        enqueueCount += 1;
      },
    },
    requestStore: {
      loadStateVersion: async () => state,
      loadRouteResult: async () => undefined,
    },
  });

  const response = await globalThis.fetch(`${baseUrl}/route-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...requestForState(state), start: { x: 1, y: 1 } }),
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /occupant start/);
  assert.equal(enqueueCount, 0);
});

test("result lookup distinguishes pending and completed requests", async (t) => {
  const state = generateScenario();
  const routeRequest = requestForState(state);
  const routeResult = {
    status: "failure",
    reason: "unreachable_exit",
    requestId: routeRequest.requestId,
    scenarioId: routeRequest.scenarioId,
    stateVersion: routeRequest.stateVersion,
    visitedNodeCount: 100,
    queueTimeMs: 10,
    computeTimeMs: 80,
    totalLatencyMs: 100,
    algorithmVersion: "safest-route-v1",
  };
  let lookupCount = 0;
  const baseUrl = await startTestService(t, {
    requestQueue: { enqueue: async () => undefined },
    requestStore: {
      loadStateVersion: async () => state,
      async loadRouteResult() {
        lookupCount += 1;
        return lookupCount === 1 ? undefined : { resultEvent: { result: routeResult } };
      },
    },
  });

  const pendingResponse = await globalThis.fetch(
    `${baseUrl}/route-results/${routeRequest.requestId}`,
  );
  const completeResponse = await globalThis.fetch(
    `${baseUrl}/route-results/${routeRequest.requestId}`,
  );

  assert.equal(pendingResponse.status, 202);
  assert.deepEqual(await pendingResponse.json(), {
    status: "pending",
    requestId: routeRequest.requestId,
  });
  assert.equal(completeResponse.status, 200);
  assert.deepEqual(await completeResponse.json(), {
    status: "complete",
    requestId: routeRequest.requestId,
    result: routeResult,
  });
});
