import process from "node:process";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { createDynamoLoadStateReader } from "./dynamoLoadStateReader.js";
import { createRouteLoadGenerator } from "./routeLoadGenerator.js";

function positiveInteger(value, name, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || (maximum && parsed > maximum)) {
    throw new Error(
      `${name} must be a positive integer${maximum ? ` up to ${maximum}` : ""}`,
    );
  }
  return parsed;
}

const baseUrl = process.env.EVACUVA_REQUEST_SERVICE_URL;
const region = process.env.AWS_REGION ?? "us-east-1";
const scenarioId = process.env.EVACUVA_SCENARIO_ID ?? "scenario-48291";
const tableName = process.env.EVACUVA_ROUTING_TABLE ?? "evacuva-routing-data";

if (!baseUrl) {
  throw new Error("EVACUVA_REQUEST_SERVICE_URL must contain the ALB base URL");
}

const requestCount = positiveInteger(
  process.env.EVACUVA_REQUEST_COUNT ?? "20",
  "EVACUVA_REQUEST_COUNT",
  100,
);
const resultTimeoutMs = positiveInteger(
  process.env.EVACUVA_RESULT_TIMEOUT_MS ?? "30000",
  "EVACUVA_RESULT_TIMEOUT_MS",
);
const pollIntervalMs = positiveInteger(
  process.env.EVACUVA_POLL_INTERVAL_MS ?? "100",
  "EVACUVA_POLL_INTERVAL_MS",
);
const intervalCount = positiveInteger(
  process.env.EVACUVA_INTERVAL_COUNT ?? "1",
  "EVACUVA_INTERVAL_COUNT",
  60,
);
const intervalMs = positiveInteger(
  process.env.EVACUVA_INTERVAL_MS ?? "5000",
  "EVACUVA_INTERVAL_MS",
);
const timestamp = new Date().toISOString().replace(/[^0-9]/g, "");
const runId = `phase-4-6-${requestCount}-${timestamp}`;
const dynamoClient = new DynamoDBClient({ region });
const stateReader = createDynamoLoadStateReader({
  documentClient: DynamoDBDocumentClient.from(dynamoClient),
  tableName,
});
const loadGenerator = createRouteLoadGenerator({ baseUrl });

try {
  const state = await stateReader.loadCurrentState(scenarioId);
  if (intervalCount > 1) {
    process.stdout.write(
      `Starting ${requestCount} requests every ${intervalMs} ms for ${intervalCount} intervals using ${scenarioId} state ${state.stateVersion}.\n`,
    );
    const periodicExperiment = await loadGenerator.runPeriodic({
      state,
      requestCountPerInterval: requestCount,
      intervalCount,
      intervalMs,
      runId,
      resultTimeoutMs,
      pollIntervalMs,
    });

    for (const [index, interval] of periodicExperiment.intervals.entries()) {
      process.stdout.write(
        `Interval ${String(index + 1).padStart(3, "0")} | valid=${interval.validRouteCount} | failed=${interval.failureCount} | p95=${interval.p95LatencyMs ?? "n/a"} ms | max=${interval.maximumLatencyMs ?? "n/a"} ms\n`,
      );
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          runId: periodicExperiment.runId,
          scenarioId: periodicExperiment.scenarioId,
          stateVersion: periodicExperiment.stateVersion,
          requestCountPerInterval: periodicExperiment.requestCountPerInterval,
          intervalCount: periodicExperiment.intervalCount,
          intervalMs: periodicExperiment.intervalMs,
          totalRequestCount: periodicExperiment.totalRequestCount,
          validRouteCount: periodicExperiment.validRouteCount,
          failureCount: periodicExperiment.failureCount,
        },
        null,
        2,
      )}\n`,
    );
    if (periodicExperiment.failureCount > 0) {
      process.exitCode = 1;
    }
  } else {
    process.stdout.write(
      `Starting ${requestCount} requests for ${scenarioId} state ${state.stateVersion}.\n`,
    );
    const experiment = await loadGenerator.runBurst({
      state,
      requestCount,
      runId,
      resultTimeoutMs,
      pollIntervalMs,
    });

    for (const [index, outcome] of experiment.outcomes.entries()) {
      const errorDetail = outcome.error ? ` | ${outcome.error}` : "";
      process.stdout.write(
        `${String(index + 1).padStart(3, "0")} | ${outcome.requestId} | ${outcome.status} | ${outcome.endToEndLatencyMs.toFixed(2)} ms${errorDetail}\n`,
      );
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          runId: experiment.runId,
          scenarioId: experiment.scenarioId,
          stateVersion: experiment.stateVersion,
          requestCount: experiment.requestCount,
          validRouteCount: experiment.validRouteCount,
          failureCount: experiment.failureCount,
          medianLatencyMs: experiment.medianLatencyMs,
          p95LatencyMs: experiment.p95LatencyMs,
          maximumLatencyMs: experiment.maximumLatencyMs,
          twentiethRequest: experiment.twentiethRequest,
          twentiethRequestSlaPassed: experiment.twentiethRequestSlaPassed,
        },
        null,
        2,
      )}\n`,
    );
    if (experiment.failureCount > 0) {
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(`Route load experiment failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  dynamoClient.destroy();
}
