import assert from "node:assert/strict";
import test from "node:test";

import { generateScenario } from "@evacuva/core";

import {
  createDirectionalGuidanceEvent,
  createFloorplanLayoutEvent,
} from "./dashboardEvents.js";

const timestamp = "2026-08-27T10:15:00.000Z";

function routeResultEvent(resultOverrides) {
  return {
    messageType: "route-calculation-result",
    eventId: "route-calculation-result-2",
    completedAt: timestamp,
    result: {
      requestId: "route-request-2",
      scenarioId: "scenario-48291",
      stateVersion: 2,
      visitedNodeCount: 12,
      queueTimeMs: 2,
      computeTimeMs: 8,
      totalLatencyMs: 10,
      algorithmVersion: "safest-route-v1",
      ...resultOverrides,
    },
  };
}

test("the layout event keeps the complete floorplan compact", () => {
  const state = generateScenario({ timestamp });
  const event = createFloorplanLayoutEvent(state);

  assert.equal(event.rows.length, 100);
  assert.ok(event.rows.every((row) => row.length === 100));
  assert.equal(event.occupants.length, 10);
  assert.equal(event.sensors.length, 42);
  assert.equal(event.latestReadings.length, 42);
  assert.ok(event.rows.some((row) => row.includes("E")));
});

test("a successful route produces the first direction for occupant one", () => {
  const event = createDirectionalGuidanceEvent(
    routeResultEvent({
      status: "success",
      path: [
        { x: 20, y: 30 },
        { x: 21, y: 30 },
      ],
      selectedExit: { x: 21, y: 30 },
      routeCost: 1,
      pathLength: 1,
      validationPassed: true,
    }),
    "occupant-01",
  );

  assert.equal(event.status, "success");
  assert.equal(event.direction, "east");
  assert.deepEqual(event.nextCoordinate, { x: 21, y: 30 });
});

test("a failed route tells the directional sign why guidance is unavailable", () => {
  const event = createDirectionalGuidanceEvent(
    routeResultEvent({
      status: "failure",
      reason: "all_exits_blocked",
    }),
    "occupant-01",
  );

  assert.equal(event.status, "unavailable");
  assert.equal(event.reason, "all_exits_blocked");
});
