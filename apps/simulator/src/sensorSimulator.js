import { clearTimeout, setTimeout } from "node:timers";

import {
  CurrentBuildingStateSchema,
  ManualSensorOverrideCommandSchema,
  ResumeAutomaticSensorCommandSchema,
  SENSOR_UPDATE_INTERVAL_MS,
} from "@evacuva/contracts";

import { createSensorNode } from "./sensorNode.js";

const SENSOR_CHANGES_PER_INTERVAL = 5;

const DEFAULT_EMERGENCY_BATCHES = [
  [
    { sensorId: "smoke-sensor-01", readingValue: 60 },
    { sensorId: "smoke-sensor-02", readingValue: 45 },
    { sensorId: "smoke-sensor-03", readingValue: 30 },
    { sensorId: "temperature-sensor-01", readingValue: 32 },
    { sensorId: "occupancy-sensor-01", readingValue: 0.35 },
  ],
  [
    { sensorId: "smoke-sensor-04", readingValue: 70 },
    { sensorId: "smoke-sensor-05", readingValue: 55 },
    { sensorId: "smoke-sensor-06", readingValue: 40 },
    { sensorId: "temperature-sensor-02", readingValue: 35 },
    { sensorId: "occupancy-sensor-02", readingValue: 0.4 },
  ],
  [
    { sensorId: "smoke-sensor-07", readingValue: 80 },
    { sensorId: "smoke-sensor-08", readingValue: 65 },
    { sensorId: "smoke-sensor-09", readingValue: 50 },
    { sensorId: "temperature-sensor-03", readingValue: 38 },
    { sensorId: "occupancy-sensor-03", readingValue: 0.45 },
  ],
  [
    { sensorId: "smoke-sensor-10", readingValue: 90 },
    { sensorId: "smoke-sensor-11", readingValue: 75 },
    { sensorId: "smoke-sensor-12", readingValue: 60 },
    { sensorId: "temperature-sensor-04", readingValue: 41 },
    { sensorId: "occupancy-sensor-04", readingValue: 0.5 },
  ],
  [
    { sensorId: "temperature-sensor-05", readingValue: 44 },
    { sensorId: "temperature-sensor-06", readingValue: 46 },
    { sensorId: "temperature-sensor-07", readingValue: 48 },
    { sensorId: "occupancy-sensor-05", readingValue: 0.55 },
    { sensorId: "occupancy-sensor-06", readingValue: 0.6 },
  ],
  [
    { sensorId: "temperature-sensor-08", readingValue: 50 },
    { sensorId: "temperature-sensor-09", readingValue: 52 },
    { sensorId: "temperature-sensor-10", readingValue: 54 },
    { sensorId: "occupancy-sensor-07", readingValue: 0.65 },
    { sensorId: "occupancy-sensor-08", readingValue: 0.7 },
  ],
  [
    { sensorId: "temperature-sensor-11", readingValue: 56 },
    { sensorId: "temperature-sensor-12", readingValue: 58 },
    { sensorId: "occupancy-sensor-09", readingValue: 0.72 },
    { sensorId: "occupancy-sensor-10", readingValue: 0.74 },
    { sensorId: "occupancy-sensor-11", readingValue: 0.76 },
  ],
  [
    { sensorId: "occupancy-sensor-12", readingValue: 0.78 },
    {
      sensorId: "exit-door-sensor-01",
      readingValue: { open: true, obstructed: false },
    },
    {
      sensorId: "exit-door-sensor-02",
      readingValue: { open: true, obstructed: false },
    },
    {
      sensorId: "exit-door-sensor-03",
      readingValue: { open: false, obstructed: true },
    },
    {
      sensorId: "exit-door-sensor-04",
      readingValue: { open: true, obstructed: false },
    },
  ],
  [
    {
      sensorId: "exit-door-sensor-05",
      readingValue: { open: true, obstructed: false },
    },
    {
      sensorId: "exit-door-sensor-06",
      readingValue: { open: false, obstructed: true },
    },
    { sensorId: "smoke-sensor-01", readingValue: 255 },
    { sensorId: "temperature-sensor-01", readingValue: 85 },
    { sensorId: "occupancy-sensor-01", readingValue: 0.9 },
  ],
  [
    { sensorId: "smoke-sensor-02", readingValue: 180 },
    { sensorId: "smoke-sensor-03", readingValue: 120 },
    { sensorId: "temperature-sensor-02", readingValue: 55 },
    { sensorId: "occupancy-sensor-02", readingValue: 0.7 },
    {
      sensorId: "exit-door-sensor-02",
      readingValue: { open: false, obstructed: true },
    },
  ],
  [
    { sensorId: "smoke-sensor-01", readingValue: 100 },
    { sensorId: "smoke-sensor-02", readingValue: 80 },
    { sensorId: "temperature-sensor-01", readingValue: 50 },
    { sensorId: "occupancy-sensor-01", readingValue: 0.45 },
    {
      sensorId: "exit-door-sensor-02",
      readingValue: { open: true, obstructed: false },
    },
  ],
  [
    { sensorId: "smoke-sensor-01", readingValue: 0 },
    { sensorId: "smoke-sensor-02", readingValue: 0 },
    { sensorId: "temperature-sensor-01", readingValue: 22 },
    { sensorId: "occupancy-sensor-01", readingValue: 0.1 },
    {
      sensorId: "exit-door-sensor-06",
      readingValue: { open: true, obstructed: false },
    },
  ],
];

