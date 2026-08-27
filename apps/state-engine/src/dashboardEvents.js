import {
  CurrentBuildingStateSchema,
  DirectionalGuidanceEventSchema,
  FloorplanLayoutEventSchema,
  OccupantIdSchema,
  RouteCalculationResultEventSchema,
} from "@evacuva/contracts";

const CELL_MARKERS = Object.freeze({
  wall: "#",
  floor: ".",
  exit: "E",
});

function coordinateKey(coordinate) {
  return `${coordinate.x},${coordinate.y}`;
}

function directionBetween(first, second) {
  const horizontalChange = second.x - first.x;
  const verticalChange = second.y - first.y;

  if (horizontalChange === 1 && verticalChange === 0) return "east";
  if (horizontalChange === -1 && verticalChange === 0) return "west";
  if (horizontalChange === 0 && verticalChange === 1) return "south";
  if (horizontalChange === 0 && verticalChange === -1) return "north";

  throw new Error("Directional guidance requires adjacent route coordinates");
}

export function createFloorplanLayoutEvent(stateInput) {
  const state = CurrentBuildingStateSchema.parse(stateInput);
  const cellsByCoordinate = new Map(
    state.floorplan.cells.map((cell) => [coordinateKey(cell.coordinate), cell]),
  );
  const { width, height } = state.floorplan.configuration;
  const rows = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const cell = cellsByCoordinate.get(`${x},${y}`);
      return CELL_MARKERS[cell.type];
    }).join(""),
  );

  return FloorplanLayoutEventSchema.parse({
    messageType: "floorplan-layout",
    scenarioId: state.scenarioId,
    stateVersion: state.stateVersion,
    width,
    height,
    rows,
    occupants: state.occupants,
    sensors: state.sensors,
    latestReadings: state.latestReadings,
    publishedAt: state.updatedAt,
  });
}

export function createDirectionalGuidanceEvent(resultEventInput, occupantIdInput) {
  const resultEvent = RouteCalculationResultEventSchema.parse(resultEventInput);
  const occupantId = OccupantIdSchema.parse(occupantIdInput);
  const { result } = resultEvent;
  const metadata = {
    messageType: "directional-guidance",
    eventId: `directional-guidance-${result.requestId}`,
    requestId: result.requestId,
    occupantId,
    scenarioId: result.scenarioId,
    stateVersion: result.stateVersion,
    publishedAt: resultEvent.completedAt,
  };

  if (result.status === "failure") {
    return DirectionalGuidanceEventSchema.parse({
      ...metadata,
      status: "unavailable",
      reason: result.reason,
    });
  }

  return DirectionalGuidanceEventSchema.parse({
    ...metadata,
    status: "success",
    direction: directionBetween(result.path[0], result.path[1]),
    nextCoordinate: result.path[1],
    selectedExit: result.selectedExit,
    remainingSteps: result.pathLength,
  });
}
