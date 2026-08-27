import assert from "node:assert/strict";
import test from "node:test";

import { generateScenario } from "@evacuva/core";

import { createSqsRouteWorker } from "./sqsRouteWorker.js";

const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue";
const SUBMITTED_AT = "2026-08-22T10:20:34.000Z";
const PROCESSING_STARTED_AT = Date.parse("2026-08-22T10:20:34.500Z");
const COMPLETED_AT = Date.parse("2026-08-22T10:20:34.750Z");

function requestedRoute(state, requestOverrides = {}) {
  const occupant = state.occupants[0];
  return {
    messageType: "route-calculation-requested",
    eventId: "route-calculation-requested-worker-test",
    triggeringEventId: "request-worker-test",
    request: {
      requestId: "request-worker-test",
      occupantId: occupant.occupantId,
      scenarioId: state.scenarioId,
      stateVersion: state.stateVersion,
      start: occupant.start,
      priority: "normal",
      submittedAt: SUBMITTED_AT,
      ...requestOverrides,
    },
  };
}

function queuedMessage(event) {
  return {
    MessageId: "message-1",
    ReceiptHandle: "receipt-1",
    Body: JSON.stringify(event),
  };
}

function successfulRouteStore(initialState, events) {
  return {
    async loadRouteResult() {
      events.push("load-result");
      return undefined;
    },
    async loadStateVersion(scenarioId, stateVersion) {
      events.push("load-state");
      assert.equal(scenarioId, initialState.scenarioId);
      assert.equal(stateVersion, initialState.stateVersion);
      return initialState;
    },
    async saveRouteResult({ request, resultEvent }) {
      events.push("save-result");
      assert.equal(request.requestId, "request-worker-test");
      assert.equal(resultEvent.result.validationPassed, true);
      return {
        status: "saved",
        resultRecord: { recordKey: `RESULT#${request.requestId}` },
      };
    },
  };
}

test("a valid message is stored before it is deleted from SQS", async () => {
  const initialState = generateScenario();
  const stateBeforeProcessing = JSON.parse(JSON.stringify(initialState));
  const routeEvent = requestedRoute(initialState);
  const events = [];
  const sqsClient = {
    async send(command) {
      if (command.constructor.name === "ReceiveMessageCommand") {
        events.push("receive-message");
        return { Messages: [queuedMessage(routeEvent)] };
      }
      events.push("delete-message");
      return {};
    },
  };
  const worker = createSqsRouteWorker({
    sqsClient,
    queueUrl: QUEUE_URL,
    routeStore: successfulRouteStore(initialState, events),
    now: (() => {
      const times = [PROCESSING_STARTED_AT, COMPLETED_AT];
      return () => times.shift();
    })(),
  });

  const outcome = await worker.processNextMessage();

  assert.equal(outcome.status, "processed");
  assert.equal(outcome.resultEvent.result.validationPassed, true);
  assert.equal(outcome.resultEvent.result.queueTimeMs, 500);
  assert.equal(outcome.resultEvent.result.totalLatencyMs, 750);
  assert.equal(outcome.resultRecordKey, "RESULT#request-worker-test");
  assert.deepEqual(initialState, stateBeforeProcessing);
  assert.deepEqual(events, [
    "receive-message",
    "load-result",
    "load-state",
    "save-result",
    "delete-message",
  ]);
});

test("an empty receive returns without loading state", async () => {
  const events = [];
  const worker = createSqsRouteWorker({
    sqsClient: {
      async send() {
        events.push("receive-message");
        return {};
      },
    },
    queueUrl: QUEUE_URL,
    routeStore: successfulRouteStore(generateScenario(), events),
  });

  const outcome = await worker.processNextMessage({ waitTimeSeconds: 0 });

  assert.deepEqual(outcome, { status: "empty" });
  assert.deepEqual(events, ["receive-message"]);
});

test("invalid JSON is rejected without loading state or deleting the message", async () => {
  const initialState = generateScenario();
  const events = [];
  const worker = createSqsRouteWorker({
    sqsClient: {
      async send(command) {
        events.push(command.constructor.name);
        return {
          Messages: [
            {
              MessageId: "invalid-message",
              ReceiptHandle: "invalid-receipt",
              Body: "not JSON",
              Attributes: { ApproximateReceiveCount: "2" },
            },
          ],
        };
      },
    },
    queueUrl: QUEUE_URL,
    routeStore: successfulRouteStore(initialState, events),
  });

  const outcome = await worker.processNextMessage({ waitTimeSeconds: 0 });

  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.receiveCount, 2);
  assert.deepEqual(events, ["ReceiveMessageCommand"]);
});

test("a storage failure leaves the SQS message undeleted", async () => {
  const initialState = generateScenario();
  const events = [];
  const routeStore = successfulRouteStore(initialState, events);
  routeStore.saveRouteResult = async () => {
    events.push("save-result");
    throw new Error("DynamoDB write failed");
  };
  const worker = createSqsRouteWorker({
    sqsClient: {
      async send(command) {
        events.push(command.constructor.name);
        return { Messages: [queuedMessage(requestedRoute(initialState))] };
      },
    },
    queueUrl: QUEUE_URL,
    routeStore,
  });

  const outcome = await worker.processNextMessage({ waitTimeSeconds: 0 });

  assert.equal(outcome.status, "rejected");
  assert.match(outcome.reason, /DynamoDB write failed/);
  assert.deepEqual(events, [
    "ReceiveMessageCommand",
    "load-result",
    "load-state",
    "save-result",
  ]);
});

