import process from "node:process";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { createDynamoRequestStore } from "./dynamoRequestStore.js";
import { createRequestService } from "./requestService.js";
import { createSqsRouteRequestQueue } from "./sqsRouteRequestQueue.js";

const region = process.env.AWS_REGION ?? "us-east-1";
const tableName = process.env.EVACUVA_ROUTING_TABLE ?? "evacuva-routing-data";
const scenarioId = process.env.EVACUVA_SCENARIO_ID ?? "scenario-48291";
const queueUrl = process.env.EVACUVA_ROUTE_REQUEST_QUEUE_URL;
const port = Number(process.env.PORT ?? 3000);

if (!queueUrl) {
  throw new Error("EVACUVA_ROUTE_REQUEST_QUEUE_URL is required");
}
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const requestStore = createDynamoRequestStore({
  documentClient: DynamoDBDocumentClient.from(new DynamoDBClient({ region })),
  tableName,
});
const requestQueue = createSqsRouteRequestQueue({
  sqsClient: new SQSClient({ region }),
  queueUrl,
});
const server = createRequestService({ requestQueue, requestStore, scenarioId });

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Request service listening on port ${port} for ${scenarioId}.\n`);
});

function stopServer(signal) {
  process.stdout.write(`${signal} received; stopping request service.\n`);
  server.close((error) => {
    if (error) {
      process.stderr.write(`Request service shutdown failed: ${error.message}\n`);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => stopServer("SIGINT"));
process.once("SIGTERM", () => stopServer("SIGTERM"));
