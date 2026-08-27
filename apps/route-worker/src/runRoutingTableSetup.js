import process from "node:process";
import { Buffer } from "node:buffer";

import {
  CreateTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  createScenarioStateRecord,
  generateScenario,
  restoreScenarioState,
} from "@evacuva/core";

const region = process.env.AWS_REGION ?? "us-east-1";
const tableName = process.env.EVACUVA_ROUTING_TABLE ?? "evacuva-routing-data";
const dynamoClient = new DynamoDBClient({ region });
const documentClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

async function createTableIfMissing() {
  try {
    await dynamoClient.send(
      new CreateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [
          { AttributeName: "scenarioId", AttributeType: "S" },
          { AttributeName: "recordKey", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "scenarioId", KeyType: "HASH" },
          { AttributeName: "recordKey", KeyType: "RANGE" },
        ],
        BillingMode: "PAY_PER_REQUEST",
      }),
    );
    process.stdout.write(`Created DynamoDB table ${tableName}.\n`);
  } catch (error) {
    if (error?.name !== "ResourceInUseException") {
      throw error;
    }
    process.stdout.write(`Using existing DynamoDB table ${tableName}.\n`);
  }

  await waitUntilTableExists(
    { client: dynamoClient, maxWaitTime: 60 },
    { TableName: tableName },
  );
}

async function seedInitialState() {
  try {
    await documentClient.send(
      new PutCommand({
        TableName: tableName,
        Item: createScenarioStateRecord(generateScenario()),
        ConditionExpression:
          "attribute_not_exists(scenarioId) AND attribute_not_exists(recordKey)",
      }),
    );
    process.stdout.write("Stored initial state for scenario-48291.\n");
  } catch (error) {
    if (error?.name !== "ConditionalCheckFailedException") {
      throw error;
    }
    process.stdout.write("Initial state for scenario-48291 already exists.\n");
  }
}

function coordinatesMatch(first, second) {
  return first.x === second.x && first.y === second.y;
}

function occupantsForStoredState(record) {
  const generatedState = generateScenario({
    ...record.floorplanConfiguration,
    timestamp: record.updatedAt,
  });

  if (coordinatesMatch(generatedState.occupantStart, record.occupantStart)) {
    return generatedState.occupants;
  }

  return generateScenario({
    ...record.floorplanConfiguration,
    occupantStart: record.occupantStart,
    timestamp: record.updatedAt,
  }).occupants;
}

async function migrateLegacyStateRecord(record) {
  if (Array.isArray(record.occupants)) {
    return record;
  }

  const response = await documentClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { scenarioId: record.scenarioId, recordKey: "STATE" },
      UpdateExpression: "SET occupants = :occupants",
      ConditionExpression:
        "stateVersion = :expectedStateVersion AND attribute_not_exists(occupants)",
      ExpressionAttributeValues: {
        ":expectedStateVersion": record.stateVersion,
        ":occupants": occupantsForStoredState(record),
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  process.stdout.write(
    `Added ten occupants to ${record.scenarioId} STATE without changing version ${record.stateVersion}.\n`,
  );
  return response.Attributes;
}

async function verifyStoredState() {
  const response = await documentClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { scenarioId: "scenario-48291", recordKey: "STATE" },
      ConsistentRead: true,
    }),
  );

  if (!response.Item) {
    throw new Error("Initial scenario state could not be read back from DynamoDB");
  }

  const currentRecord = await migrateLegacyStateRecord(response.Item);
  const state = restoreScenarioState(currentRecord);
  const recordSize = Buffer.byteLength(JSON.stringify(currentRecord));
  process.stdout.write(
    `Verified ${state.scenarioId} STATE | version=${state.stateVersion} | sensors=${state.sensors.length} | serialized=${recordSize} bytes.\n`,
  );
}

try {
  await createTableIfMissing();
  await seedInitialState();
  await verifyStoredState();
} catch (error) {
  process.stderr.write(`Routing table setup failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  dynamoClient.destroy();
}
