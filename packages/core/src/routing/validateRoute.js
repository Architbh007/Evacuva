import {
  CurrentBuildingStateSchema,
  RouteRequestSchema,
  SuccessfulRouteResultSchema,
} from "@evacuva/contracts";

import { buildSafetyMap } from "../safety/buildSafetyMap.js";

function coordinateKey(coordinate) {
  return `${coordinate.x},${coordinate.y}`;
}

function coordinatesMatch(first, second) {
  return first.x === second.x && first.y === second.y;
}

export function validateRoute(
  stateInput,
  requestInput,
  resultInput,
  parameterOverrides = {},
) {
  const stateResult = CurrentBuildingStateSchema.safeParse(stateInput);
  const requestResult = RouteRequestSchema.safeParse(requestInput);
  const routeResult = SuccessfulRouteResultSchema.safeParse(resultInput);
  const errors = [];

  if (!stateResult.success) {
    errors.push("Building state is invalid");
  }
  if (!requestResult.success) {
    errors.push("Route request is invalid");
  }
  if (!routeResult.success) {
    errors.push("Successful route result has an invalid structure");
  }
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const state = stateResult.data;
  const request = requestResult.data;
  const result = routeResult.data;
  const { safetyCells, safeExits } = buildSafetyMap(state, parameterOverrides);

  if (result.requestId !== request.requestId) {
    errors.push("Result request ID does not match the route request");
  }
  if (request.scenarioId !== state.scenarioId || result.scenarioId !== state.scenarioId) {
    errors.push("Route scenario ID does not match the building state");
  }
  if (
    request.stateVersion !== state.stateVersion ||
    result.stateVersion !== state.stateVersion
  ) {
    errors.push("Route state version does not match the building state");
  }
  if (!coordinatesMatch(result.path[0], request.start)) {
    errors.push("Route path does not begin at the requested start");
  }

  const lastCoordinate = result.path[result.path.length - 1];
  if (!coordinatesMatch(lastCoordinate, result.selectedExit)) {
    errors.push("Route path does not end at the selected exit");
  }

  const safeExitKeys = new Set(safeExits.map(coordinateKey));
  if (!safeExitKeys.has(coordinateKey(result.selectedExit))) {
    errors.push("Selected exit is not currently available");
  }

  let calculatedCost = 0;
  for (let index = 0; index < result.path.length; index += 1) {
    const coordinate = result.path[index];
    const safetyCell = safetyCells.get(coordinateKey(coordinate));

    if (!safetyCell || safetyCell.blocked) {
      errors.push(`Path uses blocked or invalid cell ${coordinateKey(coordinate)}`);
      continue;
    }

    if (index > 0) {
      const previous = result.path[index - 1];
      const distance =
        Math.abs(coordinate.x - previous.x) + Math.abs(coordinate.y - previous.y);

      if (distance !== 1) {
        errors.push(`Path contains a disconnected step at index ${index}`);
      }
      calculatedCost += safetyCell.movementCost;
    }
  }

  if (result.pathLength !== result.path.length - 1) {
    errors.push("Reported path length is incorrect");
  }
  if (Math.abs(result.routeCost - calculatedCost) > 1e-9) {
    errors.push("Reported route cost is incorrect");
  }

  return { valid: errors.length === 0, errors };
}
