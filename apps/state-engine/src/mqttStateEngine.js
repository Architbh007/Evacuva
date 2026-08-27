import { MQTT_TOPIC_PATTERNS, SensorReadingBatchEventSchema } from "@evacuva/contracts";
import { applySensorReadingBatch } from "@evacuva/core";
import { connectAsync } from "mqtt";

import {
  createDirectionalGuidanceEvent,
  createFloorplanLayoutEvent,
} from "./dashboardEvents.js";

const MQTT_QOS = 1;

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

export async function connectStateEngineToMqtt(options) {
  const {
    brokerUrl,
    initialState,
    clientId = "evacuva-state-engine",
    onUpdate = () => {},
    onError,
  } = options;

  if (typeof onError !== "function") {
    throw new TypeError("State engine requires an error callback");
  }

  const scenarioId = initialState.scenarioId;
  const topics = Object.freeze({
    readingBatches: scenarioTopic(MQTT_TOPIC_PATTERNS.sensorReadingBatches, scenarioId),
    buildingStateUpdates: scenarioTopic(
      MQTT_TOPIC_PATTERNS.buildingStateUpdates,
      scenarioId,
    ),
    floorplanLayout: scenarioTopic(MQTT_TOPIC_PATTERNS.floorplanLayout, scenarioId),
    directionalGuidance: scenarioTopic(
      MQTT_TOPIC_PATTERNS.directionalGuidance,
      scenarioId,
    ),
  });
  let state = initialState;
  let pendingUpdate = Promise.resolve();
  const client = await connectAsync(
    brokerUrl,
    {
      clean: true,
      clientId,
      connectTimeout: 5_000,
      protocolVersion: 4,
      reconnectPeriod: 0,
    },
    false,
  );

  await client.subscribeAsync(topics.readingBatches, { qos: MQTT_QOS });
  await client.publishAsync(
    topics.floorplanLayout,
    JSON.stringify(createFloorplanLayoutEvent(initialState)),
    { qos: MQTT_QOS, retain: true },
  );

  async function applyAndPublish(topic, payload) {
    const batch = SensorReadingBatchEventSchema.parse(parseMessage(payload, topic));
    const update = applySensorReadingBatch(state, batch);
    const routeResultTopic = scenarioTopic(
      MQTT_TOPIC_PATTERNS.routeResults,
      scenarioId,
      update.resultEvent.result.requestId,
    );
    const guidanceEvent = createDirectionalGuidanceEvent(
      update.resultEvent,
      update.state.occupants[0].occupantId,
    );

    await client.publishAsync(
      topics.buildingStateUpdates,
      JSON.stringify(update.stateEvent),
      { qos: MQTT_QOS, retain: false },
    );
    await client.publishAsync(routeResultTopic, JSON.stringify(update.resultEvent), {
      qos: MQTT_QOS,
      retain: false,
    });
    await client.publishAsync(topics.directionalGuidance, JSON.stringify(guidanceEvent), {
      qos: MQTT_QOS,
      retain: true,
    });

    state = update.state;
    onUpdate({ ...update, routeResultTopic, guidanceEvent });
  }

  function messageListener(topic, payload) {
    pendingUpdate = pendingUpdate
      .then(() => applyAndPublish(topic, payload))
      .catch((error) => onError(new Error(`State update rejected: ${error.message}`)));
  }

  client.on("message", messageListener);

  return {
    topics,
    async close() {
      client.off("message", messageListener);
      await pendingUpdate;
      await client.endAsync();
    },
    get state() {
      return state;
    },
  };
}
