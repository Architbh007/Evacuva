import assert from "node:assert/strict";
import test from "node:test";

import { buildSafetyMap } from "../safety/buildSafetyMap.js";
import { generateScenario } from "../scenario/generateScenario.js";
import { calculateSafestRoute } from "./calculateSafestRoute.js";
import { validateRoute } from "./validateRoute.js";

function coordinateKey(coordinate) {
  return `${coordinate.x},${coordinate.y}`;
}

function createRequest(state, requestId = "route-request-1") {
  return {
    requestId,
    occupantId: state.occupants[0].occupantId,
    scenarioId: state.scenarioId,
    stateVersion: state.stateVersion,
    start: state.occupantStart,
    priority: "normal",
    submittedAt: state.updatedAt,
  };
}

function moveSmokeSensor(state, coordinate, value) {
  const sensor = state.sensors.find(
    (candidate) => candidate.sensorId === "smoke-sensor-01",
  );
  const reading = state.latestReadings.find(
    (candidate) => candidate.sensorId === "smoke-sensor-01",
  );

  sensor.coordinate = coordinate;
  reading.coordinate = coordinate;
  reading.value = value;
  reading.sequence = 2;
  reading.eventId = `${state.scenarioId}-smoke-sensor-01-event-2`;
  state.stateVersion += 1;
}

test("returns a successful independently validated route", () => {
  const state = generateScenario();
  const request = createRequest(state);
  const result = calculateSafestRoute(state, request);
  const validation = validateRoute(state, request, result);

  assert.equal(result.status, "success");
  assert.equal(result.validationPassed, true);
  assert.equal(result.queueTimeMs, 0);
  assert.equal(result.pathLength, result.path.length - 1);
  assert.equal(validation.valid, true, validation.errors.join("; "));
});

test("chooses a longer route when it has a lower cost than the smoky shortcut", () => {
  const neutralState = generateScenario();
  const neutralRoute = calculateSafestRoute(
    neutralState,
    createRequest(neutralState, "neutral-route"),
  );
  const smokyState = JSON.parse(JSON.stringify(neutralState));
  moveSmokeSensor(smokyState, { x: 86, y: 74 }, 249);

  const smokyRoute = calculateSafestRoute(
    smokyState,
    createRequest(smokyState, "smoky-route"),
  );
  const { safetyCells } = buildSafetyMap(smokyState);
  const shortcutCost = neutralRoute.path
    .slice(1)
    .reduce(
      (cost, coordinate) =>
        cost + safetyCells.get(coordinateKey(coordinate)).movementCost,
      0,
    );

  assert.equal(smokyRoute.status, "success");
  assert.ok(smokyRoute.pathLength > neutralRoute.pathLength);
  assert.ok(smokyRoute.routeCost < shortcutCost);
  assert.notDeepEqual(smokyRoute.path, neutralRoute.path);
});

test("never includes a hard-blocked cell in a successful path", () => {
  const state = generateScenario();
  moveSmokeSensor(state, { x: 86, y: 74 }, 250);
  const result = calculateSafestRoute(state, createRequest(state));
  const { safetyCells } = buildSafetyMap(state);

  assert.equal(result.status, "success");
  for (const coordinate of result.path) {
    assert.equal(safetyCells.get(coordinateKey(coordinate)).blocked, false);
  }
});

test("returns invalid_start for a wall coordinate", () => {
  const state = generateScenario({ seed: 53 });
  const wall = state.floorplan.cells.find((cell) => cell.type === "wall").coordinate;
  const request = { ...createRequest(state), start: wall };

  assert.equal(calculateSafestRoute(state, request).reason, "invalid_start");
});

test("returns blocked_start when critical smoke covers the occupant", () => {
  const state = generateScenario();
  moveSmokeSensor(state, state.occupantStart, 250);

  assert.equal(calculateSafestRoute(state, createRequest(state)).reason, "blocked_start");
});

test("returns all_exits_blocked when every door is unavailable", () => {
  const state = generateScenario({ seed: 681 });
  for (const reading of state.latestReadings) {
    if (reading.type === "door") {
      reading.value.open = false;
    }
  }

  assert.equal(
    calculateSafestRoute(state, createRequest(state)).reason,
    "all_exits_blocked",
  );
});

test("returns unreachable_exit when walls disconnect every exit", () => {
  const state = generateScenario();

  for (const exit of state.floorplan.exits) {
    const insideCoordinate =
      exit.x === 0
        ? { x: 1, y: exit.y }
        : exit.x === 99
          ? { x: 98, y: exit.y }
          : exit.y === 0
            ? { x: exit.x, y: 1 }
            : { x: exit.x, y: 98 };
    const insideCell = state.floorplan.cells.find(
      (cell) => coordinateKey(cell.coordinate) === coordinateKey(insideCoordinate),
    );
    insideCell.type = "wall";
  }

  assert.equal(
    calculateSafestRoute(state, createRequest(state)).reason,
    "unreachable_exit",
  );
});

test("validator rejects disconnected paths, incorrect costs, and stale versions", () => {
  const state = generateScenario({ seed: 27 });
  const request = createRequest(state);
  const route = calculateSafestRoute(state, request);

  const disconnectedRoute = JSON.parse(JSON.stringify(route));
  disconnectedRoute.path[1] = disconnectedRoute.path[3];
  assert.equal(validateRoute(state, request, disconnectedRoute).valid, false);

  const incorrectCostRoute = { ...route, routeCost: route.routeCost + 1 };
  assert.equal(validateRoute(state, request, incorrectCostRoute).valid, false);

  const staleRoute = { ...route, stateVersion: route.stateVersion + 1 };
  assert.equal(validateRoute(state, request, staleRoute).valid, false);
});

test("returns independently valid routes for 20 generated scenarios", () => {
  for (let seed = 0; seed < 20; seed += 1) {
    const state = generateScenario({ seed });
    const request = createRequest(state, `generated-route-${seed}`);
    const route = calculateSafestRoute(state, request);

    assert.equal(route.status, "success", `Route seed ${seed} should succeed`);
    assert.equal(
      validateRoute(state, request, route).valid,
      true,
      `Route seed ${seed} should pass validation`,
    );
  }
});
