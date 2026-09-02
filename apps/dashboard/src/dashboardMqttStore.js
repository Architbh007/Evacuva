import { randomUUID } from "node:crypto";
import { env } from "node:process";

import {
  BuildingStateUpdatedEventSchema,
  DirectionalGuidanceEventSchema,
  FloorplanLayoutEventSchema,
  ManualSensorOverrideCommandSchema,
  MQTT_TOPIC_PATTERNS,
  ResumeAutomaticSensorCommandSchema,
  RouteCalculationResultEventSchema,
  SensorReadingEventSchema,
} from "@evacuva/contracts";
import { connect } from "mqtt";

const MQTT_QOS = 1;
const STORE_SYMBOL = Symbol.for("evacuva.dashboard.mqtt-store");

function scenarioTopic(pattern, scenarioId, requestId = "+") {
  return pattern.replace("{scenarioId}", scenarioId).replace("{requestId}", requestId);
}

function parseMessage(payload, topic) {
  try {
    return JSON.parse(payload.toString("utf8"));
  } catch (error) {
    throw new Error(`MQTT message on ${topic} is not valid JSON`, { cause: error });
  }
}

function copySnapshot(snapshot, readingsBySensor) {
  return {
    ...snapshot,
    occupants: [...snapshot.occupants],
    sensors: [...snapshot.sensors],
    readings: [...readingsBySensor.values()].sort((first, second) =>
      first.sensorId.localeCompare(second.sensorId),
    ),
  };
}

