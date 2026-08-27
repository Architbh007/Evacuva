import process from "node:process";

import { SQSClient } from "@aws-sdk/client-sqs";

import { ensureStateUpdateQueue } from "./stateUpdateQueue.js";

const region = process.env.AWS_REGION ?? "us-east-1";
const queueName = process.env.EVACUVA_STATE_UPDATE_QUEUE ?? "evacuva-state-updates";
const sqsClient = new SQSClient({ region });

try {
  const queue = await ensureStateUpdateQueue({ sqsClient, queueName });

  process.stdout.write(`State-update queue ready: ${queue.queueUrl}\n`);
  process.stdout.write(`Queue ARN: ${queue.queueArn ?? "not returned"}\n`);
  process.stdout.write(
    `Visibility timeout: ${queue.visibilityTimeout}s | long poll: ${queue.receiveWaitTime}s\n`,
  );
} finally {
  sqsClient.destroy();
}
