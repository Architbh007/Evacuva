import { DeleteMessageCommand, ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import { SensorReadingBatchEventSchema } from "@evacuva/contracts";
import { advanceBuildingState } from "@evacuva/core";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function createSqsStateCoordinator({
  sqsClient,
  queueUrl,
  stateStore,
  maxStateWriteAttempts = 3,
}) {
  if (typeof sqsClient?.send !== "function") {
    throw new TypeError("State coordinator requires an SQS client");
  }
  if (typeof queueUrl !== "string" || queueUrl.length === 0) {
    throw new TypeError("State coordinator requires an SQS queue URL");
  }
  if (
    typeof stateStore?.loadScenarioState !== "function" ||
    typeof stateStore?.loadAppliedBatch !== "function" ||
    typeof stateStore?.saveStateUpdate !== "function"
  ) {
    throw new TypeError("State coordinator requires a durable state store");
  }
  if (!Number.isInteger(maxStateWriteAttempts) || maxStateWriteAttempts < 1) {
    throw new TypeError("State write attempts must be a positive integer");
  }

  async function deleteMessage(message) {
    await sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }

  return {
    async processNextMessage({ waitTimeSeconds = 10, visibilityTimeout = 30 } = {}) {
      const response = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: waitTimeSeconds,
          VisibilityTimeout: visibilityTimeout,
          MessageSystemAttributeNames: ["ApproximateReceiveCount"],
        }),
      );
      const message = response.Messages?.[0];

      if (!message) {
        return { status: "empty" };
      }

      const receiveCount = Number.parseInt(
        message.Attributes?.ApproximateReceiveCount ?? "1",
        10,
      );

      try {
        if (typeof message.Body !== "string") {
          throw new Error("SQS message body is missing");
        }
        if (typeof message.ReceiptHandle !== "string") {
          throw new Error("SQS message receipt handle is missing");
        }

        const batch = SensorReadingBatchEventSchema.parse(JSON.parse(message.Body));
        const existingBatch = await stateStore.loadAppliedBatch(
          batch.scenarioId,
          batch.batchId,
        );

        if (existingBatch) {
          await deleteMessage(message);
          return {
            status: "duplicate",
            messageId: message.MessageId,
            stateVersion: existingBatch.stateVersion,
            receiveCount,
          };
        }

        for (let attempt = 1; attempt <= maxStateWriteAttempts; attempt += 1) {
          const state = await stateStore.loadScenarioState(batch.scenarioId);
          const update = advanceBuildingState(state, batch);
          const stored = await stateStore.saveStateUpdate({
            batch,
            previousStateVersion: state.stateVersion,
            update,
          });

          if (stored.status === "conflict") {
            const batchAfterConflict = await stateStore.loadAppliedBatch(
              batch.scenarioId,
              batch.batchId,
            );

            if (batchAfterConflict) {
              await deleteMessage(message);
              return {
                status: "duplicate",
                messageId: message.MessageId,
                stateVersion: batchAfterConflict.stateVersion,
                receiveCount,
              };
            }
            continue;
          }

          await deleteMessage(message);
          return {
            status: "processed",
            messageId: message.MessageId,
            stateVersion: stored.versionedStateRecord.stateVersion,
            stateWriteAttempts: attempt,
            receiveCount,
            update,
          };
        }

        return {
          status: "rejected",
          messageId: message.MessageId,
          receiveCount,
          reason: `State update conflicted after ${maxStateWriteAttempts} attempts`,
        };
      } catch (error) {
        return {
          status: "rejected",
          messageId: message.MessageId,
          receiveCount,
          reason: errorMessage(error),
        };
      }
    },
  };
}
