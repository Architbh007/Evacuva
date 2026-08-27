import assert from "node:assert/strict";
import test from "node:test";
import { clearTimeout, setTimeout } from "node:timers";

import { SensorReadingEventSchema } from "@evacuva/contracts";
import { generateScenario } from "@evacuva/core";
import { connectAsync } from "mqtt";

import { startLocalMqttBroker } from "./localMqttBroker.js";
import { connectSensorSimulatorToMqtt } from "./mqttSensorConnection.js";
import { createSensorSimulator } from "./sensorSimulator.js";

function createValueQueue() {
  const values = [];
  const waiters = [];

  return {
    push(value) {
      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve(value);
      } else {
        values.push(value);
      }
    },
    next() {
      const value = values.shift();
      if (value !== undefined) {
        return Promise.resolve(value);
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Timed out waiting for an MQTT test event")),
          2_000,
        );
        waiters.push({
          resolve(receivedValue) {
            clearTimeout(timer);
            resolve(receivedValue);
          },
        });
      });
    },
  };
}

function waitForMessages(client, expectedCount) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const timer = setTimeout(() => {
      client.off("message", receiveMessage);
      reject(new Error(`Timed out waiting for ${expectedCount} MQTT messages`));
    }, 2_000);

    function receiveMessage(topic, payload) {
      messages.push({ topic, payload: payload.toString("utf8") });
      if (messages.length === expectedCount) {
        clearTimeout(timer);
        client.off("message", receiveMessage);
        resolve(messages);
      }
    }

    client.on("message", receiveMessage);
  });
}

async function createMqttFixture(testContext) {
  const broker = await startLocalMqttBroker({ port: 0 });
  const state = generateScenario();
  const simulator = createSensorSimulator(state);
  const commandResults = createValueQueue();
  const errors = createValueQueue();
  const connection = await connectSensorSimulatorToMqtt({
    brokerUrl: broker.url,
    clientId: "evacuva-simulator-test",
    scenarioId: state.scenarioId,
    simulator,
    onCommandHandled: (result) => commandResults.push(result),
    onError: (error) => errors.push(error),
  });
  const observer = await connectAsync(
    broker.url,
    {
      clientId: "evacuva-observer-test",
      reconnectPeriod: 0,
    },
    false,
  );
  await observer.subscribeAsync(connection.topics.sensorReadings, { qos: 1 });

  testContext.after(async () => {
    await observer.endAsync(true);
    await connection.close();
    await broker.close();
  });

  return {
    broker,
    commandResults,
    connection,
    errors,
    observer,
    simulator,
    state,
  };
}

test("publishes a five-reading batch through the local MQTT broker", async (context) => {
  const { connection, observer, simulator } = await createMqttFixture(context);
  const events = simulator.advance("2026-08-06T10:00:05.000Z");
  const receivedMessages = waitForMessages(observer, 5);

  const publishedTopics = await Promise.all(
    events.map((event) => connection.publishReading(event)),
  );
  const messages = await receivedMessages;

  assert.equal(connection.isConnected, true);
  assert.equal(messages.length, 5);
  assert.equal(new Set(publishedTopics).size, 5);
  assert.deepEqual(
    messages.map((message) => JSON.parse(message.payload).reading.sensorId),
    events.map((event) => event.reading.sensorId),
  );
  for (const message of messages) {
    assert.match(message.topic, /\/sensors\/.+\/readings$/);
    assert.equal(
      SensorReadingEventSchema.safeParse(JSON.parse(message.payload)).success,
      true,
    );
  }

  const differentScenarioEvent = {
    ...events[0],
    reading: { ...events[0].reading, scenarioId: "different-scenario" },
  };
  await assert.rejects(
    () => connection.publishReading(differentScenarioEvent),
    /scenario does not match/,
  );
});

test("handles manual, duplicate, and resume commands through MQTT", async (context) => {
  const { commandResults, connection, observer, simulator, state } =
    await createMqttFixture(context);
  const manualCommand = {
    messageType: "manual-sensor-override",
    commandId: "mqtt-manual-command-01",
    scenarioId: state.scenarioId,
    sensorId: "smoke-sensor-01",
    sensorType: "smoke",
    requestedAt: "2026-08-06T10:00:01.000Z",
    readingValue: 250,
  };
  const manualReadingMessage = waitForMessages(observer, 1);

  await observer.publishAsync(
    connection.topics.manualSensorOverrides,
    JSON.stringify(manualCommand),
    { qos: 1 },
  );
  const firstResult = await commandResults.next();
  const [manualMessage] = await manualReadingMessage;
  const manualEvent = JSON.parse(manualMessage.payload);

  assert.equal(firstResult.duplicate, false);
  assert.equal(manualEvent.readingSource, "manual-control");
  assert.equal(manualEvent.reading.value, 250);
  assert.equal(simulator.getSensorNode("smoke-sensor-01").mode, "manual");

  await observer.publishAsync(
    connection.topics.manualSensorOverrides,
    JSON.stringify(manualCommand),
    { qos: 1 },
  );
  const duplicateResult = await commandResults.next();
  assert.equal(duplicateResult.duplicate, true);
  assert.equal(simulator.getSensorNode("smoke-sensor-01").sequence, 2);

  await observer.publishAsync(
    connection.topics.resumeAutomaticSensor,
    JSON.stringify({
      messageType: "resume-automatic-sensor",
      commandId: "mqtt-resume-command-01",
      scenarioId: state.scenarioId,
      sensorId: "smoke-sensor-01",
      requestedAt: "2026-08-06T10:00:02.000Z",
    }),
    { qos: 1 },
  );
  const resumeResult = await commandResults.next();
  const automaticEvents = simulator.advance("2026-08-06T10:00:05.000Z");

  assert.equal(resumeResult.duplicate, false);
  assert.equal(simulator.getSensorNode("smoke-sensor-01").mode, "automatic");
  assert.equal(
    automaticEvents.filter((event) => event.reading.sensorId === "smoke-sensor-01")
      .length,
    1,
  );
});

test("reports malformed MQTT commands without stopping valid publishing", async (context) => {
  const { connection, errors, observer, simulator } = await createMqttFixture(context);

  await observer.publishAsync(connection.topics.manualSensorOverrides, "not-json", {
    qos: 1,
  });
  const error = await errors.next();

  assert.match(error.message, /not valid JSON/);

  const [event] = simulator.advance("2026-08-06T10:00:05.000Z");
  const receivedMessage = waitForMessages(observer, 1);
  await connection.publishReading(event);
  const [message] = await receivedMessage;

  assert.equal(JSON.parse(message.payload).reading.sensorId, event.reading.sensorId);
});

test("rejects a connection when the local MQTT broker is unavailable", async () => {
  const broker = await startLocalMqttBroker({ port: 0 });
  const unavailableBrokerUrl = broker.url;
  await broker.close();
  const state = generateScenario();

  await assert.rejects(
    () =>
      connectSensorSimulatorToMqtt({
        brokerUrl: unavailableBrokerUrl,
        connectTimeoutMs: 250,
        scenarioId: state.scenarioId,
        simulator: createSensorSimulator(state),
        onError() {},
      }),
    /Could not connect to MQTT broker/,
  );
});
