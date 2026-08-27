import process from "node:process";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  IndependentRouteResultRecordSchema,
  RouteCalculationRequestedEventSchema,
} from "@evacuva/contracts";

const queueUrl = process.env.EVACUVA_SQS_QUEUE_URL;
const requestId = process.env.EVACUVA_DUPLICATE_REQUEST_ID;
const region = process.env.AWS_REGION ?? "us-east-1";
const scenarioId = process.env.EVACUVA_SCENARIO_ID ?? "scenario-48291";
const tableName = process.env.EVACUVA_ROUTING_TABLE ?? "evacuva-routing-data";

if (!queueUrl) {
  throw new Error("EVACUVA_SQS_QUEUE_URL must contain the route-request queue URL");
}
if (!requestId) {
  throw new Error("EVACUVA_DUPLICATE_REQUEST_ID must contain a stored request ID");
}

const dynamoClient = new DynamoDBClient({ region });
const documentClient = DynamoDBDocumentClient.from(dynamoClient);
const sqsClient = new SQSClient({ region });

try {
  const response = await documentClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { scenarioId, recordKey: `RESULT#${requestId}` },
      ConsistentRead: true,
    }),
  );

  if (!response.Item) {
    throw new Error(`No stored result exists for ${requestId}`);
  }

  const resultRecord = IndependentRouteResultRecordSchema.parse(response.Item);
  const event = RouteCalculationRequestedEventSchema.parse({
    messageType: "route-calculation-requested",
    eventId: `route-calculation-requested-${requestId}`,
    triggeringEventId: requestId,
    request: resultRecord.request,
  });
  const sent = await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(event),
    }),
  );

  process.stdout.write(
    `Queued duplicate ${requestId} as SQS message ${sent.MessageId}.\n`,
  );
} catch (error) {
  process.stderr.write(`Duplicate-delivery test failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  sqsClient.destroy();
  dynamoClient.destroy();
}
