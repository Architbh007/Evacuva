import assert from "node:assert/strict";
import test from "node:test";

import { generateScenario } from "../scenario/generateScenario.js";
import { applySensorReadingBatch } from "./applySensorReadingBatch.js";

const BATCH_TIME = "2026-08-06T10:15:00.000Z";

function automaticBatch(state) {
  return {
    messageType: "sensor-reading-batch",
    batchId: "automatic-batch-1",
    scenarioId: state.scenarioId,
    batchSource: "automatic-interval",
    collectedAt: BATCH_TIME,
    readings: state.latestReadings.slice(0, 5).map((reading, index) => ({
      messageType: "sensor-reading",
      readingSource: "automatic-simulator",
      reading: {
        ...reading,
        eventId: `${reading.sensorId}-event-2`,
        timestamp: BATCH_TIME,
        sequence: 2,
        value: 20 + index * 10,
      },
    })),
  };
}

test("five automatic readings create one state version and one route result", () => {
  const initialState = generateScenario();
  const update = applySensorReadingBatch(initialState, automaticBatch(initialState));

  assert.equal(update.state.stateVersion, 2);
  assert.equal(update.stateEvent.appliedReadingCount, 5);
  assert.equal(update.resultEvent.result.stateVersion, 2);
  assert.equal(update.resultEvent.result.validationPassed, true);
});

test("a manual reading is applied immediately as one state update", () => {
  const initialState = generateScenario();
  const original = initialState.latestReadings[0];
  const batch = {
    messageType: "sensor-reading-batch",
    batchId: "manual-batch-1",
    scenarioId: initialState.scenarioId,
    batchSource: "manual-override",
    collectedAt: BATCH_TIME,
    readings: [
      {
        messageType: "sensor-reading",
        readingSource: "manual-control",
        reading: {
          ...original,
          eventId: `${original.sensorId}-manual-event-2`,
          timestamp: BATCH_TIME,
          sequence: 2,
          value: 250,
        },
      },
    ],
  };

  const update = applySensorReadingBatch(initialState, batch);

  assert.equal(update.state.stateVersion, 2);
  assert.equal(update.stateEvent.appliedReadingCount, 1);
  assert.equal(update.state.latestReadings[0].value, 250);
});

test("a stale sensor reading cannot replace a newer building-state reading", () => {
  const initialState = generateScenario();
  const batch = automaticBatch(initialState);
  batch.readings[0].reading.sequence = 1;

  assert.throws(
    () => applySensorReadingBatch(initialState, batch),
    /Stale reading rejected/,
  );
});
