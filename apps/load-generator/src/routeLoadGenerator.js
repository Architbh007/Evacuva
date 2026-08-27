import { setTimeout } from "node:timers";
import { URL } from "node:url";

import {
  CurrentBuildingStateSchema,
  RouteRequestSchema,
  RouteResultSchema,
} from "@evacuva/contracts";

const SLA_LIMIT_MS = 5_000;

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function percentile(values, proportion) {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((first, second) => first - second);
  const index = Math.ceil(proportion * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error(`HTTP ${response.status} returned invalid JSON`);
  }
}

function requestErrorMessage(status, body) {
  return typeof body?.error === "string"
    ? `HTTP ${status}: ${body.error}`
    : `HTTP ${status} returned an unexpected response`;
}

export function createRouteLoadGenerator({
  baseUrl,
  fetchRequest = globalThis.fetch,
  now = Date.now,
  wait = defaultWait,
}) {
  let serviceUrl;
  try {
    serviceUrl = new URL(baseUrl);
  } catch {
    throw new TypeError("Load generator requires a valid request-service URL");
  }
  if (!["http:", "https:"].includes(serviceUrl.protocol)) {
    throw new TypeError("Request-service URL must use HTTP or HTTPS");
  }
  if (typeof fetchRequest !== "function") {
    throw new TypeError("Load generator requires an HTTP fetch function");
  }
  if (typeof now !== "function" || typeof wait !== "function") {
    throw new TypeError("Load generator requires clock and wait functions");
  }

  async function executeRequest(request, { resultTimeoutMs, pollIntervalMs }) {
    const startedAt = Date.parse(request.submittedAt);

    try {
      const submissionResponse = await fetchRequest(
        new URL("/route-requests", serviceUrl),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      const submissionBody = await responseJson(submissionResponse);
      if (submissionResponse.status !== 202) {
        throw new Error(requestErrorMessage(submissionResponse.status, submissionBody));
      }
      if (submissionBody.requestId !== request.requestId) {
        throw new Error("Submission response returned a different request ID");
      }

      const acceptedAt = now();
      const deadline = startedAt + resultTimeoutMs;

      while (now() <= deadline) {
        const resultResponse = await fetchRequest(
          new URL(`/route-results/${encodeURIComponent(request.requestId)}`, serviceUrl),
        );
        const resultBody = await responseJson(resultResponse);

        if (resultResponse.status === 200 && resultBody.status === "complete") {
          const result = RouteResultSchema.parse(resultBody.result);
          if (result.requestId !== request.requestId) {
            throw new Error("Result response returned a different request ID");
          }
          const completedAt = now();
          return {
            requestId: request.requestId,
            occupantId: request.occupantId,
            status: result.status === "success" ? "success" : "route-failure",
            submissionTimeMs: Math.max(0, acceptedAt - startedAt),
            endToEndLatencyMs: Math.max(0, completedAt - startedAt),
            result,
          };
        }
        if (resultResponse.status !== 202 || resultBody.status !== "pending") {
          throw new Error(requestErrorMessage(resultResponse.status, resultBody));
        }

        await wait(pollIntervalMs);
      }

      return {
        requestId: request.requestId,
        occupantId: request.occupantId,
        status: "timeout",
        submissionTimeMs: Math.max(0, acceptedAt - startedAt),
        endToEndLatencyMs: Math.max(0, now() - startedAt),
        error: `Result was not available within ${resultTimeoutMs} ms`,
      };
    } catch (error) {
      return {
        requestId: request.requestId,
        occupantId: request.occupantId,
        status: "request-error",
        endToEndLatencyMs: Math.max(0, now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function runBurst({
    state: stateInput,
    requestCount,
    runId,
    resultTimeoutMs = 30_000,
    pollIntervalMs = 100,
  }) {
    const state = CurrentBuildingStateSchema.parse(stateInput);
    if (!Number.isInteger(requestCount) || requestCount < 1 || requestCount > 100) {
      throw new TypeError("Request count must be an integer from 1 to 100");
    }
    if (typeof runId !== "string" || !/^[A-Za-z0-9-]+$/.test(runId)) {
      throw new TypeError("Run ID must contain only letters, numbers, and hyphens");
    }
    if (!Number.isInteger(resultTimeoutMs) || resultTimeoutMs < 1) {
      throw new TypeError("Result timeout must be a positive integer");
    }
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1) {
      throw new TypeError("Poll interval must be a positive integer");
    }

    const runStartedAt = now();
    const requests = Array.from({ length: requestCount }, (_, index) => {
      const occupant = state.occupants[index % state.occupants.length];
      return RouteRequestSchema.parse({
        requestId: `${runId}-request-${String(index + 1).padStart(3, "0")}`,
        occupantId: occupant.occupantId,
        scenarioId: state.scenarioId,
        stateVersion: state.stateVersion,
        start: occupant.start,
        priority: "normal",
        submittedAt: new Date(now()).toISOString(),
      });
    });
    const outcomes = await Promise.all(
      requests.map((request) =>
        executeRequest(request, { resultTimeoutMs, pollIntervalMs }),
      ),
    );
    const successfulOutcomes = outcomes.filter(
      (outcome) =>
        outcome.status === "success" && outcome.result.validationPassed === true,
    );
    const successfulLatencies = successfulOutcomes.map(
      (outcome) => outcome.endToEndLatencyMs,
    );
    const twentiethRequest = outcomes[19];

    return {
      runId,
      scenarioId: state.scenarioId,
      stateVersion: state.stateVersion,
      requestCount,
      validRouteCount: successfulOutcomes.length,
      failureCount: requestCount - successfulOutcomes.length,
      startedAt: new Date(runStartedAt).toISOString(),
      completedAt: new Date(now()).toISOString(),
      medianLatencyMs: percentile(successfulLatencies, 0.5),
      p95LatencyMs: percentile(successfulLatencies, 0.95),
      maximumLatencyMs:
        successfulLatencies.length > 0 ? Math.max(...successfulLatencies) : undefined,
      twentiethRequest: twentiethRequest
        ? {
            requestId: twentiethRequest.requestId,
            status: twentiethRequest.status,
            endToEndLatencyMs: twentiethRequest.endToEndLatencyMs,
          }
        : undefined,
      twentiethRequestSlaPassed: twentiethRequest
        ? twentiethRequest.status === "success" &&
          twentiethRequest.result.validationPassed === true &&
          twentiethRequest.endToEndLatencyMs <= SLA_LIMIT_MS
        : undefined,
      outcomes,
    };
  }

  return {
    runBurst,

    async runPeriodic({
      state,
      requestCountPerInterval,
      intervalCount,
      intervalMs = 5_000,
      runId,
      resultTimeoutMs = 30_000,
      pollIntervalMs = 100,
    }) {
      if (!Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > 60) {
        throw new TypeError("Interval count must be an integer from 1 to 60");
      }
      if (!Number.isInteger(intervalMs) || intervalMs < 1) {
        throw new TypeError("Interval duration must be a positive integer");
      }

      const pendingIntervals = [];
      for (let index = 0; index < intervalCount; index += 1) {
        if (index > 0) {
          await wait(intervalMs);
        }
        pendingIntervals.push(
          runBurst({
            state,
            requestCount: requestCountPerInterval,
            runId: `${runId}-interval-${String(index + 1).padStart(3, "0")}`,
            resultTimeoutMs,
            pollIntervalMs,
          }),
        );
      }

      const intervals = await Promise.all(pendingIntervals);
      return {
        runId,
        scenarioId: intervals[0].scenarioId,
        stateVersion: intervals[0].stateVersion,
        requestCountPerInterval,
        intervalCount,
        intervalMs,
        totalRequestCount: requestCountPerInterval * intervalCount,
        validRouteCount: intervals.reduce(
          (total, interval) => total + interval.validRouteCount,
          0,
        ),
        failureCount: intervals.reduce(
          (total, interval) => total + interval.failureCount,
          0,
        ),
        intervals,
      };
    },
  };
}
