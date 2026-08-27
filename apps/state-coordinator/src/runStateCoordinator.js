import process from "node:process";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { createDynamoStateStore } from "./dynamoStateStore.js";
import { createSqsStateCoordinator } from "./sqsStateCoordinator.js";

const queueUrl = process.env.EVACUVA_STATE_UPDATE_QUEUE_URL;
const region = process.env.AWS_REGION ?? "us-east-1";
const tableName = process.env.EVACUVA_ROUTING_TABLE ?? "evacuva-routing-data";
const runOnce = process.argv.includes("--once");

if (!queueUrl) {
  throw new Error(
    "EVACUVA_STATE_UPDATE_QUEUE_URL must contain the state-update queue URL",
  );
}

const sqsClient = new SQSClient({ region });
const dynamoClient = new DynamoDBClient({ region });
const stateStore = createDynamoStateStore({
  documentClient: DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: { removeUndefinedValues: true },
  }),
  tableName,
});
const coordinator = createSqsStateCoordinator({
  sqsClient,
  queueUrl,
  stateStore,
});
let shutdownRequested = false;

process.once("SIGINT", () => {
  shutdownRequested = true;
});
process.once("SIGTERM", () => {
  shutdownRequested = true;
});

process.stdout.write(
  `State coordinator listening to ${queueUrl} with state in ${tableName} (${region}).\n`,
);

try {
  while (!shutdownRequested) {
    const outcome = await coordinator.processNextMessage();

    if (outcome.status === "processed") {
      process.stdout.write(
        `Applied ${outcome.messageId} | state=${outcome.stateVersion} | attempts=${outcome.stateWriteAttempts}\n`,
      );
    } else if (outcome.status === "duplicate") {
      process.stdout.write(
        `Deleted duplicate ${outcome.messageId} | state=${outcome.stateVersion}\n`,
      );
    } else if (outcome.status === "rejected") {
      process.stderr.write(
        `Rejected ${outcome.messageId ?? "unknown message"} | receive=${outcome.receiveCount} | ${outcome.reason}\n`,
      );
    } else if (runOnce) {
      process.stdout.write("No state-update message received.\n");
    }

    if (runOnce) {
      break;
    }
  }
} finally {
  sqsClient.destroy();
  dynamoClient.destroy();
}
