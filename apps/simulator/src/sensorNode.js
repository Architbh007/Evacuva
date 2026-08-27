import {
  SensorDefinitionSchema,
  SensorReadingEventSchema,
  SensorReadingSchema,
} from "@evacuva/contracts";

function coordinatesMatch(first, second) {
  return first.x === second.x && first.y === second.y;
}

export function createSensorNode(definitionInput, initialReadingInput) {
  const definition = SensorDefinitionSchema.parse(definitionInput);
  let currentReading = SensorReadingSchema.parse(initialReadingInput);
  let automaticReadingValue = currentReading.value;
  let automaticHealthy = currentReading.healthy;
  let mode = "automatic";

  if (
    currentReading.sensorId !== definition.sensorId ||
    currentReading.type !== definition.type ||
    !coordinatesMatch(currentReading.coordinate, definition.coordinate)
  ) {
    throw new Error("Initial reading must match its sensor definition");
  }

  function validateReadingValue(readingValue, healthy = true) {
    return SensorReadingSchema.parse({
      ...currentReading,
      value: readingValue,
      healthy,
    }).value;
  }

  function emitReading(readingValue, timestamp, healthy, readingSource) {
    const sequence = currentReading.sequence + 1;
    const reading = SensorReadingSchema.parse({
      ...currentReading,
      eventId: `${currentReading.scenarioId}-${definition.sensorId}-event-${sequence}`,
      coordinate: definition.coordinate,
      timestamp,
      sequence,
      healthy,
      value: readingValue,
    });
    const event = SensorReadingEventSchema.parse({
      messageType: "sensor-reading",
      readingSource,
      reading,
    });

    currentReading = reading;
    return event;
  }

  function emitAutomaticReading(
    readingValue,
    timestamp = new Date().toISOString(),
    healthy = true,
  ) {
    automaticReadingValue = validateReadingValue(readingValue, healthy);
    automaticHealthy = healthy;

    if (mode === "manual") {
      return null;
    }

    return emitReading(
      automaticReadingValue,
      timestamp,
      automaticHealthy,
      "automatic-simulator",
    );
  }

  function emitManualReading(
    readingValue,
    timestamp = new Date().toISOString(),
    healthy = true,
  ) {
    const validatedValue = validateReadingValue(readingValue, healthy);
    mode = "manual";
    return emitReading(validatedValue, timestamp, healthy, "manual-control");
  }

  function resumeAutomatic() {
    if (mode === "automatic") {
      throw new Error(`Sensor ${definition.sensorId} is already in automatic mode`);
    }

    mode = "automatic";
  }

  function emitCurrentAutomaticReading(timestamp = new Date().toISOString()) {
    if (mode !== "automatic") {
      throw new Error(`Sensor ${definition.sensorId} is still in manual mode`);
    }

    return emitReading(
      automaticReadingValue,
      timestamp,
      automaticHealthy,
      "automatic-simulator",
    );
  }

  return {
    sensorId: definition.sensorId,
    sensorType: definition.type,
    coordinate: Object.freeze({ ...definition.coordinate }),
    validateReadingValue,
    emitAutomaticReading,
    emitCurrentAutomaticReading,
    emitManualReading,
    resumeAutomatic,
    get mode() {
      return mode;
    },
    get sequence() {
      return currentReading.sequence;
    },
  };
}
