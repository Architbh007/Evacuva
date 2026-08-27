import {
  BuildingStateUpdatedEventSchema,
  CurrentBuildingStateSchema,
  SensorReadingBatchEventSchema,
} from "@evacuva/contracts";

function coordinatesMatch(first, second) {
  return first.x === second.x && first.y === second.y;
}

export function advanceBuildingState(stateInput, batchInput) {
  const state = CurrentBuildingStateSchema.parse(stateInput);
  const batch = SensorReadingBatchEventSchema.parse(batchInput);

  if (batch.scenarioId !== state.scenarioId) {
    throw new Error("Sensor batch scenario does not match the building state");
  }

  const sensorsById = new Map(state.sensors.map((sensor) => [sensor.sensorId, sensor]));
  const readingsBySensorId = new Map(
    state.latestReadings.map((reading) => [reading.sensorId, reading]),
  );

  for (const event of batch.readings) {
    const { reading } = event;
    const sensor = sensorsById.get(reading.sensorId);
    const previousReading = readingsBySensorId.get(reading.sensorId);

    if (
      !sensor ||
      sensor.type !== reading.type ||
      !coordinatesMatch(sensor.coordinate, reading.coordinate)
    ) {
      throw new Error(`Reading does not match sensor ${reading.sensorId}`);
    }
    if (reading.sequence <= previousReading.sequence) {
      throw new Error(`Stale reading rejected for ${reading.sensorId}`);
    }

    readingsBySensorId.set(reading.sensorId, reading);
  }

  const previousStateVersion = state.stateVersion;
  const nextState = CurrentBuildingStateSchema.parse({
    ...state,
    stateVersion: previousStateVersion + 1,
    latestReadings: state.sensors.map((sensor) =>
      readingsBySensorId.get(sensor.sensorId),
    ),
    updatedAt: batch.collectedAt,
  });

  return {
    state: nextState,
    stateEvent: BuildingStateUpdatedEventSchema.parse({
      messageType: "building-state-updated",
      eventId: `building-state-updated-${nextState.stateVersion}`,
      triggeringBatchId: batch.batchId,
      scenarioId: nextState.scenarioId,
      appliedReadingCount: batch.readings.length,
      previousStateVersion,
      stateVersion: nextState.stateVersion,
      updatedAt: batch.collectedAt,
    }),
  };
}
