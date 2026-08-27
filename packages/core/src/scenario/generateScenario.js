import {
  CoordinateSchema,
  CurrentBuildingStateSchema,
  DEFAULT_SENSOR_COUNTS,
  STANDARD_OCCUPANT_COUNT,
} from "@evacuva/contracts";

import { generateFloorplan } from "../floorplan/generateFloorplan.js";
import { createSeededRandom, randomInteger } from "../floorplan/seededRandom.js";

const DEFAULT_SIMULATION_TIME = "2026-08-05T00:00:00.000Z";
const ENVIRONMENTAL_SENSOR_TYPES = ["smoke", "temperature", "occupancy"];

function shuffledCoordinates(cells, random) {
  const coordinates = cells.map((cell) => cell.coordinate);

  for (let index = coordinates.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(random, 0, index);
    [coordinates[index], coordinates[swapIndex]] = [
      coordinates[swapIndex],
      coordinates[index],
    ];
  }

  return coordinates;
}

function createEnvironmentalSensors(floorCells, random) {
  const availableCoordinates = shuffledCoordinates(floorCells, random);
  const requiredSensorCount = ENVIRONMENTAL_SENSOR_TYPES.reduce(
    (total, type) => total + DEFAULT_SENSOR_COUNTS[type],
    0,
  );

  if (availableCoordinates.length < requiredSensorCount) {
    throw new Error(
      `Floorplan has ${availableCoordinates.length} floor cells but ${requiredSensorCount} are required for environmental sensors`,
    );
  }

  const sensors = [];
  let coordinateIndex = 0;

  for (const type of ENVIRONMENTAL_SENSOR_TYPES) {
    for (let index = 1; index <= DEFAULT_SENSOR_COUNTS[type]; index += 1) {
      sensors.push({
        sensorId: `${type}-sensor-${String(index).padStart(2, "0")}`,
        type,
        coordinate: availableCoordinates[coordinateIndex],
      });
      coordinateIndex += 1;
    }
  }

  return sensors;
}

function createDoorSensors(exits) {
  return exits.map((coordinate, index) => ({
    sensorId: `exit-door-sensor-${String(index + 1).padStart(2, "0")}`,
    type: "door",
    coordinate,
  }));
}

function initialSensorValue(type) {
  switch (type) {
    case "smoke":
      return 0;
    case "temperature":
      return 22;
    case "occupancy":
      return 0.1;
    default:
      return { open: true, obstructed: false };
  }
}

function createInitialReading(sensor, scenarioId, timestamp) {
  return {
    eventId: `${scenarioId}-${sensor.sensorId}-event-1`,
    scenarioId,
    sensorId: sensor.sensorId,
    type: sensor.type,
    coordinate: sensor.coordinate,
    timestamp,
    sequence: 1,
    healthy: true,
    value: initialSensorValue(sensor.type),
  };
}

function validateOccupantStart(floorCells, requestedStart) {
  const coordinate = CoordinateSchema.parse(requestedStart);
  const matchingCell = floorCells.find(
    (cell) => cell.coordinate.x === coordinate.x && cell.coordinate.y === coordinate.y,
  );

  if (!matchingCell) {
    throw new Error("Occupant start must be on a walkable, non-exit floor cell");
  }

  return coordinate;
}

function createOccupants({
  floorCells,
  scenarioId,
  requestedStart,
  requestedStarts,
  random,
}) {
  if (requestedStart !== undefined && requestedStarts !== undefined) {
    throw new Error("Use occupantStart or occupantStarts, not both");
  }

  if (
    requestedStarts !== undefined &&
    (!Array.isArray(requestedStarts) ||
      requestedStarts.length !== STANDARD_OCCUPANT_COUNT)
  ) {
    throw new Error(
      `occupantStarts must contain exactly ${STANDARD_OCCUPANT_COUNT} coordinates`,
    );
  }

  const explicitStarts = (
    requestedStarts ?? (requestedStart === undefined ? [] : [requestedStart])
  ).map((start) => validateOccupantStart(floorCells, start));
  const starts = [...explicitStarts];

  if (starts.length === 0) {
    starts.push(floorCells[randomInteger(random, 0, floorCells.length - 1)].coordinate);
  }

  const selectedCoordinateKeys = new Set(
    starts.map((coordinate) => `${coordinate.x},${coordinate.y}`),
  );

  if (selectedCoordinateKeys.size !== starts.length) {
    throw new Error("Occupant starts must use distinct coordinates");
  }

  const generatedStarts = shuffledCoordinates(floorCells, random).filter(
    (coordinate) => !selectedCoordinateKeys.has(`${coordinate.x},${coordinate.y}`),
  );
  starts.push(...generatedStarts.slice(0, STANDARD_OCCUPANT_COUNT - starts.length));

  if (starts.length !== STANDARD_OCCUPANT_COUNT) {
    throw new Error(
      `Floorplan requires ${STANDARD_OCCUPANT_COUNT} distinct occupant starts`,
    );
  }

  return starts.map((start, index) => ({
    occupantId: `occupant-${String(index + 1).padStart(2, "0")}`,
    scenarioId,
    start,
    startSource: index < explicitStarts.length ? "explicit" : "generated",
  }));
}

export function generateScenario(options = {}) {
  const {
    occupantStart: requestedStart,
    occupantStarts: requestedStarts,
    timestamp = DEFAULT_SIMULATION_TIME,
    ...configurationOverrides
  } = options;
  const floorplan = generateFloorplan(configurationOverrides);
  const random = createSeededRandom(floorplan.configuration.seed);
  const floorCells = floorplan.cells.filter((cell) => cell.type === "floor");
  const sensors = [
    ...createEnvironmentalSensors(floorCells, random),
    ...createDoorSensors(floorplan.exits),
  ];
  const scenarioId = `scenario-${floorplan.configuration.seed}`;
  const occupants = createOccupants({
    floorCells,
    scenarioId,
    requestedStart,
    requestedStarts,
    random,
  });
  const latestReadings = sensors.map((sensor) =>
    createInitialReading(sensor, scenarioId, timestamp),
  );

  return CurrentBuildingStateSchema.parse({
    scenarioId,
    stateVersion: 1,
    floorplan,
    occupantStart: occupants[0].start,
    occupants,
    sensors,
    latestReadings,
    updatedAt: timestamp,
  });
}
