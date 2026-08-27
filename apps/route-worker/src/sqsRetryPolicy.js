import { setTimeout as waitForPropagation } from "node:timers/promises";

import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";

const DEAD_LETTER_RETENTION_SECONDS = "1209600";
const POLICY_VERIFICATION_ATTEMPTS = 7;
const POLICY_VERIFICATION_INTERVAL_MS = 10000;

function requireText(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

async function loadQueueArn(sqsClient, queueUrl, queueName) {
  const response = await sqsClient.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ["QueueArn"],
    }),
  );
  const queueArn = response.Attributes?.QueueArn;

  if (!queueArn) {
    throw new Error(`${queueName} ARN could not be read from SQS`);
  }
  return queueArn;
}

function parsePolicy(attributes, attributeName, queueName) {
  const policyText = attributes?.[attributeName];

  if (!policyText) {
    throw new Error(`${queueName} ${attributeName} could not be verified`);
  }
  return JSON.parse(policyText);
}

export async function configureRouteRequestRetryPolicy({
  sqsClient,
  sourceQueueUrl,
  deadLetterQueueName,
  maxReceiveCount,
  waitForNextVerification = waitForPropagation,
}) {
  if (typeof sqsClient?.send !== "function") {
    throw new TypeError("Retry policy setup requires an SQS client");
  }
  requireText(sourceQueueUrl, "Source queue URL");
  requireText(deadLetterQueueName, "Dead-letter queue name");
  if (!Number.isInteger(maxReceiveCount) || maxReceiveCount < 1) {
    throw new TypeError("Maximum receive count must be a positive integer");
  }

  const createResponse = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: deadLetterQueueName,
      Attributes: { MessageRetentionPeriod: DEAD_LETTER_RETENTION_SECONDS },
    }),
  );
  const deadLetterQueueUrl = createResponse.QueueUrl;

  if (!deadLetterQueueUrl) {
    throw new Error("Dead-letter queue URL was not returned by SQS");
  }

  const sourceQueueArn = await loadQueueArn(sqsClient, sourceQueueUrl, "Source queue");
  const deadLetterQueueArn = await loadQueueArn(
    sqsClient,
    deadLetterQueueUrl,
    "Dead-letter queue",
  );
  const redriveAllowPolicy = {
    redrivePermission: "byQueue",
    sourceQueueArns: [sourceQueueArn],
  };
  const redrivePolicy = {
    deadLetterTargetArn: deadLetterQueueArn,
    maxReceiveCount: String(maxReceiveCount),
  };

  await sqsClient.send(
    new SetQueueAttributesCommand({
      QueueUrl: deadLetterQueueUrl,
      Attributes: { RedriveAllowPolicy: JSON.stringify(redriveAllowPolicy) },
    }),
  );
  await sqsClient.send(
    new SetQueueAttributesCommand({
      QueueUrl: sourceQueueUrl,
      Attributes: { RedrivePolicy: JSON.stringify(redrivePolicy) },
    }),
  );

  let verificationError;

  for (let attempt = 1; attempt <= POLICY_VERIFICATION_ATTEMPTS; attempt += 1) {
    try {
      const sourceVerification = await sqsClient.send(
        new GetQueueAttributesCommand({
          QueueUrl: sourceQueueUrl,
          AttributeNames: ["RedrivePolicy"],
        }),
      );
      const deadLetterVerification = await sqsClient.send(
        new GetQueueAttributesCommand({
          QueueUrl: deadLetterQueueUrl,
          AttributeNames: ["RedriveAllowPolicy", "MessageRetentionPeriod"],
        }),
      );
      const verifiedRedrivePolicy = parsePolicy(
        sourceVerification.Attributes,
        "RedrivePolicy",
        "Source queue",
      );
      const verifiedAllowPolicy = parsePolicy(
        deadLetterVerification.Attributes,
        "RedriveAllowPolicy",
        "Dead-letter queue",
      );

      if (
        verifiedRedrivePolicy.deadLetterTargetArn !== deadLetterQueueArn ||
        Number(verifiedRedrivePolicy.maxReceiveCount) !== maxReceiveCount
      ) {
        throw new Error(
          `Source queue policy expected ${deadLetterQueueArn} with receive limit ${maxReceiveCount}, but AWS returned ${verifiedRedrivePolicy.deadLetterTargetArn} with receive limit ${verifiedRedrivePolicy.maxReceiveCount}`,
        );
      }
      if (
        verifiedAllowPolicy.redrivePermission !== "byQueue" ||
        !verifiedAllowPolicy.sourceQueueArns?.includes(sourceQueueArn)
      ) {
        throw new Error("Dead-letter queue does not allow the source queue");
      }
      if (
        deadLetterVerification.Attributes?.MessageRetentionPeriod !==
        DEAD_LETTER_RETENTION_SECONDS
      ) {
        throw new Error("Dead-letter queue retention period was not verified");
      }

      verificationError = undefined;
      break;
    } catch (error) {
      verificationError = error;
    }

    if (attempt < POLICY_VERIFICATION_ATTEMPTS) {
      await waitForNextVerification(POLICY_VERIFICATION_INTERVAL_MS);
    }
  }

  if (verificationError) {
    throw verificationError;
  }

  return {
    sourceQueueArn,
    deadLetterQueueArn,
    deadLetterQueueUrl,
    maxReceiveCount,
  };
}
