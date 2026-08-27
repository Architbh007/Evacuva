import assert from "node:assert/strict";
import test from "node:test";

import { ensureStateUpdateQueue } from "./stateUpdateQueue.js";

test("state-update queue setup creates and verifies one descriptive queue", async () => {
  const queueUrl =
    "https://sqs.us-east-1.amazonaws.com/123456789012/evacuva-state-updates";
  const commands = [];
  const queue = await ensureStateUpdateQueue({
    sqsClient: {
      async send(command) {
        commands.push(command);
        return command.constructor.name === "CreateQueueCommand"
          ? { QueueUrl: queueUrl }
          : {
              Attributes: {
                QueueArn: "arn:aws:sqs:us-east-1:123456789012:evacuva-state-updates",
                VisibilityTimeout: "30",
                ReceiveMessageWaitTimeSeconds: "10",
              },
            };
      },
    },
  });

  assert.equal(commands[0].input.QueueName, "evacuva-state-updates");
  assert.equal(commands[0].input.Attributes.VisibilityTimeout, "30");
  assert.equal(commands[1].constructor.name, "GetQueueAttributesCommand");
  assert.equal(queue.queueUrl, queueUrl);
  assert.equal(queue.receiveWaitTime, "10");
});

test("state-update queue setup rejects an empty queue name", async () => {
  await assert.rejects(
    () =>
      ensureStateUpdateQueue({
        sqsClient: { async send() {} },
        queueName: "",
      }),
    /non-empty string/,
  );
});
