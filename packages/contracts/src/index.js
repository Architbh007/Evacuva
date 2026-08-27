import { z } from "zod";

export const CoordinateSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});

export const FloorplanConfigurationSchema = z
  .object({
    seed: z.number().int().nonnegative(),
    width: z.literal(100),
    height: z.literal(100),
    roomCount: z.number().int().min(2).max(50),
    exitCount: z.number().int().min(1).max(8),
    minRoomSize: z.number().int().min(3).max(12),
    maxRoomSize: z.number().int().min(4).max(20),
  })
  .superRefine((configuration, context) => {
    if (configuration.maxRoomSize < configuration.minRoomSize) {
      context.addIssue({
        code: "custom",
        message: "maxRoomSize must be at least minRoomSize",
        path: ["maxRoomSize"],
      });
    }
  });

export const DEFAULT_FLOORPLAN_CONFIGURATION = Object.freeze({
  seed: 48_291,
  width: 100,
  height: 100,
  roomCount: 24,
  exitCount: 6,
  minRoomSize: 5,
  maxRoomSize: 14,
});

export const FloorplanCellSchema = z.object({
  coordinate: CoordinateSchema,
  type: z.enum(["wall", "floor", "exit"]),
  roomId: z.string().min(1).optional(),
});

function coordinateKey(coordinate) {
  return `${coordinate.x},${coordinate.y}`;
}

export const FloorplanSchema = z
  .object({
    floorplanId: z.string().min(1),
    configuration: FloorplanConfigurationSchema,
    cells: z.array(FloorplanCellSchema),
    exits: z.array(CoordinateSchema),
  })
  .superRefine((floorplan, context) => {
    const { width, height, exitCount } = floorplan.configuration;
    const expectedCellCount = width * height;

    if (floorplan.cells.length !== expectedCellCount) {
      context.addIssue({
        code: "custom",
        message: `Expected ${expectedCellCount} cells`,
        path: ["cells"],
      });
    }

    const cellsByCoordinate = new Map();
    for (const [index, cell] of floorplan.cells.entries()) {
      if (cell.coordinate.x >= width || cell.coordinate.y >= height) {
        context.addIssue({
          code: "custom",
          message: "Cell coordinate is outside the floorplan",
          path: ["cells", index, "coordinate"],
        });
      }

      const key = coordinateKey(cell.coordinate);
      if (cellsByCoordinate.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate cell coordinate ${key}`,
          path: ["cells", index, "coordinate"],
        });
      }
      cellsByCoordinate.set(key, cell);
    }

    if (floorplan.exits.length !== exitCount) {
      context.addIssue({
        code: "custom",
        message: `Expected ${exitCount} exits`,
        path: ["exits"],
      });
    }

    const uniqueExits = new Set();
    for (const [index, exit] of floorplan.exits.entries()) {
      const key = coordinateKey(exit);
      const onBoundary =
        exit.x === 0 || exit.y === 0 || exit.x === width - 1 || exit.y === height - 1;

      if (!onBoundary) {
        context.addIssue({
          code: "custom",
          message: "Exit must be on the floorplan boundary",
          path: ["exits", index],
        });
      }

      if (uniqueExits.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate exit coordinate ${key}`,
          path: ["exits", index],
        });
      }
      uniqueExits.add(key);

      if (cellsByCoordinate.get(key)?.type !== "exit") {
        context.addIssue({
          code: "custom",
          message: "Exit must reference an exit cell",
          path: ["exits", index],
        });
      }
    }

    const exitCells = floorplan.cells.filter((cell) => cell.type === "exit");
    if (exitCells.length !== exitCount) {
      context.addIssue({
        code: "custom",
        message: `Expected ${exitCount} exit cells`,
        path: ["cells"],
      });
    }
  });

export const DEFAULT_SENSOR_COUNTS = Object.freeze({
  smoke: 12,
  temperature: 12,
  occupancy: 12,
});

export const SensorIdSchema = z
  .string()
  .regex(
    /^(?:(?:smoke|temperature|occupancy)-sensor|exit-door-sensor)-\d{2}$/,
    "Sensor ID must describe its type and use a two-digit number",
  );

function sensorIdMatchesType(sensorId, sensorType) {
  const expectedPrefix =
    sensorType === "door" ? "exit-door-sensor-" : `${sensorType}-sensor-`;
  return sensorId.startsWith(expectedPrefix);
}

