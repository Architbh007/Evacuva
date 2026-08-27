import assert from "node:assert/strict";
import test from "node:test";

import { createSqsRouteRequestQueue } from "./sqsRouteRequestQueue.js";

const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/route-requests";
const REQUEST = {
  requestId: "route-request-state-6-occupant-01",
  occupantId: "occupant-01",
  scenarioId: "scenario-48291",
  stateVersion: 6,
  start: { x: 20, y: 30 },
  priority: "normal",
  submittedAt: "2026-08-22T10:15:00.000Z",
};

test("the route request queue publishes the validated calculation event", async () => {
  const commands = [];
  const queue = createSqsRouteRequestQueue({
    sqsClient: {
      async send(command) {
        commands.push(command);
        return { MessageId: "sqs-message-1" };
      },
    },
    queueUrl: QUEUE_URL,
  });

  const queued = await queue.enqueue(REQUEST);
  const message = JSON.parse(commands[0].input.MessageBody);

  assert.equal(commands[0].constructor.name, "SendMessageCommand");
  assert.equal(commands[0].input.QueueUrl, QUEUE_URL);
  assert.equal(message.messageType, "route-calculation-requested");
  assert.deepEqual(message.request, REQUEST);
  assert.equal(queued.messageId, "sqs-message-1");
});

test("the route request queue rejects an invalid request before calling SQS", async () => {
  let sendCount = 0;
  const queue = createSqsRouteRequestQueue({
    sqsClient: {
      async send() {
        sendCount += 1;
        return {};
      },
    },
    queueUrl: QUEUE_URL,
  });

  await assert.rejects(() => queue.enqueue({ ...REQUEST, stateVersion: 0 }));
  assert.equal(sendCount, 0);
});
