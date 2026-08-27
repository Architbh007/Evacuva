import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { AppliedSensorBatchRecordSchema } from "@evacuva/contracts";
import {
  createScenarioStateRecord,
  createScenarioStateVersionRecord,
  restoreScenarioState,
} from "@evacuva/core";

function isStateWriteConflict(error) {
  if (error?.name !== "TransactionCanceledException") {
    return false;
  }

  const cancellationReasons =
    error.CancellationReasons ?? error.cancellationReasons ?? [];
  return cancellationReasons.some((reason) =>
    ["ConditionalCheckFailed", "TransactionConflict"].includes(reason.Code),
  );
}

export function createDynamoStateStore({ documentClient, tableName, now = Date.now }) {
  if (typeof documentClient?.send !== "function") {
    throw new TypeError("State store requires a DynamoDB document client");
  }
  if (typeof tableName !== "string" || tableName.length === 0) {
    throw new TypeError("State store requires a DynamoDB table name");
  }
  if (typeof now !== "function") {
    throw new TypeError("State store requires a clock function");
  }

  return {
    async loadScenarioState(scenarioId) {
      const response = await documentClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { scenarioId, recordKey: "STATE" },
          ConsistentRead: true,
        }),
      );

      if (!response.Item) {
        throw new Error(`No stored state exists for ${scenarioId}`);
      }

      return restoreScenarioState(response.Item);
    },

    async loadAppliedBatch(scenarioId, batchId) {
      const response = await documentClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { scenarioId, recordKey: `BATCH#${batchId}` },
          ConsistentRead: true,
        }),
      );

      return response.Item
        ? AppliedSensorBatchRecordSchema.parse(response.Item)
        : undefined;
    },

    async saveStateUpdate({ batch, previousStateVersion, update }) {
      if (update.state.stateVersion !== previousStateVersion + 1) {
        throw new Error("Stored state version must increase by one");
      }

      const currentStateRecord = createScenarioStateRecord(update.state);
      const versionedStateRecord = createScenarioStateVersionRecord(update.state);
      const appliedBatchRecord = AppliedSensorBatchRecordSchema.parse({
        scenarioId: batch.scenarioId,
        recordKey: `BATCH#${batch.batchId}`,
        batchId: batch.batchId,
        stateVersion: update.state.stateVersion,
        appliedAt: new Date(now()).toISOString(),
      });

      try {
        await documentClient.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: tableName,
                  Item: currentStateRecord,
                  ConditionExpression: "stateVersion = :previousStateVersion",
                  ExpressionAttributeValues: {
                    ":previousStateVersion": previousStateVersion,
                  },
                },
              },
              {
                Put: {
                  TableName: tableName,
                  Item: versionedStateRecord,
                  ConditionExpression:
                    "attribute_not_exists(scenarioId) AND attribute_not_exists(recordKey)",
                },
              },
              {
                Put: {
                  TableName: tableName,
                  Item: appliedBatchRecord,
                  ConditionExpression:
                    "attribute_not_exists(scenarioId) AND attribute_not_exists(recordKey)",
                },
              },
            ],
          }),
        );
      } catch (error) {
        if (isStateWriteConflict(error)) {
          return { status: "conflict" };
        }
        throw error;
      }

      return {
        status: "saved",
        currentStateRecord,
        versionedStateRecord,
        appliedBatchRecord,
      };
    },
  };
}
