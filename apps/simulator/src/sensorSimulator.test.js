import assert from "node:assert/strict";
import test from "node:test";

import { SENSOR_UPDATE_INTERVAL_MS, SensorReadingEventSchema } from "@evacuva/contracts";
import { generateScenario } from "@evacuva/core";

import { createSensorSimulator } from "./sensorSimulator.js";

function validBatch() {
  return [
    { sensorId: "smoke-sensor-01", readingValue: 60 },
    { sensorId: "smoke-sensor-02", readingValue: 45 },
    { sensorId: "smoke-sensor-03", readingValue: 30 },
    { sensorId: "temperature-sensor-01", readingValue: 32 },
    { sensorId: "occupancy-sensor-01", readingValue: 0.35 },
  ];
}

test("creates 42 logical sensor nodes with independent sequences", () => {
  const simulator = createSensorSimulator(generateScenario());
  const smokeNode = simulator.getSensorNode("smoke-sensor-01");
  const unchangedNode = simulator.getSensorNode("smoke-sensor-04");

  assert.equal(simulator.sensorCount, 42);
  assert.equal(simulator.batchCount, 12);
  assert.equal(simulator.changesPerInterval, 5);
  assert.equal(smokeNode.sequence, 1);
  assert.equal(unchangedNode.sequence, 1);

  const events = simulator.advance("2026-08-06T10:00:05.000Z");

  assert.equal(events.length, 5);
  assert.equal(new Set(events.map((event) => event.reading.sensorId)).size, 5);
  assert.equal(smokeNode.sequence, 2);
  assert.equal(unchangedNode.sequence, 1);
});

test("changes five sensors per batch and covers all 42 sensors in one cycle", () => {
  const simulator = createSensorSimulator(generateScenario());
  const eventBatches = Array.from({ length: 12 }, (_, index) =>
    simulator.advance(`2026-08-06T10:${String(index).padStart(2, "0")}:00.000Z`),
  );
  const events = eventBatches.flat();

  assert.equal(events.length, 60);
  assert.equal(new Set(events.map((event) => event.reading.sensorId)).size, 42);
  for (const batch of eventBatches) {
    assert.equal(batch.length, 5);
    assert.equal(new Set(batch.map((event) => event.reading.sensorId)).size, 5);
  }

  assert.equal(eventBatches[0][0].reading.sensorId, "smoke-sensor-01");
  assert.equal(eventBatches[0][0].reading.value, 60);
  assert.equal(eventBatches[8][2].reading.value, 255);
  assert.equal(eventBatches[8][3].reading.value, 85);
  assert.deepEqual(eventBatches[9][4].reading.value, {
    open: false,
    obstructed: true,
  });
  assert.equal(eventBatches[11][0].reading.value, 0);

  for (const event of events) {
    assert.equal(event.readingSource, "automatic-simulator");
    assert.equal(SensorReadingEventSchema.safeParse(event).success, true);
  }
});

test("repeats the batches while continuing each sensor sequence", () => {
  const simulator = createSensorSimulator(generateScenario());

  for (let index = 0; index < 12; index += 1) {
    simulator.advance("2026-08-06T10:00:00.000Z");
  }
  const repeatedFirstBatch = simulator.advance("2026-08-06T10:01:00.000Z");

  assert.equal(repeatedFirstBatch.length, 5);
  assert.equal(repeatedFirstBatch[0].reading.sensorId, "smoke-sensor-01");
  assert.equal(repeatedFirstBatch[0].reading.value, 60);
  assert.equal(repeatedFirstBatch[0].reading.sequence, 6);
});

test("manual override is immediate while other sensors continue automatically", () => {
  const state = generateScenario();
  const simulator = createSensorSimulator(state);
  const smokeNode = simulator.getSensorNode("smoke-sensor-01");
  const temperatureNode = simulator.getSensorNode("temperature-sensor-01");
  const manualEvent = simulator.applyManualOverride({
    messageType: "manual-sensor-override",
    commandId: "manual-command-01",
    scenarioId: state.scenarioId,
    sensorId: "smoke-sensor-01",
    sensorType: "smoke",
    requestedAt: "2026-08-06T10:00:01.000Z",
    readingValue: 250,
  });

  const nextAutomaticEvents = simulator.advance("2026-08-06T10:00:05.000Z");

  assert.equal(manualEvent.readingSource, "manual-control");
  assert.equal(manualEvent.reading.value, 250);
  assert.equal(smokeNode.mode, "manual");
  assert.equal(smokeNode.sequence, 2);
  assert.equal(nextAutomaticEvents.length, 4);
  assert.equal(
    nextAutomaticEvents.some((event) => event.reading.sensorId === "smoke-sensor-01"),
    false,
  );
  assert.equal(temperatureNode.sequence, 2);

  simulator.resumeAutomatic({
    messageType: "resume-automatic-sensor",
    commandId: "resume-command-01",
    scenarioId: state.scenarioId,
    sensorId: "smoke-sensor-01",
    requestedAt: "2026-08-06T10:00:06.000Z",
  });
  const resumedEvents = simulator.advance("2026-08-06T10:00:10.000Z");
  const resumedEvent = resumedEvents.find(
    (event) => event.reading.sensorId === "smoke-sensor-01",
  );

  assert.equal(smokeNode.mode, "automatic");
  assert.equal(resumedEvents.length, 6);
  assert.equal(new Set(resumedEvents.map((event) => event.reading.sensorId)).size, 6);
  assert.equal(resumedEvent.readingSource, "automatic-simulator");
  assert.equal(resumedEvent.reading.sensorId, "smoke-sensor-01");
  assert.equal(resumedEvent.reading.value, 60);
  assert.equal(resumedEvent.reading.sequence, 3);
});

