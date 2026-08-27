import assert from "node:assert/strict";
import test from "node:test";

import { generateScenario } from "@evacuva/core";

import { createRouteLoadGenerator } from "./routeLoadGenerator.js";

const BASE_URL = "http://evacuva-request-alb.example.test";

function jsonResponse(status, body) {
  return {
    status,
    async json() {
      return body;
    },
  };
}

function successfulResult(request) {
  const selectedExit = { x: request.start.x + 1, y: request.start.y };
  return {
    status: "success",
    requestId: request.requestId,
    scenarioId: request.scenarioId,
    stateVersion: request.stateVersion,
    path: [request.start, selectedExit],
    selectedExit,
    routeCost: 1,
    pathLength: 1,
    visitedNodeCount: 2,
    queueTimeMs: 1,
    computeTimeMs: 1,
    totalLatencyMs: 2,
    algorithmVersion: "dijkstra-v1",
    validationPassed: true,
  };
}

function advancingClock(stepMs = 10) {
  let currentTime = Date.parse("2026-08-22T12:00:00.000Z");
  return () => {
    currentTime += stepMs;
    return currentTime;
  };
}

test("a 20-request burst records every valid result and the twentieth-request SLA", async () => {
  const state = generateScenario({ timestamp: "2026-08-22T11:59:00.000Z" });
  const submittedRequests = new Map();
  const fetchRequest = async (url, options = {}) => {
    if (url.pathname === "/route-requests") {
      const request = JSON.parse(options.body);
      submittedRequests.set(request.requestId, request);
      return jsonResponse(202, { status: "queued", requestId: request.requestId });
    }

    const requestId = decodeURIComponent(url.pathname.split("/").at(-1));
    const request = submittedRequests.get(requestId);
    return jsonResponse(200, {
      status: "complete",
      requestId,
      result: successfulResult(request),
    });
  };
  const generator = createRouteLoadGenerator({
    baseUrl: BASE_URL,
    fetchRequest,
    now: advancingClock(),
    wait: async () => undefined,
  });

  const experiment = await generator.runBurst({
    state,
    requestCount: 20,
    runId: "twenty-request-test",
  });

  assert.equal(submittedRequests.size, 20);
  assert.equal(new Set(submittedRequests.keys()).size, 20);
  assert.equal(experiment.validRouteCount, 20);
  assert.equal(experiment.failureCount, 0);
  assert.equal(experiment.twentiethRequest.requestId.endsWith("020"), true);
  assert.equal(experiment.twentiethRequestSlaPassed, true);
  assert.equal(experiment.outcomes[0].occupantId, experiment.outcomes[10].occupantId);
});

test("periodic load launches each independent burst after the configured interval", async () => {
  const state = generateScenario({ timestamp: "2026-08-22T11:59:00.000Z" });
  const submittedRequests = new Map();
  const waits = [];
  const fetchRequest = async (url, options = {}) => {
    if (url.pathname === "/route-requests") {
      const request = JSON.parse(options.body);
      submittedRequests.set(request.requestId, request);
      return jsonResponse(202, { status: "queued", requestId: request.requestId });
    }

    const requestId = decodeURIComponent(url.pathname.split("/").at(-1));
    return jsonResponse(200, {
      status: "complete",
      requestId,
      result: successfulResult(submittedRequests.get(requestId)),
    });
  };
  const generator = createRouteLoadGenerator({
    baseUrl: BASE_URL,
    fetchRequest,
    now: advancingClock(),
    wait: async (milliseconds) => waits.push(milliseconds),
  });

  const experiment = await generator.runPeriodic({
    state,
    requestCountPerInterval: 10,
    intervalCount: 3,
    intervalMs: 5_000,
    runId: "periodic-test",
  });

  assert.equal(experiment.totalRequestCount, 30);
  assert.equal(experiment.validRouteCount, 30);
  assert.equal(experiment.failureCount, 0);
  assert.deepEqual(waits, [5_000, 5_000]);
  assert.equal(submittedRequests.size, 30);
  assert.equal(
    [...submittedRequests.keys()].some((requestId) =>
      requestId.includes("interval-003-request-010"),
    ),
    true,
  );
});

test("a result timeout is recorded without hiding the failed request", async () => {
  const state = generateScenario({ timestamp: "2026-08-22T11:59:00.000Z" });
  let resultChecks = 0;
  const generator = createRouteLoadGenerator({
    baseUrl: BASE_URL,
    fetchRequest: async (url, options = {}) => {
      if (url.pathname === "/route-requests") {
        const request = JSON.parse(options.body);
        return jsonResponse(202, { status: "queued", requestId: request.requestId });
      }
      resultChecks += 1;
      return jsonResponse(202, { status: "pending" });
    },
    now: advancingClock(100),
    wait: async () => undefined,
  });

  const experiment = await generator.runBurst({
    state,
    requestCount: 1,
    runId: "timeout-test",
    resultTimeoutMs: 250,
    pollIntervalMs: 10,
  });

  assert.equal(resultChecks > 0, true);
  assert.equal(experiment.validRouteCount, 0);
  assert.equal(experiment.failureCount, 1);
  assert.equal(experiment.outcomes[0].status, "timeout");
  assert.match(experiment.outcomes[0].error, /250 ms/);
});

test("an HTTP rejection is recorded and no result lookup is attempted", async () => {
  const state = generateScenario({ timestamp: "2026-08-22T11:59:00.000Z" });
  let requestCount = 0;
  const generator = createRouteLoadGenerator({
    baseUrl: BASE_URL,
    fetchRequest: async () => {
      requestCount += 1;
      return jsonResponse(400, { error: "Route request is invalid" });
    },
    now: advancingClock(),
  });

  const experiment = await generator.runBurst({
    state,
    requestCount: 1,
    runId: "rejected-test",
  });

  assert.equal(requestCount, 1);
  assert.equal(experiment.failureCount, 1);
  assert.equal(experiment.outcomes[0].status, "request-error");
  assert.match(experiment.outcomes[0].error, /Route request is invalid/);
});