export const SensorDefinitionSchema = z
  .object({
    sensorId: SensorIdSchema,
    type: z.enum(["smoke", "temperature", "occupancy", "door"]),
    coordinate: CoordinateSchema,
  })
  .superRefine((sensor, context) => {
    if (!sensorIdMatchesType(sensor.sensorId, sensor.type)) {
      context.addIssue({
        code: "custom",
        message: "Sensor ID must match the sensor type",
        path: ["sensorId"],
      });
    }
  });

const SensorReadingMetadataSchema = z.object({
  eventId: z.string().min(1),
  scenarioId: z.string().min(1),
  sensorId: SensorIdSchema,
  coordinate: CoordinateSchema,
  timestamp: z.string().datetime({ offset: true }),
  sequence: z.number().int().positive(),
  healthy: z.boolean(),
});

export const SensorReadingSchema = z
  .discriminatedUnion("type", [
    SensorReadingMetadataSchema.extend({
      type: z.literal("smoke"),
      value: z.number().nonnegative(),
    }),
    SensorReadingMetadataSchema.extend({
      type: z.literal("temperature"),
      value: z.number().min(-50).max(300),
    }),
    SensorReadingMetadataSchema.extend({
      type: z.literal("occupancy"),
      value: z.number().min(0).max(1),
    }),
    SensorReadingMetadataSchema.extend({
      type: z.literal("door"),
      value: z.object({
        open: z.boolean(),
        obstructed: z.boolean(),
      }),
    }),
  ])
  .superRefine((reading, context) => {
    if (!sensorIdMatchesType(reading.sensorId, reading.type)) {
      context.addIssue({
        code: "custom",
        message: "Sensor ID must match the reading type",
        path: ["sensorId"],
      });
    }
  });

function coordinatesMatch(first, second) {
  return first.x === second.x && first.y === second.y;
}

export const STANDARD_OCCUPANT_COUNT = 10;

export const OccupantIdSchema = z
  .string()
  .regex(/^occupant-\d{2}$/, "Occupant ID must use occupant followed by two digits");

export const OccupantSchema = z.object({
  occupantId: OccupantIdSchema,
  scenarioId: z.string().min(1),
  start: CoordinateSchema,
  startSource: z.enum(["generated", "explicit"]),
});

