import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import process from "node:process";
import { URL } from "node:url";

import { RouteRequestSchema } from "@evacuva/contracts";

const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;

class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

function sendJson(response, statusCode, body) {
  const serializedBody = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serializedBody),
  });
  response.end(serializedBody);
}

async function readJsonBody(request, bodyLimitBytes) {
  const chunks = [];
  let byteCount = 0;

  for await (const chunk of request) {
    byteCount += chunk.length;
    if (byteCount > bodyLimitBytes) {
      throw new HttpError(413, "Request body is too large");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must contain valid JSON");
  }
}

function validateRequestAgainstState(routeRequest, state) {
  const occupant = state.occupants.find(
    (candidate) => candidate.occupantId === routeRequest.occupantId,
  );

  if (!occupant) {
    throw new HttpError(400, "Occupant does not exist in the requested state version");
  }
  if (
    occupant.start.x !== routeRequest.start.x ||
    occupant.start.y !== routeRequest.start.y
  ) {
    throw new HttpError(400, "Request start must match the occupant start position");
  }
}

function resultRequestId(pathname) {
  const match = pathname.match(/^\/route-results\/([^/]+)$/);
  if (!match) {
    return undefined;
  }

  try {
    const requestId = decodeURIComponent(match[1]);
    return requestId.length > 0 ? requestId : undefined;
  } catch {
    throw new HttpError(400, "Result request ID is not valid");
  }
}

export function createRequestService({
  requestQueue,
  requestStore,
  scenarioId,
  bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES,
}) {
  if (typeof requestQueue?.enqueue !== "function") {
    throw new TypeError("Request service requires a route request queue");
  }
  if (
    typeof requestStore?.loadStateVersion !== "function" ||
    typeof requestStore?.loadRouteResult !== "function"
  ) {
    throw new TypeError("Request service requires a request store");
  }
  if (typeof scenarioId !== "string" || scenarioId.length === 0) {
    throw new TypeError("Request service requires a scenario ID");
  }
  if (!Number.isInteger(bodyLimitBytes) || bodyLimitBytes <= 0) {
    throw new TypeError("Request body limit must be a positive integer");
  }

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { status: "healthy", service: "request-service" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/route-requests") {
        const parsedRequest = RouteRequestSchema.safeParse(
          await readJsonBody(request, bodyLimitBytes),
        );
        if (!parsedRequest.success) {
          throw new HttpError(
            400,
            "Route request is invalid",
            parsedRequest.error.issues,
          );
        }

        const routeRequest = parsedRequest.data;
        if (routeRequest.scenarioId !== scenarioId) {
          throw new HttpError(400, `Only scenario ${scenarioId} is available`);
        }

        const state = await requestStore.loadStateVersion(
          routeRequest.scenarioId,
          routeRequest.stateVersion,
        );
        if (!state) {
          throw new HttpError(404, "Requested state version does not exist");
        }

        validateRequestAgainstState(routeRequest, state);
        await requestQueue.enqueue(routeRequest);
        sendJson(response, 202, {
          status: "queued",
          requestId: routeRequest.requestId,
          stateVersion: routeRequest.stateVersion,
        });
        return;
      }

      const requestId =
        request.method === "GET" ? resultRequestId(url.pathname) : undefined;
      if (requestId) {
        const resultRecord = await requestStore.loadRouteResult(scenarioId, requestId);
        if (!resultRecord) {
          sendJson(response, 202, { status: "pending", requestId });
          return;
        }

        sendJson(response, 200, {
          status: "complete",
          requestId,
          result: resultRecord.resultEvent.result,
        });
        return;
      }

      sendJson(response, 404, { error: "Endpoint not found" });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.statusCode, {
          error: error.message,
          ...(error.details ? { details: error.details } : {}),
        });
        return;
      }

      process.stderr.write(`Request service failed: ${error.message}\n`);
      sendJson(response, 500, { error: "Request could not be completed" });
    }
  });
}
