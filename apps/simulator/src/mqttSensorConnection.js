import {
  ManualSensorOverrideCommandSchema,
  MQTT_TOPIC_PATTERNS,
  ResumeAutomaticSensorCommandSchema,
  SensorReadingEventSchema,
} from "@evacuva/contracts";
import { connectAsync } from "mqtt";

const MQTT_QOS = 1;

function topicFor(pattern, scenarioId, sensorId) {
  return pattern
    .replace("{scenarioId}", scenarioId)
    .replace("{sensorId}", sensorId ?? "+");
}

function createScenarioTopics(scenarioId) {
  return Object.freeze({
    sensorReadings: topicFor(MQTT_TOPIC_PATTERNS.sensorReadings, scenarioId),
    manualSensorOverrides: topicFor(
      MQTT_TOPIC_PATTERNS.manualSensorOverrides,
      scenarioId,
    ),
    resumeAutomaticSensor: topicFor(
      MQTT_TOPIC_PATTERNS.resumeAutomaticSensor,
      scenarioId,
    ),
  });
}

function parseJsonPayload(payload, topic) {
  try {
    return JSON.parse(payload.toString("utf8"));
  } catch (error) {
    throw new Error(`MQTT message on ${topic} is not valid JSON`, { cause: error });
  }
}

export async function connectSensorSimulatorToMqtt(options) {
  const {
    brokerUrl,
    scenarioId,
    simulator,
    clientId = "evacuva-simulator",
    connectTimeoutMs = 5_000,
    onCommandHandled = () => {},
    onError,
    onManualReading = () => {},
  } = options;

  if (typeof brokerUrl !== "string" || brokerUrl.length === 0) {
    throw new TypeError("MQTT broker URL must be a non-empty string");
  }
  if (typeof scenarioId !== "string" || scenarioId.length === 0) {
    throw new TypeError("MQTT scenario ID must be a non-empty string");
  }
  if (
    !simulator ||
    typeof simulator.applyManualOverride !== "function" ||
    typeof simulator.resumeAutomatic !== "function"
  ) {
    throw new TypeError("MQTT connection requires a sensor simulator");
  }
  if (typeof onError !== "function") {
    throw new TypeError("MQTT connection requires an error callback");
  }

  const topics = createScenarioTopics(scenarioId);
  const handledCommandIds = new Set();
  let client;

  try {
    client = await connectAsync(
      brokerUrl,
      {
        clean: true,
        clientId,
        connectTimeout: connectTimeoutMs,
        protocolVersion: 4,
        reconnectPeriod: 0,
      },
      false,
    );
    await client.subscribeAsync(
      [topics.manualSensorOverrides, topics.resumeAutomaticSensor],
      { qos: MQTT_QOS },
    );
  } catch (error) {
    if (client) {
      await client.endAsync(true);
    }
    throw new Error(`Could not connect to MQTT broker ${brokerUrl}`, {
      cause: error,
    });
  }

  async function publishReading(eventInput) {
    const event = SensorReadingEventSchema.parse(eventInput);
    if (event.reading.scenarioId !== scenarioId) {
      throw new Error("Sensor reading scenario does not match the MQTT connection");
    }

    const topic = topicFor(
      MQTT_TOPIC_PATTERNS.sensorReadings,
      scenarioId,
      event.reading.sensorId,
    );
    await client.publishAsync(topic, JSON.stringify(event), {
      qos: MQTT_QOS,
      retain: false,
    });
    return topic;
  }

  async function handleCommand(topic, payload) {
    const message = parseJsonPayload(payload, topic);
    const command =
      topic === topics.manualSensorOverrides
        ? ManualSensorOverrideCommandSchema.parse(message)
        : ResumeAutomaticSensorCommandSchema.parse(message);

    if (handledCommandIds.has(command.commandId)) {
      onCommandHandled({ command, duplicate: true });
      return;
    }

    if (command.messageType === "manual-sensor-override") {
      const event = simulator.applyManualOverride(command);
      handledCommandIds.add(command.commandId);
      const readingTopic = await publishReading(event);
      onManualReading(event, readingTopic);
    } else {
      simulator.resumeAutomatic(command);
      handledCommandIds.add(command.commandId);
    }

    onCommandHandled({ command, duplicate: false });
  }

  function messageListener(topic, payload) {
    handleCommand(topic, payload).catch((error) => {
      onError(new Error(`MQTT command rejected on ${topic}: ${error.message}`));
    });
  }

  function errorListener(error) {
    onError(new Error(`MQTT client error: ${error.message}`));
  }

  client.on("message", messageListener);
  client.on("error", errorListener);

  return {
    publishReading,
    topics,
    async close() {
      client.off("message", messageListener);
      client.off("error", errorListener);
      await client.endAsync();
    },
    get isConnected() {
      return client.connected;
    },
  };
}
