import process from "node:process";

import { SQSClient } from "@aws-sdk/client-sqs";

import { configureRouteRequestRetryPolicy } from "./sqsRetryPolicy.js";

const sourceQueueUrl = process.env.EVACUVA_SQS_QUEUE_URL;
const region = process.env.AWS_REGION ?? "us-east-1";
const deadLetterQueueName = "evacuva-route-request-failures";
const maxReceiveCount = 3;

if (!sourceQueueUrl) {
  throw new Error("EVACUVA_SQS_QUEUE_URL must contain the route-request queue URL");
}

const sqsClient = new SQSClient({ region });

try {
  const policy = await configureRouteRequestRetryPolicy({
    sqsClient,
    sourceQueueUrl,
    deadLetterQueueName,
    maxReceiveCount,
  });
  process.stdout.write(
    `Configured ${deadLetterQueueName} for ${policy.sourceQueueArn}.\n`,
  );
  process.stdout.write(
    `Messages move to the failure queue after ${policy.maxReceiveCount} unsuccessful receives.\n`,
  );
  process.stdout.write(`Failure queue URL: ${policy.deadLetterQueueUrl}\n`);
} catch (error) {
  process.stderr.write(`Retry policy setup failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  sqsClient.destroy();
}
