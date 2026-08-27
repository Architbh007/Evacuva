import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { IndependentRouteResultRecordSchema } from "@evacuva/contracts";
import { restoreScenarioStateVersion } from "@evacuva/core";

export function createDynamoRouteStore({ documentClient, tableName, now = Date.now }) {
  if (typeof documentClient?.send !== "function") {
    throw new TypeError("Route store requires a DynamoDB document client");
  }
  if (typeof tableName !== "string" || tableName.length === 0) {
    throw new TypeError("Route store requires a DynamoDB table name");
  }
  if (typeof now !== "function") {
    throw new TypeError("Route store requires a clock function");
  }

  async function getItem(scenarioId, recordKey) {
    const response = await documentClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { scenarioId, recordKey },
        ConsistentRead: true,
      }),
    );
    return response.Item;
  }

  return {
    async loadStateVersion(scenarioId, stateVersion) {
      const item = await getItem(scenarioId, `STATE#${stateVersion}`);
      if (!item) {
        throw new Error(
          `No stored state version ${stateVersion} exists for ${scenarioId}`,
        );
      }
      return restoreScenarioStateVersion(item);
    },

    async loadRouteResult(scenarioId, requestId) {
      const item = await getItem(scenarioId, `RESULT#${requestId}`);
      return item ? IndependentRouteResultRecordSchema.parse(item) : undefined;
    },

    async saveRouteResult({ request, resultEvent }) {
      const resultRecord = IndependentRouteResultRecordSchema.parse({
        scenarioId: request.scenarioId,
        recordKey: `RESULT#${request.requestId}`,
        request,
        resultEvent,
        storedAt: new Date(now()).toISOString(),
      });

      try {
        await documentClient.send(
          new PutCommand({
            TableName: tableName,
            Item: resultRecord,
            ConditionExpression:
              "attribute_not_exists(scenarioId) AND attribute_not_exists(recordKey)",
          }),
        );
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") {
          return { status: "exists" };
        }
        throw error;
      }

      return { status: "saved", resultRecord };
    },
  };
}
