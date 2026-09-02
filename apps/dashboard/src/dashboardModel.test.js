import assert from "node:assert/strict";
import test from "node:test";

import {
  directionSymbol,
  formatSensorValue,
  manualReadingValue,
  normaliseSnapshot,
  sensorCondition,
} from "./dashboardModel.js";

function reading(overrides = {}) {
  return {
    sensorId: "smoke-sensor-01",
    type: "smoke",
    value: 0,
    healthy: true,
    sequence: 1,
    timestamp: "2026-09-02T10:15:00.000Z",
    ...overrides,
  };
}

test("a dashboard snapshot requires the complete 100 by 100 map", () => {
  const snapshot = normaliseSnapshot({
    scenarioId: "scenario-48291",
    stateVersion: 2,
    updatedAt: "2026-09-02T10:15:00.000Z",
    layout: {
      width: 100,
      height: 100,
      rows: Array.from({ length: 100 }, () => ".".repeat(100)),
    },
    occupants: [],
    sensors: [],
    readings: [reading({ sensorId: "smoke-sensor-02" }), reading()],
  });

  assert.deepEqual(
    snapshot.readings.map((item) => item.sensorId),
    ["smoke-sensor-01", "smoke-sensor-02"],
  );
  assert.throws(
    () => normaliseSnapshot({ ...snapshot, layout: { rows: ["."] } }),
    /100 by 100 layout/,
  );
});

test("sensor conditions use the route safety thresholds", () => {
  assert.equal(sensorCondition(reading({ value: 250 })).label, "Critical");
  assert.equal(
    sensorCondition(reading({ type: "temperature", value: 40 })).label,
    "Elevated",
  );
  assert.equal(sensorCondition(reading({ healthy: false })).label, "Unhealthy");
  assert.equal(
    sensorCondition(reading({ type: "door", value: { open: false, obstructed: false } }))
      .label,
    "Blocked",
  );
});

test("sensor values and direction symbols stay easy to read", () => {
  assert.equal(formatSensorValue(reading({ type: "temperature", value: 38 })), "38.0 °C");
  assert.equal(
    formatSensorValue(reading({ type: "door", value: { open: true, obstructed: true } })),
    "Obstructed",
  );
  assert.equal(directionSymbol("west"), "←");
});

test("manual control values match each sensor type", () => {
  assert.equal(manualReadingValue("smoke", "130"), 130);
  assert.equal(manualReadingValue("occupancy", "0.8"), 0.8);
  assert.deepEqual(manualReadingValue("door", "obstructed"), {
    open: false,
    obstructed: true,
  });
  assert.throws(() => manualReadingValue("door", "unknown"), /valid door state/);
});
