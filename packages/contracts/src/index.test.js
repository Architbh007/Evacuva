import assert from "node:assert/strict";
import test from "node:test";

import {
  AppliedSensorBatchRecordSchema,
  BuildingStateUpdatedEventSchema,
  CoordinateSchema,
  DEFAULT_FLOORPLAN_CONFIGURATION,
  DEFAULT_SAFETY_PARAMETERS,
  DirectionalGuidanceEventSchema,
  FloorplanLayoutEventSchema,
  FloorplanConfigurationSchema,
  IndependentRouteResultRecordSchema,
  MQTT_TOPIC_PATTERNS,
  ManualSensorOverrideCommandSchema,
  OccupantSchema,
  ResumeAutomaticSensorCommandSchema,
  RouteCalculationRequestedEventSchema,
  RouteCalculationResultEventSchema,
  RouteRequestSchema,
  SENSOR_UPDATE_INTERVAL_MS,
  SafetyParametersSchema,
  SensorReadingBatchEventSchema,
  SensorIdSchema,
  SensorReadingEventSchema,
  SensorReadingSchema,
} from "./index.js";

test("coordinates accept non-negative integers", () => {
  assert.equal(CoordinateSchema.safeParse({ x: 12, y: 34 }).success, true);
});

test("coordinates reject negative and fractional values", () => {
  assert.equal(CoordinateSchema.safeParse({ x: -1, y: 4 }).success, false);
  assert.equal(CoordinateSchema.safeParse({ x: 1.5, y: 4 }).success, false);
});

test("the approved 100 by 100 configuration is valid", () => {
  assert.equal(
    FloorplanConfigurationSchema.safeParse(DEFAULT_FLOORPLAN_CONFIGURATION).success,
    true,
  );
});

test("another grid size and reversed room limits are rejected", () => {
  assert.equal(
    FloorplanConfigurationSchema.safeParse({
      ...DEFAULT_FLOORPLAN_CONFIGURATION,
      width: 40,
      height: 40,
    }).success,
    false,
  );
  assert.equal(
    FloorplanConfigurationSchema.safeParse({
      ...DEFAULT_FLOORPLAN_CONFIGURATION,
      minRoomSize: 12,
      maxRoomSize: 8,
    }).success,
    false,
  );
});

test("sensor readings reject values outside their allowed range", () => {
  const metadata = {
    eventId: "event-1",
    scenarioId: "scenario-1",
    sensorId: "smoke-sensor-01",
    coordinate: { x: 10, y: 12 },
    timestamp: "2026-08-05T10:15:00.000Z",
    sequence: 1,
    healthy: true,
  };
  const invalidReadings = [
    { ...metadata, type: "smoke", value: -1 },
    {
      ...metadata,
      sensorId: "temperature-sensor-01",
      type: "temperature",
      value: 301,
    },
    {
      ...metadata,
      sensorId: "occupancy-sensor-01",
      type: "occupancy",
      value: 1.1,
    },
    {
      ...metadata,
      sensorId: "exit-door-sensor-01",
      type: "door",
      value: { open: true },
    },
  ];

  for (const reading of invalidReadings) {
    assert.equal(SensorReadingSchema.safeParse(reading).success, false);
  }
});

test("safety parameters reject a critical temperature below its risk threshold", () => {
  assert.equal(
    SafetyParametersSchema.safeParse({
      ...DEFAULT_SAFETY_PARAMETERS,
      temperatureRiskBegins: 80,
      criticalTemperature: 80,
    }).success,
    false,
  );
});