export const CurrentBuildingStateSchema = z
  .object({
    scenarioId: z.string().min(1),
    stateVersion: z.number().int().positive(),
    floorplan: FloorplanSchema,
    occupantStart: CoordinateSchema,
    occupants: z.array(OccupantSchema).length(STANDARD_OCCUPANT_COUNT),
    sensors: z.array(SensorDefinitionSchema),
    latestReadings: z.array(SensorReadingSchema),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((state, context) => {
    const cellsByCoordinate = new Map(
      state.floorplan.cells.map((cell) => [coordinateKey(cell.coordinate), cell]),
    );
    const startCell = cellsByCoordinate.get(coordinateKey(state.occupantStart));

    if (startCell?.type !== "floor") {
      context.addIssue({
        code: "custom",
        message: "Occupant start must be on a floor cell",
        path: ["occupantStart"],
      });
    }

    const occupantIds = new Set();
    const occupantCoordinates = new Set();

    for (const [index, occupant] of state.occupants.entries()) {
      const occupantCoordinate = coordinateKey(occupant.start);
      const occupantCell = cellsByCoordinate.get(occupantCoordinate);

      if (occupantIds.has(occupant.occupantId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate occupant ID ${occupant.occupantId}`,
          path: ["occupants", index, "occupantId"],
        });
      }
      occupantIds.add(occupant.occupantId);

      if (occupantCoordinates.has(occupantCoordinate)) {
        context.addIssue({
          code: "custom",
          message: `Multiple occupants use coordinate ${occupantCoordinate}`,
          path: ["occupants", index, "start"],
        });
      }
      occupantCoordinates.add(occupantCoordinate);

      if (occupantCell?.type !== "floor") {
        context.addIssue({
          code: "custom",
          message: "Occupant start must be on a floor cell",
          path: ["occupants", index, "start"],
        });
      }

      if (occupant.scenarioId !== state.scenarioId) {
        context.addIssue({
          code: "custom",
          message: "Occupant scenario ID must match the building state",
          path: ["occupants", index, "scenarioId"],
        });
      }
    }

    if (
      state.occupants[0] &&
      !coordinatesMatch(state.occupantStart, state.occupants[0].start)
    ) {
      context.addIssue({
        code: "custom",
        message: "Baseline occupant start must match the first occupant",
        path: ["occupantStart"],
      });
    }

    const sensorCounts = {
      smoke: 0,
      temperature: 0,
      occupancy: 0,
      door: 0,
    };
    const sensorsById = new Map();
    const occupiedCoordinates = new Set();

    for (const [index, sensor] of state.sensors.entries()) {
      const coordinate = coordinateKey(sensor.coordinate);
      const sensorCell = cellsByCoordinate.get(coordinate);
      const requiredCellType = sensor.type === "door" ? "exit" : "floor";

      sensorCounts[sensor.type] += 1;

      if (sensorsById.has(sensor.sensorId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate sensor ID ${sensor.sensorId}`,
          path: ["sensors", index, "sensorId"],
        });
      }
      sensorsById.set(sensor.sensorId, sensor);

      if (occupiedCoordinates.has(coordinate)) {
        context.addIssue({
          code: "custom",
          message: `Multiple sensors use coordinate ${coordinate}`,
          path: ["sensors", index, "coordinate"],
        });
      }
      occupiedCoordinates.add(coordinate);

      if (sensorCell?.type !== requiredCellType) {
        context.addIssue({
          code: "custom",
          message: `${sensor.type} sensor must be on a ${requiredCellType} cell`,
          path: ["sensors", index, "coordinate"],
        });
      }
    }

    for (const type of ["smoke", "temperature", "occupancy"]) {
      if (sensorCounts[type] !== DEFAULT_SENSOR_COUNTS[type]) {
        context.addIssue({
          code: "custom",
          message: `Expected ${DEFAULT_SENSOR_COUNTS[type]} ${type} sensors`,
          path: ["sensors"],
        });
      }
    }

    if (sensorCounts.door !== state.floorplan.configuration.exitCount) {
      context.addIssue({
        code: "custom",
        message: `Expected ${state.floorplan.configuration.exitCount} door sensors`,
        path: ["sensors"],
      });
    }

    if (state.latestReadings.length !== state.sensors.length) {
      context.addIssue({
        code: "custom",
        message: "Expected one latest reading for every sensor",
        path: ["latestReadings"],
      });
    }

    const readingSensorIds = new Set();
    const eventIds = new Set();

    for (const [index, reading] of state.latestReadings.entries()) {
      const sensor = sensorsById.get(reading.sensorId);

      if (readingSensorIds.has(reading.sensorId)) {
        context.addIssue({
          code: "custom",
          message: `Multiple latest readings exist for sensor ${reading.sensorId}`,
          path: ["latestReadings", index, "sensorId"],
        });
      }
      readingSensorIds.add(reading.sensorId);

      if (eventIds.has(reading.eventId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate event ID ${reading.eventId}`,
          path: ["latestReadings", index, "eventId"],
        });
      }
      eventIds.add(reading.eventId);

      if (!sensor) {
        context.addIssue({
          code: "custom",
          message: `Reading references unknown sensor ${reading.sensorId}`,
          path: ["latestReadings", index, "sensorId"],
        });
        continue;
      }

      if (
        reading.type !== sensor.type ||
        !coordinatesMatch(reading.coordinate, sensor.coordinate)
      ) {
        context.addIssue({
          code: "custom",
          message: "Reading type and coordinate must match its sensor",
          path: ["latestReadings", index],
        });
      }

      if (reading.scenarioId !== state.scenarioId) {
        context.addIssue({
          code: "custom",
          message: "Reading scenario ID must match the building state",
          path: ["latestReadings", index, "scenarioId"],
        });
      }
    }

    for (const sensorId of sensorsById.keys()) {
      if (!readingSensorIds.has(sensorId)) {
        context.addIssue({
          code: "custom",
          message: `Missing latest reading for sensor ${sensorId}`,
          path: ["latestReadings"],
        });
      }
    }
  });

const StoredScenarioStateSchema = z.object({
  scenarioId: z.string().min(1),
  stateVersion: z.number().int().positive(),
  floorplanConfiguration: FloorplanConfigurationSchema,
  occupantStart: CoordinateSchema,
  occupants: z.array(OccupantSchema).length(STANDARD_OCCUPANT_COUNT),
  sensors: z.array(SensorDefinitionSchema),
  latestReadings: z.array(SensorReadingSchema),
  updatedAt: z.string().datetime({ offset: true }),
});

export const ScenarioStateRecordSchema = StoredScenarioStateSchema.extend({
  recordKey: z.literal("STATE"),
});

export const ScenarioStateVersionRecordSchema = StoredScenarioStateSchema.extend({
  recordKey: z.string().regex(/^STATE#[1-9]\d*$/),
}).superRefine((record, context) => {
  if (record.recordKey !== `STATE#${record.stateVersion}`) {
    context.addIssue({
      code: "custom",
      message: "Versioned state record key must contain its state version",
      path: ["recordKey"],
    });
  }
});

export const AppliedSensorBatchRecordSchema = z
  .object({
    scenarioId: z.string().min(1),
    recordKey: z.string().regex(/^BATCH#.+$/),
    batchId: z.string().min(1),
    stateVersion: z.number().int().positive(),
    appliedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((record, context) => {
    if (record.recordKey !== `BATCH#${record.batchId}`) {
      context.addIssue({
        code: "custom",
        message: "Applied batch record key must contain its batch ID",
        path: ["recordKey"],
      });
    }
  });

export const SafetyParametersSchema = z
  .object({
    baseMovementCost: z.number().positive(),
    smokeRiskWeight: z.number().nonnegative(),
    smokeInfluenceRadius: z.number().int().nonnegative(),
    criticalSmokeValue: z.number().positive(),
    criticalSmokeBlockRadius: z.number().int().nonnegative(),
    temperatureRiskWeight: z.number().nonnegative(),
    temperatureInfluenceRadius: z.number().int().nonnegative(),
    temperatureRiskBegins: z.number().min(-50).max(300),
    criticalTemperature: z.number().min(-50).max(300),
    criticalTemperatureBlockRadius: z.number().int().nonnegative(),
    congestionRiskWeight: z.number().nonnegative(),
    congestionInfluenceRadius: z.number().int().nonnegative(),
  })
  .superRefine((parameters, context) => {
    if (parameters.criticalTemperature <= parameters.temperatureRiskBegins) {
      context.addIssue({
        code: "custom",
        message: "Critical temperature must be above the temperature risk threshold",
        path: ["criticalTemperature"],
      });
    }
  });

export const DEFAULT_SAFETY_PARAMETERS = Object.freeze({
  baseMovementCost: 1,
  smokeRiskWeight: 12,
  smokeInfluenceRadius: 4,
  criticalSmokeValue: 250,
  criticalSmokeBlockRadius: 1,
  temperatureRiskWeight: 10,
  temperatureInfluenceRadius: 3,
  temperatureRiskBegins: 35,
  criticalTemperature: 80,
  criticalTemperatureBlockRadius: 1,
  congestionRiskWeight: 8,
  congestionInfluenceRadius: 2,
});

export const RouteRequestSchema = z.object({
  requestId: z.string().min(1),
  occupantId: OccupantIdSchema,
  scenarioId: z.string().min(1),
  stateVersion: z.number().int().positive(),
  start: CoordinateSchema,
  priority: z.enum(["normal", "critical"]),
  submittedAt: z.string().datetime({ offset: true }),
});

const RouteResultMetadataSchema = z.object({
  requestId: z.string().min(1),
  scenarioId: z.string().min(1),
  stateVersion: z.number().int().positive(),
  visitedNodeCount: z.number().int().nonnegative(),
  queueTimeMs: z.number().nonnegative(),
  computeTimeMs: z.number().nonnegative(),
  totalLatencyMs: z.number().nonnegative(),
  algorithmVersion: z.string().min(1),
});

export const SuccessfulRouteResultSchema = RouteResultMetadataSchema.extend({
  status: z.literal("success"),
  path: z.array(CoordinateSchema).min(2),
  selectedExit: CoordinateSchema,
  routeCost: z.number().nonnegative(),
  pathLength: z.number().int().positive(),
  validationPassed: z.literal(true),
});

export const FailedRouteResultSchema = RouteResultMetadataSchema.extend({
  status: z.literal("failure"),
  reason: z.enum([
    "invalid_start",
    "blocked_start",
    "all_exits_blocked",
    "unreachable_exit",
  ]),
});

export const RouteResultSchema = z.discriminatedUnion("status", [
  SuccessfulRouteResultSchema,
  FailedRouteResultSchema,
]);

export const SENSOR_UPDATE_INTERVAL_MS = 5_000;

export const MQTT_TOPIC_PATTERNS = Object.freeze({
  sensorReadings: "evacuva/scenarios/{scenarioId}/sensors/{sensorId}/readings",
  sensorReadingBatches: "evacuva/scenarios/{scenarioId}/sensor-reading-batches",
  manualSensorOverrides:
    "evacuva/scenarios/{scenarioId}/sensor-controls/manual-overrides",
  resumeAutomaticSensor:
    "evacuva/scenarios/{scenarioId}/sensor-controls/resume-automatic",
  buildingStateUpdates: "evacuva/scenarios/{scenarioId}/building-state/updates",
  routeRequests: "evacuva/scenarios/{scenarioId}/route-requests",
  routeResults: "evacuva/scenarios/{scenarioId}/route-results/{requestId}",
});

export const SensorReadingEventSchema = z.object({
  messageType: z.literal("sensor-reading"),
  readingSource: z.enum(["automatic-simulator", "manual-control"]),
  reading: SensorReadingSchema,
});

export const SensorReadingBatchEventSchema = z
  .object({
    messageType: z.literal("sensor-reading-batch"),
    batchId: z.string().min(1),
    scenarioId: z.string().min(1),
    batchSource: z.enum(["automatic-interval", "manual-override"]),
    collectedAt: z.string().datetime({ offset: true }),
    readings: z.array(SensorReadingEventSchema).min(1).max(5),
  })
  .superRefine((batch, context) => {
    const expectedReadingCount = batch.batchSource === "automatic-interval" ? 5 : 1;
    const expectedReadingSource =
      batch.batchSource === "automatic-interval"
        ? "automatic-simulator"
        : "manual-control";
    const sensorIds = new Set();

    if (batch.readings.length !== expectedReadingCount) {
      context.addIssue({
        code: "custom",
        message: `${batch.batchSource} batches require ${expectedReadingCount} reading(s)`,
        path: ["readings"],
      });
    }

    for (const [index, event] of batch.readings.entries()) {
      if (event.reading.scenarioId !== batch.scenarioId) {
        context.addIssue({
          code: "custom",
          message: "Reading scenario ID must match its batch",
          path: ["readings", index, "reading", "scenarioId"],
        });
      }
      if (event.reading.timestamp !== batch.collectedAt) {
        context.addIssue({
          code: "custom",
          message: "Reading timestamp must match the batch collection time",
          path: ["readings", index, "reading", "timestamp"],
        });
      }
      if (event.readingSource !== expectedReadingSource) {
        context.addIssue({
          code: "custom",
          message: "Reading source must match its batch source",
          path: ["readings", index, "readingSource"],
        });
      }
      if (sensorIds.has(event.reading.sensorId)) {
        context.addIssue({
          code: "custom",
          message: "A batch cannot contain the same sensor twice",
          path: ["readings", index, "reading", "sensorId"],
        });
      }
      sensorIds.add(event.reading.sensorId);
    }
  });

const ManualSensorOverrideMetadataSchema = z.object({
  messageType: z.literal("manual-sensor-override"),
  commandId: z.string().min(1),
  scenarioId: z.string().min(1),
  sensorId: SensorIdSchema,
  requestedAt: z.string().datetime({ offset: true }),
});

export const ManualSensorOverrideCommandSchema = z
  .discriminatedUnion("sensorType", [
    ManualSensorOverrideMetadataSchema.extend({
      sensorType: z.literal("smoke"),
      readingValue: z.number().nonnegative(),
    }),
    ManualSensorOverrideMetadataSchema.extend({
      sensorType: z.literal("temperature"),
      readingValue: z.number().min(-50).max(300),
    }),
    ManualSensorOverrideMetadataSchema.extend({
      sensorType: z.literal("occupancy"),
      readingValue: z.number().min(0).max(1),
    }),
    ManualSensorOverrideMetadataSchema.extend({
      sensorType: z.literal("door"),
      readingValue: z.object({
        open: z.boolean(),
        obstructed: z.boolean(),
      }),
    }),
  ])
  .superRefine((command, context) => {
    if (!sensorIdMatchesType(command.sensorId, command.sensorType)) {
      context.addIssue({
        code: "custom",
        message: "Sensor ID must match the manual override type",
        path: ["sensorId"],
      });
    }
  });

export const ResumeAutomaticSensorCommandSchema = z.object({
  messageType: z.literal("resume-automatic-sensor"),
  commandId: z.string().min(1),
  scenarioId: z.string().min(1),
  sensorId: SensorIdSchema,
  requestedAt: z.string().datetime({ offset: true }),
});

export const BuildingStateUpdatedEventSchema = z
  .object({
    messageType: z.literal("building-state-updated"),
    eventId: z.string().min(1),
    triggeringBatchId: z.string().min(1),
    scenarioId: z.string().min(1),
    appliedReadingCount: z.number().int().min(1).max(5),
    previousStateVersion: z.number().int().positive(),
    stateVersion: z.number().int().positive(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((event, context) => {
    if (event.stateVersion !== event.previousStateVersion + 1) {
      context.addIssue({
        code: "custom",
        message: "Building state version must increase by one",
        path: ["stateVersion"],
      });
    }
  });

export const RouteCalculationRequestedEventSchema = z.object({
  messageType: z.literal("route-calculation-requested"),
  eventId: z.string().min(1),
  triggeringEventId: z.string().min(1),
  request: RouteRequestSchema,
});

export const RouteCalculationResultEventSchema = z.object({
  messageType: z.literal("route-calculation-result"),
  eventId: z.string().min(1),
  completedAt: z.string().datetime({ offset: true }),
  result: RouteResultSchema,
});

export const IndependentRouteResultRecordSchema = z
  .object({
    scenarioId: z.string().min(1),
    recordKey: z.string().regex(/^RESULT#.+$/),
    request: RouteRequestSchema,
    resultEvent: RouteCalculationResultEventSchema,
    storedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((record, context) => {
    if (record.recordKey !== `RESULT#${record.request.requestId}`) {
      context.addIssue({
        code: "custom",
        message: "Result record key must contain its request ID",
        path: ["recordKey"],
      });
    }
    if (
      record.request.scenarioId !== record.scenarioId ||
      record.resultEvent.result.scenarioId !== record.scenarioId
    ) {
      context.addIssue({
        code: "custom",
        message: "Stored request and result must use the record scenario ID",
        path: ["scenarioId"],
      });
    }
    if (
      record.resultEvent.result.requestId !== record.request.requestId ||
      record.resultEvent.result.stateVersion !== record.request.stateVersion
    ) {
      context.addIssue({
        code: "custom",
        message: "Stored result must match its request and state version",
        path: ["resultEvent", "result"],
      });
    }
  });

export const RouteResultRecordSchema = z
  .object({
    scenarioId: z.string().min(1),
    recordKey: z.string().regex(/^RESULT#.+$/),
    batchId: z.string().min(1),
    stateVersion: z.number().int().positive(),
    sourceBatch: SensorReadingBatchEventSchema,
    resultEvent: RouteCalculationResultEventSchema,
    storedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((record, context) => {
    if (record.recordKey !== `RESULT#${record.batchId}`) {
      context.addIssue({
        code: "custom",
        message: "Result record key must contain its batch ID",
        path: ["recordKey"],
      });
    }
    if (record.sourceBatch.batchId !== record.batchId) {
      context.addIssue({
        code: "custom",
        message: "Source batch ID must match the result record",
        path: ["sourceBatch", "batchId"],
      });
    }
    if (
      record.sourceBatch.scenarioId !== record.scenarioId ||
      record.resultEvent.result.scenarioId !== record.scenarioId
    ) {
      context.addIssue({
        code: "custom",
        message: "Stored batch and result must use the record scenario ID",
        path: ["scenarioId"],
      });
    }
    if (record.resultEvent.result.stateVersion !== record.stateVersion) {
      context.addIssue({
        code: "custom",
        message: "Stored result must use the record state version",
        path: ["stateVersion"],
      });
    }
  });