test("a delete failure occurs after the durable update", async () => {
  const initialState = generateScenario();
  const events = [];
  const sqsClient = {
    async send(command) {
      if (command.constructor.name === "ReceiveMessageCommand") {
        events.push("receive-message");
        return { Messages: [queuedMessage(requestedRoute(initialState))] };
      }
      events.push("delete-message");
      throw new Error("SQS delete failed");
    },
  };
  const worker = createSqsRouteWorker({
    sqsClient,
    queueUrl: QUEUE_URL,
    routeStore: successfulRouteStore(initialState, events),
  });

  const outcome = await worker.processNextMessage({ waitTimeSeconds: 0 });

  assert.equal(outcome.status, "rejected");
  assert.match(outcome.reason, /SQS delete failed/);
  assert.deepEqual(events, [
    "receive-message",
    "load-result",
    "load-state",
    "save-result",
    "delete-message",
  ]);
});

test("an existing result makes a repeated SQS delivery safe to delete", async () => {
  const initialState = generateScenario();
  const routeEvent = requestedRoute(initialState);
  const events = [];
  const routeStore = successfulRouteStore(initialState, events);
  routeStore.loadRouteResult = async () => {
    events.push("load-result");
    return {
      recordKey: "RESULT#request-worker-test",
      resultEvent: { result: { stateVersion: initialState.stateVersion } },
    };
  };
  const worker = createSqsRouteWorker({
    sqsClient: {
      async send(command) {
        if (command.constructor.name === "ReceiveMessageCommand") {
          events.push("receive-message");
          return { Messages: [queuedMessage(routeEvent)] };
        }
        events.push("delete-message");
        return {};
      },
    },
    queueUrl: QUEUE_URL,
    routeStore,
  });

  const outcome = await worker.processNextMessage({ waitTimeSeconds: 0 });

  assert.equal(outcome.status, "duplicate");
  assert.equal(outcome.requestId, "request-worker-test");
  assert.equal(outcome.stateVersion, initialState.stateVersion);
  assert.deepEqual(events, ["receive-message", "load-result", "delete-message"]);
});

test("a simultaneous result write is treated as a safe duplicate", async () => {
  const initialState = generateScenario();
  const events = [];
  const routeStore = successfulRouteStore(initialState, events);
  routeStore.saveRouteResult = async () => {
    events.push("save-result");
    return { status: "exists" };
  };
  const worker = createSqsRouteWorker({
    sqsClient: {
      async send(command) {
        if (command.constructor.name === "ReceiveMessageCommand") {
          events.push("receive-message");
          return { Messages: [queuedMessage(requestedRoute(initialState))] };
        }
        events.push("delete-message");
        return {};
      },
    },
    queueUrl: QUEUE_URL,
    routeStore,
  });

  const outcome = await worker.processNextMessage({ waitTimeSeconds: 0 });

  assert.equal(outcome.status, "duplicate");
  assert.equal(outcome.resultRecordKey, "RESULT#request-worker-test");
  assert.deepEqual(events, [
    "receive-message",
    "load-result",
    "load-state",
    "save-result",
    "delete-message",
  ]);
});

test("an occupant position mismatch is rejected without saving or deleting", async () => {
  const initialState = generateScenario();
  const events = [];
  const routeEvent = requestedRoute(initialState, { start: { x: 1, y: 1 } });
  const worker = createSqsRouteWorker({
    sqsClient: {
      async send(command) {
        events.push(command.constructor.name);
        return { Messages: [queuedMessage(routeEvent)] };
      },
    },
    queueUrl: QUEUE_URL,
    routeStore: successfulRouteStore(initialState, events),
  });

  const outcome = await worker.processNextMessage({ waitTimeSeconds: 0 });

  assert.equal(outcome.status, "rejected");
  assert.match(outcome.reason, /does not match the stored occupant position/);
  assert.deepEqual(events, ["ReceiveMessageCommand", "load-result", "load-state"]);
});

test("a missing immutable state leaves the request for SQS retry", async () => {
  const initialState = generateScenario();
  const events = [];
  const routeStore = successfulRouteStore(initialState, events);
  routeStore.loadStateVersion = async () => {
    events.push("load-state");
    throw new Error("No stored state version 1 exists");
  };
  const worker = createSqsRouteWorker({
    sqsClient: {
      async send(command) {
        events.push(command.constructor.name);
        return { Messages: [queuedMessage(requestedRoute(initialState))] };
      },
    },
    queueUrl: QUEUE_URL,
    routeStore,
  });

  const outcome = await worker.processNextMessage({ waitTimeSeconds: 0 });

  assert.equal(outcome.status, "rejected");
  assert.match(outcome.reason, /No stored state version/);
  assert.deepEqual(events, ["ReceiveMessageCommand", "load-result", "load-state"]);
});