test("message contracts accept descriptive sensor, state, and route events", () => {
  const timestamp = "2026-08-06T10:15:00.000Z";
  const reading = {
    eventId: "smoke-sensor-01-event-2",
    scenarioId: "scenario-48291",
    sensorId: "smoke-sensor-01",
    coordinate: { x: 20, y: 30 },
    timestamp,
    sequence: 2,
    healthy: true,
    type: "smoke",
    value: 60,
  };
  const routeRequest = {
    requestId: "route-request-2",
    occupantId: "occupant-01",
    scenarioId: "scenario-48291",
    stateVersion: 2,
    start: { x: 20, y: 30 },
    priority: "normal",
    submittedAt: timestamp,
  };
  const routeResult = {
    status: "success",
    requestId: "route-request-2",
    scenarioId: "scenario-48291",
    stateVersion: 2,
    path: [
      { x: 20, y: 30 },
      { x: 20, y: 29 },
    ],
    selectedExit: { x: 20, y: 29 },
    routeCost: 1,
    pathLength: 1,
    visitedNodeCount: 2,
    queueTimeMs: 0,
    computeTimeMs: 10,
    totalLatencyMs: 20,
    algorithmVersion: "dijkstra-v1",
    validationPassed: true,
  };

  assert.equal(
    SensorReadingBatchEventSchema.safeParse({
      messageType: "sensor-reading-batch",
      batchId: "automatic-batch-1",
      scenarioId: "scenario-48291",
      batchSource: "automatic-interval",
      collectedAt: timestamp,
      readings: Array.from({ length: 5 }, (_, index) => ({
        messageType: "sensor-reading",
        readingSource: "automatic-simulator",
        reading: {
          ...reading,
          eventId: `smoke-sensor-${index + 1}-event-2`,
          sensorId: `smoke-sensor-${String(index + 1).padStart(2, "0")}`,
        },
      })),
    }).success,
    true,
  );

  assert.equal(SENSOR_UPDATE_INTERVAL_MS, 5_000);
  assert.equal(
    MQTT_TOPIC_PATTERNS.sensorReadings,
    "evacuva/scenarios/{scenarioId}/sensors/{sensorId}/readings",
  );
  assert.equal(
    SensorReadingEventSchema.safeParse({
      messageType: "sensor-reading",
      readingSource: "automatic-simulator",
      reading,
    }).success,
    true,
  );
  assert.equal(
    ManualSensorOverrideCommandSchema.safeParse({
      messageType: "manual-sensor-override",
      commandId: "manual-override-1",
      scenarioId: "scenario-48291",
      sensorId: "smoke-sensor-01",
      sensorType: "smoke",
      readingValue: 250,
      requestedAt: timestamp,
    }).success,
    true,
  );
  assert.equal(
    ResumeAutomaticSensorCommandSchema.safeParse({
      messageType: "resume-automatic-sensor",
      commandId: "resume-automatic-1",
      scenarioId: "scenario-48291",
      sensorId: "smoke-sensor-01",
      requestedAt: timestamp,
    }).success,
    true,
  );
  assert.equal(
    BuildingStateUpdatedEventSchema.safeParse({
      messageType: "building-state-updated",
      eventId: "building-state-updated-2",
      triggeringBatchId: "automatic-batch-1",
      scenarioId: "scenario-48291",
      appliedReadingCount: 5,
      previousStateVersion: 1,
      stateVersion: 2,
      updatedAt: timestamp,
    }).success,
    true,
  );
  assert.equal(
    RouteCalculationRequestedEventSchema.safeParse({
      messageType: "route-calculation-requested",
      eventId: "route-calculation-requested-2",
      triggeringEventId: reading.eventId,
      request: routeRequest,
    }).success,
    true,
  );
  assert.equal(
    RouteCalculationResultEventSchema.safeParse({
      messageType: "route-calculation-result",
      eventId: "route-calculation-result-2",
      completedAt: timestamp,
      result: routeResult,
    }).success,
    true,
  );
});

test("message contracts reject unclear IDs and inconsistent updates", () => {
  const timestamp = "2026-08-06T10:15:00.000Z";

  assert.equal(SensorIdSchema.safeParse("sensor-1").success, false);
  assert.equal(
    ManualSensorOverrideCommandSchema.safeParse({
      messageType: "manual-sensor-override",
      commandId: "manual-override-1",
      scenarioId: "scenario-48291",
      sensorId: "temperature-sensor-01",
      sensorType: "smoke",
      readingValue: 250,
      requestedAt: timestamp,
    }).success,
    false,
  );
  assert.equal(
    BuildingStateUpdatedEventSchema.safeParse({
      messageType: "building-state-updated",
      eventId: "building-state-updated-3",
      triggeringBatchId: "automatic-batch-1",
      scenarioId: "scenario-48291",
      appliedReadingCount: 5,
      previousStateVersion: 1,
      stateVersion: 3,
      updatedAt: timestamp,
    }).success,
    false,
  );
});

test("independent route requests identify the occupant and immutable state version", () => {
  const submittedAt = "2026-08-22T10:15:00.000Z";
  const firstRequest = {
    requestId: "route-request-state-2-occupant-01",
    occupantId: "occupant-01",
    scenarioId: "scenario-48291",
    stateVersion: 2,
    start: { x: 20, y: 30 },
    priority: "normal",
    submittedAt,
  };
  const secondRequest = {
    ...firstRequest,
    requestId: "route-request-state-2-occupant-02",
    occupantId: "occupant-02",
    start: { x: 21, y: 30 },
  };

  assert.equal(RouteRequestSchema.safeParse(firstRequest).success, true);
  assert.equal(RouteRequestSchema.safeParse(secondRequest).success, true);
  assert.equal(
    OccupantSchema.safeParse({
      occupantId: "occupant-01",
      scenarioId: "scenario-48291",
      start: firstRequest.start,
      startSource: "generated",
    }).success,
    true,
  );
  assert.equal(
    RouteRequestSchema.safeParse({ ...firstRequest, occupantId: undefined }).success,
    false,
  );
});

