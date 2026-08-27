import assert from "node:assert/strict";
import test from "node:test";

import { generateScenario } from "@evacuva/core";

import { createSensorNode } from "./sensorNode.js";

function sensorParts(state, sensorId) {
  return {
    definition: state.sensors.find((sensor) => sensor.sensorId === sensorId),
    reading: state.latestReadings.find((item) => item.sensorId === sensorId),
  };
}

test("sensor node owns its reading sequence and emits a valid automatic event", () => {
  const state = generateScenario();
  const { definition, reading } = sensorParts(state, "smoke-sensor-01");
  const sensorNode = createSensorNode(definition, reading);
  const event = sensorNode.emitAutomaticReading(60, "2026-08-06T10:00:05.000Z");

  assert.equal(sensorNode.sensorId, "smoke-sensor-01");
  assert.equal(sensorNode.sensorType, "smoke");
  assert.equal(sensorNode.sequence, 2);
  assert.equal(event.messageType, "sensor-reading");
  assert.equal(event.readingSource, "automatic-simulator");
  assert.equal(event.reading.value, 60);
  assert.deepEqual(event.reading.coordinate, definition.coordinate);
});

test("manual mode suppresses automatic events until the sensor resumes", () => {
  const state = generateScenario();
  const { definition, reading } = sensorParts(state, "smoke-sensor-01");
  const sensorNode = createSensorNode(definition, reading);

  const manualEvent = sensorNode.emitManualReading(250, "2026-08-06T10:00:01.000Z");
  const suppressedEvent = sensorNode.emitAutomaticReading(
    150,
    "2026-08-06T10:00:05.000Z",
  );

  assert.equal(sensorNode.mode, "manual");
  assert.equal(sensorNode.sequence, 2);
  assert.equal(manualEvent.readingSource, "manual-control");
  assert.equal(manualEvent.reading.value, 250);
  assert.equal(suppressedEvent, null);

  sensorNode.resumeAutomatic();
  const resumedEvent = sensorNode.emitCurrentAutomaticReading("2026-08-06T10:00:10.000Z");

  assert.equal(sensorNode.mode, "automatic");
  assert.equal(sensorNode.sequence, 3);
  assert.equal(resumedEvent.readingSource, "automatic-simulator");
  assert.equal(resumedEvent.reading.value, 150);
});

test("sensor node rejects mismatched initial data and invalid values", () => {
  const state = generateScenario();
  const smoke = sensorParts(state, "smoke-sensor-01");
  const temperature = sensorParts(state, "temperature-sensor-01");

  assert.throws(
    () => createSensorNode(smoke.definition, temperature.reading),
    /must match its sensor definition/,
  );

  const sensorNode = createSensorNode(smoke.definition, smoke.reading);
  assert.throws(() => sensorNode.validateReadingValue(-1));
  assert.throws(() => sensorNode.resumeAutomatic(), /already in automatic mode/);
});
