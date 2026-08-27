import assert from "node:assert/strict";
import test from "node:test";

import { CurrentBuildingStateSchema } from "@evacuva/contracts";

import { generateFloorplan } from "../floorplan/generateFloorplan.js";
import { generateScenario } from "./generateScenario.js";

function coordinateKey(coordinate) {
  return `${coordinate.x},${coordinate.y}`;
}

test("generates the agreed initial building state", () => {
  const state = generateScenario();
  const sensorCounts = Object.groupBy(state.sensors, (sensor) => sensor.type);

  assert.equal(state.scenarioId, "scenario-48291");
  assert.equal(state.stateVersion, 1);
  assert.equal(state.floorplan.cells.length, 10_000);
  assert.equal(sensorCounts.smoke.length, 12);
  assert.equal(sensorCounts.temperature.length, 12);
  assert.equal(sensorCounts.occupancy.length, 12);
  assert.equal(sensorCounts.door.length, 6);
  assert.equal(state.occupants.length, 10);
  assert.equal(state.occupants[0].occupantId, "occupant-01");
  assert.deepEqual(state.occupantStart, state.occupants[0].start);
  assert.equal(state.latestReadings.length, 42);
  assert.equal(CurrentBuildingStateSchema.safeParse(state).success, true);
});

test("places ten occupants on distinct walkable coordinates", () => {
  const state = generateScenario({ seed: 4_517 });
  const cellsByCoordinate = new Map(
    state.floorplan.cells.map((cell) => [coordinateKey(cell.coordinate), cell]),
  );
  const occupantIds = new Set();
  const occupantCoordinates = new Set();

  for (const occupant of state.occupants) {
    occupantIds.add(occupant.occupantId);
    occupantCoordinates.add(coordinateKey(occupant.start));
    assert.equal(cellsByCoordinate.get(coordinateKey(occupant.start)).type, "floor");
    assert.equal(occupant.scenarioId, state.scenarioId);
    assert.equal(occupant.startSource, "generated");
  }

  assert.equal(occupantIds.size, 10);
  assert.equal(occupantCoordinates.size, 10);
});

test("places environmental and door sensors on their allowed cells", () => {
  const state = generateScenario({ seed: 1_203 });
  const cellsByCoordinate = new Map(
    state.floorplan.cells.map((cell) => [coordinateKey(cell.coordinate), cell]),
  );
  const sensorCoordinates = new Set();

  for (const sensor of state.sensors) {
    const cell = cellsByCoordinate.get(coordinateKey(sensor.coordinate));
    const requiredCellType = sensor.type === "door" ? "exit" : "floor";

    assert.equal(cell.type, requiredCellType);
    sensorCoordinates.add(coordinateKey(sensor.coordinate));
  }

  assert.equal(sensorCoordinates.size, 42);
});

test("creates healthy neutral readings for every sensor", () => {
  const state = generateScenario({ seed: 25 });
  const expectedValues = {
    smoke: 0,
    temperature: 22,
    occupancy: 0.1,
    door: { open: true, obstructed: false },
  };

  for (const reading of state.latestReadings) {
    assert.equal(reading.healthy, true);
    assert.equal(reading.sequence, 1);
    assert.deepEqual(reading.value, expectedValues[reading.type]);
  }
});

test("reproduces the complete scenario when the seed and timestamp are unchanged", () => {
  const options = { seed: 8_822, timestamp: "2026-08-05T10:15:00.000Z" };

  assert.deepEqual(generateScenario(options), generateScenario(options));
});

test("accepts an explicit floor start without changing sensor placement", () => {
  const seed = 76;
  const defaultState = generateScenario({ seed });
  const selectedCell = defaultState.floorplan.cells.find(
    (cell) =>
      cell.type === "floor" &&
      coordinateKey(cell.coordinate) !== coordinateKey(defaultState.occupantStart),
  );
  const explicitState = generateScenario({
    seed,
    occupantStart: selectedCell.coordinate,
  });

  assert.deepEqual(explicitState.occupantStart, selectedCell.coordinate);
  assert.deepEqual(explicitState.occupants[0].start, selectedCell.coordinate);
  assert.equal(explicitState.occupants[0].startSource, "explicit");
  assert.deepEqual(explicitState.sensors, defaultState.sensors);
});

test("accepts ten explicit distinct occupant starts", () => {
  const seed = 4_308;
  const defaultState = generateScenario({ seed });
  const occupantStarts = defaultState.floorplan.cells
    .filter((cell) => cell.type === "floor")
    .slice(0, 10)
    .map((cell) => cell.coordinate);
  const explicitState = generateScenario({ seed, occupantStarts });

  assert.deepEqual(
    explicitState.occupants.map((occupant) => occupant.start),
    occupantStarts,
  );
  assert.equal(
    explicitState.occupants.every((occupant) => occupant.startSource === "explicit"),
    true,
  );
});

test("rejects an incomplete or duplicate occupant-start list", () => {
  const state = generateScenario({ seed: 7_705 });
  const floorStarts = state.floorplan.cells
    .filter((cell) => cell.type === "floor")
    .slice(0, 10)
    .map((cell) => cell.coordinate);

  assert.throws(
    () => generateScenario({ seed: 7_705, occupantStarts: floorStarts.slice(0, 9) }),
    /exactly 10 coordinates/,
  );
  assert.throws(
    () =>
      generateScenario({
        seed: 7_705,
        occupantStarts: [...floorStarts.slice(0, 9), floorStarts[0]],
      }),
    /distinct coordinates/,
  );
});

test("rejects an explicit start on a wall or exit", () => {
  const seed = 91;
  const floorplan = generateFloorplan({ seed });
  const wall = floorplan.cells.find((cell) => cell.type === "wall").coordinate;

  for (const invalidStart of [wall, floorplan.exits[0]]) {
    assert.throws(
      () => generateScenario({ seed, occupantStart: invalidStart }),
      /walkable, non-exit floor cell/,
    );
  }
});

test("rejects a latest reading that does not belong to its scenario", () => {
  const state = JSON.parse(JSON.stringify(generateScenario({ seed: 802 })));
  state.latestReadings[0].scenarioId = "another-scenario";

  assert.equal(CurrentBuildingStateSchema.safeParse(state).success, false);
});

test("keeps sensor and occupant placement valid across 100 seeds", () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const state = generateScenario({ seed });
    const result = CurrentBuildingStateSchema.safeParse(state);

    assert.equal(result.success, true, `Scenario seed ${seed} should be valid`);
  }
});