function validateBatches(sensorNodes, batches) {
  if (!Array.isArray(batches) || batches.length === 0) {
    throw new Error("Sensor batches must contain at least one batch");
  }

  return batches.map((batch, batchIndex) => {
    if (!Array.isArray(batch) || batch.length !== SENSOR_CHANGES_PER_INTERVAL) {
      throw new Error(
        `Sensor batch ${batchIndex + 1} must contain exactly ${SENSOR_CHANGES_PER_INTERVAL} changes`,
      );
    }

    const sensorIds = new Set();
    return batch.map((step) => {
      const sensorNode = sensorNodes.get(step.sensorId);
      if (!sensorNode) {
        throw new Error(`Sensor batch references unknown sensor ${step.sensorId}`);
      }
      if (sensorIds.has(step.sensorId)) {
        throw new Error(`Sensor batch ${batchIndex + 1} repeats sensor ${step.sensorId}`);
      }
      sensorIds.add(step.sensorId);

      return {
        sensorId: sensorNode.sensorId,
        readingValue: sensorNode.validateReadingValue(
          step.readingValue,
          step.healthy ?? true,
        ),
        healthy: step.healthy ?? true,
      };
    });
  });
}

function createSensorNodes(state) {
  const readingsBySensorId = new Map(
    state.latestReadings.map((reading) => [reading.sensorId, reading]),
  );

  return new Map(
    state.sensors.map((definition) => [
      definition.sensorId,
      createSensorNode(definition, readingsBySensorId.get(definition.sensorId)),
    ]),
  );
}

export function createSensorSimulator(stateInput, options = {}) {
  const state = CurrentBuildingStateSchema.parse(stateInput);
  const sensorNodes = createSensorNodes(state);
  const batches = validateBatches(
    sensorNodes,
    options.batches ?? DEFAULT_EMERGENCY_BATCHES,
  );
  const scheduleTask = options.scheduleTask ?? setTimeout;
  const cancelTask = options.cancelTask ?? clearTimeout;
  const pendingAutomaticReadings = new Set();
  let batchIndex = 0;
  let scheduledTask;
  let running = false;

  function advance(timestamp = new Date().toISOString()) {
    const batch = batches[batchIndex];
    const batchSensorIds = new Set(batch.map((step) => step.sensorId));
    const events = [];
    batchIndex = (batchIndex + 1) % batches.length;

    for (const resumedSensorId of pendingAutomaticReadings) {
      pendingAutomaticReadings.delete(resumedSensorId);
      if (!batchSensorIds.has(resumedSensorId)) {
        events.push(
          sensorNodes.get(resumedSensorId).emitCurrentAutomaticReading(timestamp),
        );
      }
    }

    for (const step of batch) {
      const event = sensorNodes
        .get(step.sensorId)
        .emitAutomaticReading(step.readingValue, timestamp, step.healthy);

      if (event !== null) {
        events.push(event);
      }
    }

    return events;
  }

  function findCommandSensor(sensorId, scenarioId) {
    if (scenarioId !== state.scenarioId) {
      throw new Error(
        `Command scenario ${scenarioId} does not match the simulator scenario`,
      );
    }

    const sensorNode = sensorNodes.get(sensorId);
    if (!sensorNode) {
      throw new Error(`Command references unknown sensor ${sensorId}`);
    }

    return sensorNode;
  }

  function applyManualOverride(commandInput) {
    const command = ManualSensorOverrideCommandSchema.parse(commandInput);
    const sensorNode = findCommandSensor(command.sensorId, command.scenarioId);

    if (sensorNode.sensorType !== command.sensorType) {
      throw new Error(`Command sensor type does not match ${command.sensorId}`);
    }

    pendingAutomaticReadings.delete(sensorNode.sensorId);
    return sensorNode.emitManualReading(command.readingValue, command.requestedAt);
  }

  function resumeAutomatic(commandInput) {
    const command = ResumeAutomaticSensorCommandSchema.parse(commandInput);
    const sensorNode = findCommandSensor(command.sensorId, command.scenarioId);

    sensorNode.resumeAutomatic();
    pendingAutomaticReadings.add(sensorNode.sensorId);
  }

  function scheduleNext(onEvent, onError) {
    scheduledTask = scheduleTask(async () => {
      try {
        const events = advance();
        for (const event of events) {
          await onEvent(event);
        }
        if (running) {
          scheduleNext(onEvent, onError);
        }
      } catch (error) {
        running = false;
        onError(error);
      }
    }, SENSOR_UPDATE_INTERVAL_MS);
  }

  function start(onEvent, onError) {
    if (running) {
      throw new Error("Sensor simulator is already running");
    }
    if (typeof onEvent !== "function" || typeof onError !== "function") {
      throw new TypeError("Sensor simulator requires event and error callbacks");
    }

    running = true;
    scheduleNext(onEvent, onError);
  }

  function stop() {
    running = false;
    if (scheduledTask !== undefined) {
      cancelTask(scheduledTask);
      scheduledTask = undefined;
    }
  }

  return {
    advance,
    applyManualOverride,
    batchCount: batches.length,
    changesPerInterval: SENSOR_CHANGES_PER_INTERVAL,
    getSensorNode(sensorId) {
      return sensorNodes.get(sensorId);
    },
    resumeAutomatic,
    start,
    stop,
    sensorCount: sensorNodes.size,
    get isRunning() {
      return running;
    },
  };
}
