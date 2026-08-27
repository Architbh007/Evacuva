import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { restoreScenarioState } from "@evacuva/core";

export function createDynamoLoadStateReader({ documentClient, tableName }) {
  if (typeof documentClient?.send !== "function") {
    throw new TypeError("Load-state reader requires a DynamoDB document client");
  }
  if (typeof tableName !== "string" || tableName.length === 0) {
    throw new TypeError("Load-state reader requires a DynamoDB table name");
  }

  return {
    async loadCurrentState(scenarioId) {
      const response = await documentClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { scenarioId, recordKey: "STATE" },
          ConsistentRead: true,
        }),
      );

      if (!response.Item) {
        throw new Error(`No current state exists for ${scenarioId}`);
      }
      return restoreScenarioState(response.Item);
    },
  };
}