test("resume emits one reading when the sensor is also in the next batch", () => {
  const state = generateScenario();
  const simulator = createSensorSimulator(state);

  simulator.applyManualOverride({
    messageType: "manual-sensor-override",
    commandId: "manual-command-04",
    scenarioId: state.scenarioId,
    sensorId: "smoke-sensor-04",
    sensorType: "smoke",
    requestedAt: "2026-08-06T10:00:01.000Z",
    readingValue: 200,
  });
  simulator.advance("2026-08-06T10:00:05.000Z");
  simulator.resumeAutomatic({
    messageType: "resume-automatic-sensor",
    commandId: "resume-command-03",
    scenarioId: state.scenarioId,
    sensorId: "smoke-sensor-04",
    requestedAt: "2026-08-06T10:00:06.000Z",
  });

  const events = simulator.advance("2026-08-06T10:00:10.000Z");
  const smokeEvents = events.filter(
    (event) => event.reading.sensorId === "smoke-sensor-04",
  );

  assert.equal(events.length, 5);
  assert.equal(smokeEvents.length, 1);
  assert.equal(smokeEvents[0].reading.value, 70);
  assert.equal(smokeEvents[0].reading.sequence, 3);
});

test("schedules the next event only after the current event finishes", async () => {
  const scheduledTasks = [];
  const cancelledTasks = [];
  let releaseEvent;
  const eventFinished = new Promise((resolve) => {
    releaseEvent = resolve;
  });
  const simulator = createSensorSimulator(generateScenario(), {
    scheduleTask(callback, delay) {
      const task = { callback, delay };
      scheduledTasks.push(task);
      return task;
    },
    cancelTask(task) {
      cancelledTasks.push(task);
    },
  });
  const receivedEvents = [];
  const receivedErrors = [];

  simulator.start(
    async (event) => {
      receivedEvents.push(event);
      await eventFinished;
    },
    (error) => receivedErrors.push(error),
  );

  assert.equal(simulator.isRunning, true);
  assert.equal(scheduledTasks.length, 1);
  assert.equal(scheduledTasks[0].delay, SENSOR_UPDATE_INTERVAL_MS);

  const firstScheduledRun = scheduledTasks[0].callback();
  assert.equal(receivedEvents.length, 1);
  assert.equal(scheduledTasks.length, 1);

  releaseEvent();
  await firstScheduledRun;
  assert.equal(receivedEvents.length, 5);
  assert.equal(scheduledTasks.length, 2);
  assert.equal(receivedErrors.length, 0);

  simulator.stop();
  assert.equal(simulator.isRunning, false);
  assert.deepEqual(cancelledTasks, [scheduledTasks[1]]);
});

test("rejects invalid batches, unknown sensors, and invalid readings", () => {
  const state = generateScenario();
  const tooSmallBatch = validBatch().slice(0, 4);
  const tooLargeBatch = [
    ...validBatch(),
    { sensorId: "smoke-sensor-04", readingValue: 70 },
  ];
  const unknownSensorBatch = validBatch();
  unknownSensorBatch[0] = { sensorId: "smoke-sensor-99", readingValue: 60 };
  const repeatedSensorBatch = validBatch();
  repeatedSensorBatch[1] = { ...repeatedSensorBatch[0] };
  const invalidReadingBatch = validBatch();
  invalidReadingBatch[0] = { sensorId: "smoke-sensor-01", readingValue: -1 };

  assert.throws(
    () => createSensorSimulator(state, { batches: [] }),
    /at least one batch/,
  );
  assert.throws(
    () => createSensorSimulator(state, { batches: [tooSmallBatch] }),
    /exactly 5 changes/,
  );
  assert.throws(
    () => createSensorSimulator(state, { batches: [tooLargeBatch] }),
    /exactly 5 changes/,
  );
  assert.throws(
    () => createSensorSimulator(state, { batches: [unknownSensorBatch] }),
    /unknown sensor/,
  );
  assert.throws(
    () => createSensorSimulator(state, { batches: [repeatedSensorBatch] }),
    /repeats sensor/,
  );
  assert.throws(() => createSensorSimulator(state, { batches: [invalidReadingBatch] }));
});

test("rejects manual commands for a different scenario or unavailable sensor", () => {
  const state = generateScenario();
  const simulator = createSensorSimulator(state);

  assert.throws(
    () =>
      simulator.applyManualOverride({
        messageType: "manual-sensor-override",
        commandId: "manual-command-02",
        scenarioId: "different-scenario",
        sensorId: "smoke-sensor-01",
        sensorType: "smoke",
        requestedAt: "2026-08-06T10:00:01.000Z",
        readingValue: 250,
      }),
    /does not match the simulator scenario/,
  );

  assert.throws(
    () =>
      simulator.applyManualOverride({
        messageType: "manual-sensor-override",
        commandId: "manual-command-03",
        scenarioId: state.scenarioId,
        sensorId: "smoke-sensor-99",
        sensorType: "smoke",
        requestedAt: "2026-08-06T10:00:01.000Z",
        readingValue: 250,
      }),
    /unknown sensor/,
  );

  assert.throws(
    () =>
      simulator.resumeAutomatic({
        messageType: "resume-automatic-sensor",
        commandId: "resume-command-02",
        scenarioId: state.scenarioId,
        sensorId: "smoke-sensor-01",
        requestedAt: "2026-08-06T10:00:01.000Z",
      }),
    /already in automatic mode/,
  );
});
