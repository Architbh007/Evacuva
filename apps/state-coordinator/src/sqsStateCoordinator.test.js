import assert from "node:assert/strict";
import test from "node:test";

import { generateScenario } from "@evacuva/core";

import { createSqsStateCoordinator } from "./sqsStateCoordinator.js";

const QUEUE_URL =
  "https://sqs.us-east-1.amazonaws.com/123456789012/evacuva-state-updates";
const BATCH_TIME = "2026-08-22T12:00:00.000Z";

function automaticBatch(state) {
  return {
    messageType: "sensor-reading-batch",
    batchId: "automatic-batch-coordinator-test",
    scenarioId: state.scenarioId,
    batchSource: "automatic-interval",
    collectedAt: BATCH_TIME,
    readings: state.latestReadings.slice(0, 5).map((reading, index) => ({
      messageType: "sensor-reading",
      readingSource: "automatic-simulator",
      reading: {
        ...reading,
        eventId: `${reading.sensorId}-coordinator-event-2`,
        timestamp: BATCH_TIME,
        sequence: 2,
        value: 25 + index * 10,
      },
    })),
  };
}

function queuedMessage(batch) {
  return {
    MessageId: "state-message-1",
    ReceiptHandle: "state-receipt-1",
    Body: JSON.stringify(batch),
  };
}

function successfulStateStore(initialState, events) {
  return {
    async loadAppliedBatch() {
      events.push("load-batch");
      return undefined;
    },
    async loadScenarioState() {
      events.push("load-state");
      return initialState;
    },
    async saveStateUpdate({ previousStateVersion, update }) {
      events.push("save-state");
      assert.equal(previousStateVersion, 1);
      assert.equal(update.state.stateVersion, 2);
      return {
        status: "saved",
        versionedStateRecord: { stateVersion: 2 },
      };
    },
  };
}

test("a valid batch is stored atomically before its SQS message is deleted", async () => {
  const initialState = generateScenario();
  const events = [];
  const coordinator = createSqsStateCoordinator({
    sqsClient: {
      async send(command) {
        if (command.constructor.name === "ReceiveMessageCommand") {
          events.push("receive-message");
          return { Messages: [queuedMessage(automaticBatch(initialState))] };
        }
        events.push("delete-message");
        return {};
      },
    },
    queueUrl: QUEUE_URL,
    stateStore: successfulStateStore(initialState, events),
  });

  const outcome = await coordinator.processNextMessage({ waitTimeSeconds: 0 });

  assert.equal(outcome.status, "processed");
  assert.equal(outcome.stateVersion, 2);
  assert.equal(Object.hasOwn(outcome.update, "resultEvent"), false);
  assert.deepEqual(events, [
    "receive-message",
    "load-batch",
    "load-state",
    "save-state",
    "delete-message",
  ]);
});

test("an applied batch marker makes repeated delivery safe to delete", async () => {
  const initialState = generateScenario();
  const batch = automaticBatch(initialState);
  const events = [];
  const stateStore = successfulStateStore(initialState, events);
  stateStore.loadAppliedBatch = async () => {
    events.push("load-batch");
    return { stateVersion: 2 };
  };
  const coordinator = createSqsStateCoordinator({
    sqsClient: {
      async send(command) {
        if (command.constructor.name === "ReceiveMessageCommand") {
          events.push("receive-message");
          return { Messages: [queuedMessage(batch)] };
        }
        events.push("delete-message");
        return {};
      },
    },
    queueUrl: QUEUE_URL,
    stateStore,
  });

  const outcome = await coordinator.processNextMessage({ waitTimeSeconds: 0 });

  assert.equal(outcome.status, "duplicate");
  assert.equal(outcome.stateVersion, 2);
  assert.deepEqual(events, ["receive-message", "load-batch", "delete-message"]);
});

test("a genuine state conflict reloads state before retrying", async () => {
  const initialState = generateScenario();
  const events = [];
  let saveCount = 0;
  const stateStore = successfulStateStore(initialState, events);
  stateStore.saveStateUpdate = async () => {
    events.push("save-state");
    saveCount += 1;
    return saveCount === 1
      ? { status: "conflict" }
      : { status: "saved", versionedStateRecord: { stateVersion: 2 } };
  };
  const coordinator = createSqsStateCoordinator({
    sqsClient: {
      async send(command) {
        if (command.constructor.name === "ReceiveMessageCommand") {
          events.push("receive-message");
          return { Messages: [queuedMessage(automaticBatch(initialState))] };
        }
        events.push("delete-message");
        return {};
      },
    },
    queueUrl: QUEUE_URL,
    stateStore,
  });

  const outcome = await coordinator.processNextMessage({ waitTimeSeconds: 0 });

  assert.equal(outcome.status, "processed");
  assert.equal(outcome.stateWriteAttempts, 2);
  assert.equal(events.filter((event) => event === "load-state").length, 2);
  assert.equal(events.filter((event) => event === "save-state").length, 2);
});

test("invalid JSON is rejected without loading state or deleting the message", async () => {
  const events = [];
  const coordinator = createSqsStateCoordinator({
    sqsClient: {
      async send(command) {
        events.push(command.constructor.name);
        return {
          Messages: [
            {
              MessageId: "invalid-state-message",
              ReceiptHandle: "invalid-state-receipt",
              Body: "not JSON",
              Attributes: { ApproximateReceiveCount: "2" },
            },
          ],
        };
      },
    },
    queueUrl: QUEUE_URL,
    stateStore: successfulStateStore(generateScenario(), events),
  });

  const outcome = await coordinator.processNextMessage({ waitTimeSeconds: 0 });

  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.receiveCount, 2);
  assert.deepEqual(events, ["ReceiveMessageCommand"]);
});

test("a storage failure leaves the state-update message available for retry", async () => {
  const initialState = generateScenario();
  const events = [];
  const stateStore = successfulStateStore(initialState, events);
  stateStore.saveStateUpdate = async () => {
    events.push("save-state");
    throw new Error("DynamoDB transaction failed");
  };
  const coordinator = createSqsStateCoordinator({
    sqsClient: {
      async send(command) {
        events.push(command.constructor.name);
        return { Messages: [queuedMessage(automaticBatch(initialState))] };
      },
    },
    queueUrl: QUEUE_URL,
    stateStore,
  });

  const outcome = await coordinator.processNextMessage({ waitTimeSeconds: 0 });

  assert.equal(outcome.status, "rejected");
  assert.match(outcome.reason, /DynamoDB transaction failed/);
  assert.equal(events.includes("DeleteMessageCommand"), false);
});
