import assert from "node:assert/strict";
import test from "node:test";

import { configureRouteRequestRetryPolicy } from "./sqsRetryPolicy.js";

const SOURCE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/requests";
const FAILURE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/request-failures";
const SOURCE_ARN = "arn:aws:sqs:us-east-1:123456789012:requests";
const FAILURE_ARN = "arn:aws:sqs:us-east-1:123456789012:request-failures";

function recordingSqsClient() {
  const calls = [];
  const queueAttributes = new Map([
    [SOURCE_URL, { QueueArn: SOURCE_ARN }],
    [FAILURE_URL, { QueueArn: FAILURE_ARN, MessageRetentionPeriod: "1209600" }],
  ]);

  return {
    calls,
    async send(command) {
      calls.push(command);
      const { input } = command;

      if (command.constructor.name === "CreateQueueCommand") {
        return { QueueUrl: FAILURE_URL };
      }
      if (command.constructor.name === "SetQueueAttributesCommand") {
        Object.assign(queueAttributes.get(input.QueueUrl), input.Attributes);
        return {};
      }
      const attributes = { ...queueAttributes.get(input.QueueUrl) };

      if (input.AttributeNames.includes("RedrivePolicy") && attributes.RedrivePolicy) {
        const policy = JSON.parse(attributes.RedrivePolicy);
        policy.maxReceiveCount = Number(policy.maxReceiveCount);
        attributes.RedrivePolicy = JSON.stringify(policy);
      }
      return { Attributes: attributes };
    },
  };
}

test("configures one restricted failure queue with three allowed receives", async () => {
  const sqsClient = recordingSqsClient();

  const result = await configureRouteRequestRetryPolicy({
    sqsClient,
    sourceQueueUrl: SOURCE_URL,
    deadLetterQueueName: "request-failures",
    maxReceiveCount: 3,
  });

  assert.deepEqual(result, {
    sourceQueueArn: SOURCE_ARN,
    deadLetterQueueArn: FAILURE_ARN,
    deadLetterQueueUrl: FAILURE_URL,
    maxReceiveCount: 3,
  });

  const setCommands = sqsClient.calls.filter(
    (command) => command.constructor.name === "SetQueueAttributesCommand",
  );
  assert.equal(setCommands.length, 2);
  assert.deepEqual(JSON.parse(setCommands[0].input.Attributes.RedriveAllowPolicy), {
    redrivePermission: "byQueue",
    sourceQueueArns: [SOURCE_ARN],
  });
  assert.deepEqual(JSON.parse(setCommands[1].input.Attributes.RedrivePolicy), {
    deadLetterTargetArn: FAILURE_ARN,
    maxReceiveCount: "3",
  });
});

test("rejects an invalid receive limit before calling SQS", async () => {
  const sqsClient = recordingSqsClient();

  await assert.rejects(
    configureRouteRequestRetryPolicy({
      sqsClient,
      sourceQueueUrl: SOURCE_URL,
      deadLetterQueueName: "request-failures",
      maxReceiveCount: 0,
    }),
    /positive integer/,
  );
  assert.equal(sqsClient.calls.length, 0);
});

test("waits for an applied policy to become visible in SQS", async () => {
  const sqsClient = recordingSqsClient();
  const send = sqsClient.send.bind(sqsClient);
  let sourcePolicyReads = 0;
  let waits = 0;
  sqsClient.send = async (command) => {
    if (
      command.constructor.name === "GetQueueAttributesCommand" &&
      command.input.AttributeNames.includes("RedrivePolicy") &&
      sourcePolicyReads++ === 0
    ) {
      sqsClient.calls.push(command);
      return {
        Attributes: {
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: "arn:aws:sqs:us-east-1:123456789012:old-queue",
            maxReceiveCount: "5",
          }),
        },
      };
    }
    return send(command);
  };

  const result = await configureRouteRequestRetryPolicy({
    sqsClient,
    sourceQueueUrl: SOURCE_URL,
    deadLetterQueueName: "request-failures",
    maxReceiveCount: 3,
    waitForNextVerification: async () => {
      waits += 1;
    },
  });

  assert.equal(result.maxReceiveCount, 3);
  assert.equal(waits, 1);
  assert.equal(sourcePolicyReads, 2);
});
