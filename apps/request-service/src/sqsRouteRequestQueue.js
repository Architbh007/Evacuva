import { SendMessageCommand } from "@aws-sdk/client-sqs";
import {
  RouteCalculationRequestedEventSchema,
  RouteRequestSchema,
} from "@evacuva/contracts";

export function createSqsRouteRequestQueue({ sqsClient, queueUrl }) {
  if (typeof sqsClient?.send !== "function") {
    throw new TypeError("Route request queue requires an SQS client");
  }
  if (typeof queueUrl !== "string" || queueUrl.length === 0) {
    throw new TypeError("Route request queue requires a queue URL");
  }

  return {
    async enqueue(requestInput) {
      const request = RouteRequestSchema.parse(requestInput);
      const event = RouteCalculationRequestedEventSchema.parse({
        messageType: "route-calculation-requested",
        eventId: `route-calculation-requested-${request.requestId}`,
        triggeringEventId: request.requestId,
        request,
      });
      const response = await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(event),
        }),
      );

      return { event, messageId: response.MessageId };
    },
  };
}
