import { DeleteMessageCommand, ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import {
  RouteCalculationRequestedEventSchema,
  RouteCalculationResultEventSchema,
} from "@evacuva/contracts";
import { calculateSafestRoute } from "@evacuva/core";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function validateRequestedOccupant(state, request) {
  const occupant = state.occupants.find(
    (candidate) => candidate.occupantId === request.occupantId,
  );
  if (!occupant) {
    throw new Error("Requested occupant does not exist in the stored state version");
  }
  if (occupant.start.x !== request.start.x || occupant.start.y !== request.start.y) {
    throw new Error("Route request start does not match the stored occupant position");
  }
}

export function createSqsRouteWorker({
  sqsClient,
  queueUrl,
  routeStore,
  now = Date.now,
}) {
  if (typeof sqsClient?.send !== "function") {
    throw new TypeError("Route worker requires an SQS client");
  }
  if (typeof queueUrl !== "string" || queueUrl.length === 0) {
    throw new TypeError("Route worker requires an SQS queue URL");
  }
  if (
    typeof routeStore?.loadStateVersion !== "function" ||
    typeof routeStore?.loadRouteResult !== "function" ||
    typeof routeStore?.saveRouteResult !== "function"
  ) {
    throw new TypeError("Route worker requires a durable route store");
  }
  if (typeof now !== "function") {
    throw new TypeError("Route worker requires a clock function");
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

        const routeEvent = RouteCalculationRequestedEventSchema.parse(
          JSON.parse(message.Body),
        );
        const { request } = routeEvent;
        const processingStartedAt = now();
        const existingResult = await routeStore.loadRouteResult(
          request.scenarioId,
          request.requestId,
        );

        if (existingResult) {
          await deleteMessage(message);
          return {
            status: "duplicate",
            messageId: message.MessageId,
            requestId: request.requestId,
            resultRecordKey: existingResult.recordKey,
            stateVersion: existingResult.resultEvent.result.stateVersion,
            receiveCount,
          };
        }

        const state = await routeStore.loadStateVersion(
          request.scenarioId,
          request.stateVersion,
        );
        validateRequestedOccupant(state, request);

        const calculatedResult = calculateSafestRoute(state, request);
        const completedAt = now();
        const submittedAt = Date.parse(request.submittedAt);
        const queueTimeMs = Math.max(0, processingStartedAt - submittedAt);
        const resultEvent = RouteCalculationResultEventSchema.parse({
          messageType: "route-calculation-result",
          eventId: `route-calculation-result-${request.requestId}`,
          completedAt: new Date(completedAt).toISOString(),
          result: {
            ...calculatedResult,
            queueTimeMs,
            totalLatencyMs: Math.max(0, completedAt - submittedAt),
          },
        });
        const stored = await routeStore.saveRouteResult({ request, resultEvent });

        await deleteMessage(message);
        if (stored.status === "exists") {
          return {
            status: "duplicate",
            messageId: message.MessageId,
            requestId: request.requestId,
            resultRecordKey: `RESULT#${request.requestId}`,
            stateVersion: request.stateVersion,
            receiveCount,
          };
        }

        return {
          status: "processed",
          messageId: message.MessageId,
          requestId: request.requestId,
          resultRecordKey: stored.resultRecord.recordKey,
          stateVersion: request.stateVersion,
          receiveCount,
          resultEvent,
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
