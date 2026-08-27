import process from "node:process";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { createDynamoRouteStore } from "./dynamoRouteStore.js";
import { createSqsRouteWorker } from "./sqsRouteWorker.js";

const queueUrl = process.env.EVACUVA_SQS_QUEUE_URL;
const region = process.env.AWS_REGION ?? "us-east-1";
const tableName = process.env.EVACUVA_ROUTING_TABLE ?? "evacuva-routing-data";
const runOnce = process.argv.includes("--once");

if (!queueUrl) {
  throw new Error("EVACUVA_SQS_QUEUE_URL must contain the route-request queue URL");
}

const sqsClient = new SQSClient({ region });
const dynamoClient = new DynamoDBClient({ region });
const routeStore = createDynamoRouteStore({
  documentClient: DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: { removeUndefinedValues: true },
  }),
  tableName,
});
const worker = createSqsRouteWorker({
  sqsClient,
  queueUrl,
  routeStore,
});
let shutdownRequested = false;

process.once("SIGINT", () => {
  shutdownRequested = true;
});
process.once("SIGTERM", () => {
  shutdownRequested = true;
});

process.stdout.write(
  `Route worker listening to ${queueUrl} with state in ${tableName} (${region}).\n`,
);

try {
  while (!shutdownRequested) {
    const outcome = await worker.processNextMessage();

    if (outcome.status === "processed") {
      const result = outcome.resultEvent.result;
      process.stdout.write(
        `Processed ${outcome.messageId} | request=${outcome.requestId} | state=${result.stateVersion} | result=${outcome.resultRecordKey} | route=${result.status} | queue=${result.queueTimeMs.toFixed(2)} ms | compute=${result.computeTimeMs.toFixed(2)} ms\n`,
      );
    } else if (outcome.status === "duplicate") {
      process.stdout.write(
        `Deleted duplicate ${outcome.messageId} | request=${outcome.requestId} | state=${outcome.stateVersion} | result=${outcome.resultRecordKey}\n`,
      );
    } else if (outcome.status === "rejected") {
      process.stderr.write(
        `Rejected ${outcome.messageId ?? "unknown message"} | receive=${outcome.receiveCount} | ${outcome.reason}\n`,
      );
    } else if (runOnce) {
      process.stdout.write("No queue message received.\n");
    }

    if (runOnce) {
      break;
    }
  }
} finally {
  sqsClient.destroy();
  dynamoClient.destroy();
}
