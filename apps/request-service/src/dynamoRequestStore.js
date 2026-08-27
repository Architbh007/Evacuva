import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { IndependentRouteResultRecordSchema } from "@evacuva/contracts";
import { restoreScenarioStateVersion } from "@evacuva/core";

export function createDynamoRequestStore({ documentClient, tableName }) {
  if (typeof documentClient?.send !== "function") {
    throw new TypeError("Request store requires a DynamoDB document client");
  }
  if (typeof tableName !== "string" || tableName.length === 0) {
    throw new TypeError("Request store requires a DynamoDB table name");
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
      return item ? restoreScenarioStateVersion(item) : undefined;
    },

    async loadRouteResult(scenarioId, requestId) {
      const item = await getItem(scenarioId, `RESULT#${requestId}`);
      return item ? IndependentRouteResultRecordSchema.parse(item) : undefined;
    },
  };
}