test("an independent route result stays correlated with its original request", () => {
  const request = {
    requestId: "route-request-state-2-occupant-01",
    occupantId: "occupant-01",
    scenarioId: "scenario-48291",
    stateVersion: 2,
    start: { x: 20, y: 30 },
    priority: "normal",
    submittedAt: "2026-08-22T10:15:00.000Z",
  };
  const resultRecord = {
    scenarioId: request.scenarioId,
    recordKey: `RESULT#${request.requestId}`,
    request,
    resultEvent: {
      messageType: "route-calculation-result",
      eventId: `route-calculation-result-${request.requestId}`,
      completedAt: "2026-08-22T10:15:00.100Z",
      result: {
        status: "failure",
        reason: "unreachable_exit",
        requestId: request.requestId,
        scenarioId: request.scenarioId,
        stateVersion: request.stateVersion,
        visitedNodeCount: 120,
        queueTimeMs: 20,
        computeTimeMs: 70,
        totalLatencyMs: 100,
        algorithmVersion: "safest-route-v1",
      },
    },
    storedAt: "2026-08-22T10:15:00.101Z",
  };

  assert.equal(IndependentRouteResultRecordSchema.safeParse(resultRecord).success, true);
  assert.equal(
    IndependentRouteResultRecordSchema.safeParse({
      ...resultRecord,
      recordKey: "RESULT#another-request",
    }).success,
    false,
  );
});

test("an applied-batch marker correlates one batch with one state version", () => {
  const marker = {
    scenarioId: "scenario-48291",
    recordKey: "BATCH#automatic-batch-1",
    batchId: "automatic-batch-1",
    stateVersion: 2,
    appliedAt: "2026-08-22T12:00:00.000Z",
  };

  assert.equal(AppliedSensorBatchRecordSchema.safeParse(marker).success, true);
  assert.equal(
    AppliedSensorBatchRecordSchema.safeParse({
      ...marker,
      recordKey: "BATCH#another-batch",
    }).success,
    false,
  );
});

test("sensor batches reject the wrong size and inconsistent reading times", () => {
  const timestamp = "2026-08-06T10:15:00.000Z";
  const readingEvent = {
    messageType: "sensor-reading",
    readingSource: "automatic-simulator",
    reading: {
      eventId: "smoke-sensor-01-event-2",
      scenarioId: "scenario-48291",
      sensorId: "smoke-sensor-01",
      coordinate: { x: 20, y: 30 },
      timestamp: "2026-08-06T10:14:55.000Z",
      sequence: 2,
      healthy: true,
      type: "smoke",
      value: 60,
    },
  };

  assert.equal(
    SensorReadingBatchEventSchema.safeParse({
      messageType: "sensor-reading-batch",
      batchId: "automatic-batch-1",
      scenarioId: "scenario-48291",
      batchSource: "automatic-interval",
      collectedAt: timestamp,
      readings: [readingEvent],
    }).success,
    false,
  );
});

test("dashboard contracts describe the map and next safe direction", () => {
  const timestamp = "2026-08-27T10:15:00.000Z";
  const occupants = Array.from({ length: 10 }, (_, index) => ({
    occupantId: `occupant-${String(index + 1).padStart(2, "0")}`,
    scenarioId: "scenario-48291",
    start: { x: index + 1, y: 1 },
    startSource: "generated",
  }));
  const sensor = {
    sensorId: "smoke-sensor-01",
    type: "smoke",
    coordinate: { x: 10, y: 10 },
  };
  const reading = {
    eventId: "smoke-sensor-01-event-1",
    scenarioId: "scenario-48291",
    sensorId: sensor.sensorId,
    coordinate: sensor.coordinate,
    timestamp,
    sequence: 1,
    healthy: true,
    type: "smoke",
    value: 0,
  };
  const layout = {
    messageType: "floorplan-layout",
    scenarioId: "scenario-48291",
    stateVersion: 1,
    width: 100,
    height: 100,
    rows: Array.from({ length: 100 }, () => ".".repeat(100)),
    occupants,
    sensors: [sensor],
    latestReadings: [reading],
    publishedAt: timestamp,
  };

  assert.equal(FloorplanLayoutEventSchema.safeParse(layout).success, true);
  assert.equal(
    FloorplanLayoutEventSchema.safeParse({
      ...layout,
      rows: [".".repeat(99)],
    }).success,
    false,
  );
  assert.equal(
    DirectionalGuidanceEventSchema.safeParse({
      messageType: "directional-guidance",
      eventId: "directional-guidance-route-request-2",
      requestId: "route-request-2",
      occupantId: "occupant-01",
      scenarioId: "scenario-48291",
      stateVersion: 2,
      status: "success",
      direction: "east",
      nextCoordinate: { x: 11, y: 10 },
      selectedExit: { x: 99, y: 10 },
      remainingSteps: 88,
      publishedAt: timestamp,
    }).success,
    true,
  );
});
