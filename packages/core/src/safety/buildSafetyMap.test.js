import assert from "node:assert/strict";
import test from "node:test";

import { generateScenario } from "../scenario/generateScenario.js";
import { buildSafetyMap } from "./buildSafetyMap.js";

function coordinateKey(coordinate) {
  return `${coordinate.x},${coordinate.y}`;
}

function readingFor(state, sensorId) {
  return state.latestReadings.find((reading) => reading.sensorId === sensorId);
}

test("calculates the approved environmental risk at each sensor", () => {
  const state = generateScenario({ seed: 340 });
  const smokeReading = readingFor(state, "smoke-sensor-01");
  const temperatureReading = readingFor(state, "temperature-sensor-01");
  const occupancyReading = readingFor(state, "occupancy-sensor-01");
  smokeReading.value = 125;
  temperatureReading.value = 57.5;
  for (const reading of state.latestReadings) {
    if (reading.type === "occupancy") {
      reading.value = 0;
    }
  }
  occupancyReading.value = 0.5;

  const { safetyCells } = buildSafetyMap(state);
  const smokeCell = safetyCells.get(coordinateKey(smokeReading.coordinate));
  const temperatureCell = safetyCells.get(coordinateKey(temperatureReading.coordinate));
  const occupancyCell = safetyCells.get(coordinateKey(occupancyReading.coordinate));

  assert.equal(smokeCell.smokeRisk, 6);
  assert.equal(temperatureCell.temperatureRisk, 5);
  assert.equal(occupancyCell.congestionRisk, 4);
});

test("critical smoke and heat block cells but unhealthy readings have no effect", () => {
  const criticalReadings = [
    { sensorId: "smoke-sensor-01", value: 250, riskName: "smokeRisk" },
    {
      sensorId: "temperature-sensor-01",
      value: 80,
      riskName: "temperatureRisk",
    },
  ];

  for (const criticalReading of criticalReadings) {
    const state = generateScenario({ seed: 778 });
    const reading = readingFor(state, criticalReading.sensorId);
    reading.value = criticalReading.value;

    const criticalMap = buildSafetyMap(state).safetyCells;
    assert.equal(criticalMap.get(coordinateKey(reading.coordinate)).blocked, true);

    reading.healthy = false;
    const unhealthyMap = buildSafetyMap(state).safetyCells;
    const sensorCell = unhealthyMap.get(coordinateKey(reading.coordinate));
    assert.equal(sensorCell.blocked, false);
    assert.equal(sensorCell[criticalReading.riskName], 0);
  }
});

test("a closed healthy door blocks its exit while an unhealthy door does not", () => {
  const state = generateScenario({ seed: 460 });
  const doorReading = readingFor(state, "exit-door-sensor-01");
  doorReading.value.open = false;

  const closedDoorMap = buildSafetyMap(state);
  assert.equal(
    closedDoorMap.safetyCells.get(coordinateKey(doorReading.coordinate)).blocked,
    true,
  );
  assert.equal(closedDoorMap.safeExits.length, 5);

  doorReading.healthy = false;
  const unhealthyDoorMap = buildSafetyMap(state);
  assert.equal(
    unhealthyDoorMap.safetyCells.get(coordinateKey(doorReading.coordinate)).blocked,
    false,
  );
  assert.equal(unhealthyDoorMap.safeExits.length, 6);
});
