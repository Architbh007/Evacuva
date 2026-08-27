import process from "node:process";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SensorReadingBatchEventSchema } from "@evacuva/contracts";

import { createDynamoStateStore } from "./dynamoStateStore.js";

const queueUrl = process.env.EVACUVA_STATE_UPDATE_QUEUE_URL;
const region = process.env.AWS_REGION ?? "us-east-1";
const tableName = process.env.EVACUVA_ROUTING_TABLE ?? "evacuva-routing-data";
const scenarioId = process.env.EVACUVA_SCENARIO_ID ?? "scenario-48291";

if (!queueUrl) {
  throw new Error(
    "EVACUVA_STATE_UPDATE_QUEUE_URL must contain the state-update queue URL",
  );
}

const sqsClient = new SQSClient({ region });
const dynamoClient = new DynamoDBClient({ region });
const stateStore = createDynamoStateStore({
  documentClient: DynamoDBDocumentClient.from(dynamoClient),
  tableName,
});

try {
  const state = await stateStore.loadScenarioState(scenarioId);
  const collectedAt = new Date().toISOString();
  const batch = SensorReadingBatchEventSchema.parse({
    messageType: "sensor-reading-batch",
    batchId: `state-test-${collectedAt}`,
    scenarioId,
    batchSource: "automatic-interval",
    collectedAt,
    readings: state.latestReadings.slice(0, 5).map((reading) => ({
      messageType: "sensor-reading",
      readingSource: "automatic-simulator",
      reading: {
        ...reading,
        eventId: `${reading.sensorId}-state-test-${reading.sequence + 1}`,
        timestamp: collectedAt,
        sequence: reading.sequence + 1,
      },
    })),
  });
  const messageIds = [];

  for (let copy = 0; copy < 2; copy += 1) {
    const response = await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(batch),
      }),
    );
    messageIds.push(response.MessageId);
  }

  process.stdout.write(
    `Queued two copies of ${batch.batchId} for state ${state.stateVersion}.\n`,
  );
  process.stdout.write(`SQS messages: ${messageIds.join(", ")}\n`);
} finally {
  sqsClient.destroy();
  dynamoClient.destroy();
}
