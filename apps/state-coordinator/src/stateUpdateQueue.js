import { CreateQueueCommand, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";

export async function ensureStateUpdateQueue({
  sqsClient,
  queueName = "evacuva-state-updates",
}) {
  if (typeof sqsClient?.send !== "function") {
    throw new TypeError("State-update queue setup requires an SQS client");
  }
  if (typeof queueName !== "string" || queueName.length === 0) {
    throw new TypeError("State-update queue name must be a non-empty string");
  }

  const created = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: queueName,
      Attributes: {
        ReceiveMessageWaitTimeSeconds: "10",
        VisibilityTimeout: "30",
      },
    }),
  );

  if (!created.QueueUrl) {
    throw new Error(`SQS did not return a URL for ${queueName}`);
  }

  const response = await sqsClient.send(
    new GetQueueAttributesCommand({
      QueueUrl: created.QueueUrl,
      AttributeNames: ["QueueArn", "VisibilityTimeout", "ReceiveMessageWaitTimeSeconds"],
    }),
  );

  return {
    queueName,
    queueUrl: created.QueueUrl,
    queueArn: response.Attributes?.QueueArn,
    visibilityTimeout: response.Attributes?.VisibilityTimeout,
    receiveWaitTime: response.Attributes?.ReceiveMessageWaitTimeSeconds,
  };
}