export function createDashboardMqttStore(options = {}) {
  const {
    brokerUrl = "mqtt://127.0.0.1:1883",
    scenarioId = "scenario-48291",
    connectClient = connect,
    now = () => new Date().toISOString(),
    createCommandId = randomUUID,
  } = options;
  const topics = Object.freeze({
    readings: scenarioTopic(MQTT_TOPIC_PATTERNS.sensorReadings, scenarioId).replace(
      "{sensorId}",
      "+",
    ),
    state: scenarioTopic(MQTT_TOPIC_PATTERNS.buildingStateUpdates, scenarioId),
    routes: scenarioTopic(MQTT_TOPIC_PATTERNS.routeResults, scenarioId),
    layout: scenarioTopic(MQTT_TOPIC_PATTERNS.floorplanLayout, scenarioId),
    guidance: scenarioTopic(MQTT_TOPIC_PATTERNS.directionalGuidance, scenarioId),
    manual: scenarioTopic(MQTT_TOPIC_PATTERNS.manualSensorOverrides, scenarioId),
    resume: scenarioTopic(MQTT_TOPIC_PATTERNS.resumeAutomaticSensor, scenarioId),
  });
  const readingsBySensor = new Map();
  let snapshot = {
    scenarioId,
    stateVersion: null,
    layout: null,
    occupants: [],
    sensors: [],
    routeEvent: null,
    guidance: null,
    updatedAt: null,
    connectionStatus: "connecting",
  };
  let lastError = null;

  const client = connectClient(brokerUrl, {
    clean: true,
    clientId: "evacuva-dashboard",
    connectTimeout: 5_000,
    reconnectPeriod: 1_000,
    protocolVersion: 4,
  });

  function updateConnection(status, error = null) {
    snapshot = { ...snapshot, connectionStatus: status, updatedAt: now() };
    lastError = error;
  }

  function requireScenario(eventScenarioId) {
    if (eventScenarioId !== scenarioId) {
      throw new Error(`Dashboard received an event for ${eventScenarioId}`);
    }
  }

  function applyMessage(topic, payload) {
    const message = parseMessage(payload, topic);

    if (topic === topics.layout) {
      const event = FloorplanLayoutEventSchema.parse(message);
      requireScenario(event.scenarioId);
      readingsBySensor.clear();
      for (const reading of event.latestReadings) {
        readingsBySensor.set(reading.sensorId, reading);
      }
      snapshot = {
        ...snapshot,
        stateVersion: event.stateVersion,
        layout: { width: event.width, height: event.height, rows: event.rows },
        occupants: event.occupants,
        sensors: event.sensors,
        updatedAt: now(),
      };
      return;
    }

    if (topic === topics.state) {
      const event = BuildingStateUpdatedEventSchema.parse(message);
      requireScenario(event.scenarioId);
      snapshot = { ...snapshot, stateVersion: event.stateVersion, updatedAt: now() };
      return;
    }

    if (topic === topics.guidance) {
      const event = DirectionalGuidanceEventSchema.parse(message);
      requireScenario(event.scenarioId);
      snapshot = { ...snapshot, guidance: event, updatedAt: now() };
      return;
    }

    if (topic.startsWith(topics.routes.replace("+", ""))) {
      const event = RouteCalculationResultEventSchema.parse(message);
      requireScenario(event.result.scenarioId);
      snapshot = { ...snapshot, routeEvent: event, updatedAt: now() };
      return;
    }

    const event = SensorReadingEventSchema.parse(message);
    requireScenario(event.reading.scenarioId);
    const currentReading = readingsBySensor.get(event.reading.sensorId);
    if (!currentReading || event.reading.sequence > currentReading.sequence) {
      readingsBySensor.set(event.reading.sensorId, event.reading);
      snapshot = { ...snapshot, updatedAt: now() };
    }
  }

  client.on("connect", () => {
    client.subscribe(
      [topics.readings, topics.state, topics.routes, topics.layout, topics.guidance],
      { qos: MQTT_QOS },
      (error) => {
        if (error) updateConnection("error", error);
        else updateConnection("connected");
      },
    );
  });
  client.on("reconnect", () => updateConnection("connecting"));
  client.on("offline", () => updateConnection("offline"));
  client.on("error", (error) => updateConnection("error", error));
  client.on("message", (topic, payload) => {
    try {
      applyMessage(topic, payload);
      lastError = null;
    } catch (error) {
      lastError = error;
    }
  });

  function publish(topic, command) {
    if (!client.connected) {
      return Promise.reject(new Error("The dashboard is not connected to MQTT"));
    }
    return new Promise((resolve, reject) => {
      client.publish(
        topic,
        JSON.stringify(command),
        { qos: MQTT_QOS, retain: false },
        (error) => (error ? reject(error) : resolve(command)),
      );
    });
  }

  async function publishSensorControl(input) {
    const sensor = snapshot.sensors.find((item) => item.sensorId === input?.sensorId);
    if (!sensor) throw new Error("Choose a sensor from the current floorplan");

    if (input.action === "resume") {
      const command = ResumeAutomaticSensorCommandSchema.parse({
        messageType: "resume-automatic-sensor",
        commandId: `dashboard-resume-${createCommandId()}`,
        scenarioId,
        sensorId: sensor.sensorId,
        requestedAt: now(),
      });
      return publish(topics.resume, command);
    }

    if (input.action !== "override") {
      throw new Error("Sensor control action must be override or resume");
    }
    const command = ManualSensorOverrideCommandSchema.parse({
      messageType: "manual-sensor-override",
      commandId: `dashboard-manual-${createCommandId()}`,
      scenarioId,
      sensorId: sensor.sensorId,
      sensorType: sensor.type,
      readingValue: input.readingValue,
      requestedAt: now(),
    });
    return publish(topics.manual, command);
  }

  return {
    topics,
    getSnapshot() {
      return copySnapshot(snapshot, readingsBySensor);
    },
    getLastError() {
      return lastError;
    },
    publishSensorControl,
    close() {
      client.end();
    },
  };
}

export function getDashboardMqttStore() {
  if (!globalThis[STORE_SYMBOL]) {
    globalThis[STORE_SYMBOL] = createDashboardMqttStore({
      brokerUrl: env.EVACUVA_LOCAL_MQTT_URL ?? "mqtt://127.0.0.1:1883",
      scenarioId: env.EVACUVA_SCENARIO_ID ?? "scenario-48291",
    });
  }
  return globalThis[STORE_SYMBOL];
}
