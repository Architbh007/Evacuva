import assert from "node:assert/strict";
import test from "node:test";

import { generateScenario } from "../scenario/generateScenario.js";
import { advanceBuildingState } from "./advanceBuildingState.js";

const BATCH_TIME = "2026-08-22T11:00:00.000Z";

function automaticBatch(state) {
  return {
    messageType: "sensor-reading-batch",
    batchId: "automatic-batch-state-test",
    scenarioId: state.scenarioId,
    batchSource: "automatic-interval",
    collectedAt: BATCH_TIME,
    readings: state.latestReadings.slice(0, 5).map((reading, index) => ({
      messageType: "sensor-reading",
      readingSource: "automatic-simulator",
      reading: {
        ...reading,
        eventId: `${reading.sensorId}-state-event-2`,
        timestamp: BATCH_TIME,
        sequence: 2,
        value: 15 + index * 10,
      },
    })),
  };
}

test("one accepted batch advances state without calculating a route", () => {
  const initialState = generateScenario();
  const update = advanceBuildingState(initialState, automaticBatch(initialState));

  assert.equal(update.state.stateVersion, 2);
  assert.equal(update.stateEvent.previousStateVersion, 1);
  assert.equal(update.stateEvent.appliedReadingCount, 5);
  assert.deepEqual(update.state.occupants, initialState.occupants);
  assert.equal(Object.hasOwn(update, "resultEvent"), false);
});

test("a state update rejects a batch from another scenario", () => {
  const initialState = generateScenario();
  const batch = automaticBatch(initialState);
  batch.scenarioId = "scenario-other";
  batch.readings = batch.readings.map((event) => ({
    ...event,
    reading: { ...event.reading, scenarioId: "scenario-other" },
  }));

  assert.throws(
    () => advanceBuildingState(initialState, batch),
    /scenario does not match/,
  );
});
