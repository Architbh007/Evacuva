import { RouteCalculationResultEventSchema } from "@evacuva/contracts";

import { calculateSafestRoute } from "../routing/calculateSafestRoute.js";
import { advanceBuildingState } from "./advanceBuildingState.js";

export function applySensorReadingBatch(stateInput, batchInput) {
  const { state: nextState, stateEvent } = advanceBuildingState(stateInput, batchInput);
  const request = {
    requestId: `route-request-${nextState.stateVersion}-${stateEvent.triggeringBatchId}`,
    occupantId: nextState.occupants[0].occupantId,
    scenarioId: nextState.scenarioId,
    stateVersion: nextState.stateVersion,
    start: nextState.occupantStart,
    priority: "normal",
    submittedAt: stateEvent.updatedAt,
  };
  const result = calculateSafestRoute(nextState, request);

  return {
    state: nextState,
    stateEvent,
    resultEvent: RouteCalculationResultEventSchema.parse({
      messageType: "route-calculation-result",
      eventId: `route-calculation-result-${nextState.stateVersion}`,
      completedAt: stateEvent.updatedAt,
      result,
    }),
  };
}
