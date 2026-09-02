import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  ManualSensorOverrideCommandSchema,
  ResumeAutomaticSensorCommandSchema,
} from "@evacuva/contracts";

import { createDashboardMqttStore } from "./dashboardMqttStore.js";

function createFakeClient() {
  const client = new EventEmitter();
  client.connected = true;
  client.subscriptions = [];
  client.publications = [];
  client.subscribe = (topics, options, callback) => {
    client.subscriptions.push({ topics, options });
    callback(null);
  };
  client.publish = (topic, payload, options, callback) => {
    client.publications.push({ topic, payload: JSON.parse(payload), options });
    callback(null);
  };
  client.end = () => {};
  return client;
}

function layoutEvent() {
  return {
    messageType: "floorplan-layout",
    scenarioId: "scenario-48291",
    stateVersion: 1,
    width: 100,
    height: 100,
    rows: Array.from({ length: 100 }, () => ".".repeat(100)),
    occupants: Array.from({ length: 10 }, (_, index) => ({
      occupantId: `occupant-${String(index + 1).padStart(2, "0")}`,
      scenarioId: "scenario-48291",
      start: { x: index, y: 10 },
      startSource: "generated",
    })),
    sensors: [
      {
        sensorId: "temperature-sensor-01",
        type: "temperature",
        coordinate: { x: 20, y: 20 },
      },
    ],
    latestReadings: [
      {
        eventId: "temperature-reading-1",
        scenarioId: "scenario-48291",
        sensorId: "temperature-sensor-01",
        coordinate: { x: 20, y: 20 },
        timestamp: "2026-09-02T00:00:00.000Z",
        sequence: 1,
        healthy: true,
        type: "temperature",
        value: 22,
      },
    ],
    publishedAt: "2026-09-02T00:00:00.000Z",
  };
}

test("the dashboard subscribes to the five existing presentation topics", () => {
  const client = createFakeClient();
  const store = createDashboardMqttStore({ connectClient: () => client });

  client.emit("connect");

  assert.equal(client.subscriptions.length, 1);
  assert.equal(client.subscriptions[0].topics.length, 5);
  assert.equal(store.getSnapshot().connectionStatus, "connected");
  store.close();
});

test("retained layout and newer readings form one current snapshot", () => {
  const client = createFakeClient();
  const store = createDashboardMqttStore({
    connectClient: () => client,
    now: () => "2026-09-02T00:00:05.000Z",
  });
  client.emit("connect");
  client.emit("message", store.topics.layout, Buffer.from(JSON.stringify(layoutEvent())));
  client.emit(
    "message",
    "evacuva/scenarios/scenario-48291/sensors/temperature-sensor-01/readings",
    Buffer.from(
      JSON.stringify({
        messageType: "sensor-reading",
        readingSource: "automatic-simulator",
        reading: {
          ...layoutEvent().latestReadings[0],
          eventId: "temperature-reading-2",
          sequence: 2,
          value: 38,
        },
      }),
    ),
  );

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.layout.rows.length, 100);
  assert.equal(snapshot.occupants.length, 10);
  assert.equal(snapshot.readings[0].value, 38);
  store.close();
});

test("manual override and resume controls publish validated commands", async () => {
  const client = createFakeClient();
  const store = createDashboardMqttStore({
    connectClient: () => client,
    now: () => "2026-09-02T00:00:05.000Z",
    createCommandId: () => "test-command",
  });
  client.emit("connect");
  client.emit("message", store.topics.layout, Buffer.from(JSON.stringify(layoutEvent())));

  await store.publishSensorControl({
    action: "override",
    sensorId: "temperature-sensor-01",
    readingValue: 40,
  });
  await store.publishSensorControl({
    action: "resume",
    sensorId: "temperature-sensor-01",
  });

  assert.equal(client.publications.length, 2);
  ManualSensorOverrideCommandSchema.parse(client.publications[0].payload);
  ResumeAutomaticSensorCommandSchema.parse(client.publications[1].payload);
  assert.equal(client.publications[0].topic, store.topics.manual);
  assert.equal(client.publications[1].topic, store.topics.resume);
  store.close();
});
