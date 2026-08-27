import {
  CurrentBuildingStateSchema,
  DEFAULT_SAFETY_PARAMETERS,
  SafetyParametersSchema,
} from "@evacuva/contracts";

function coordinateKey(coordinate) {
  return `${coordinate.x},${coordinate.y}`;
}

function manhattanDistance(first, second) {
  return Math.abs(first.x - second.x) + Math.abs(first.y - second.y);
}

function falloff(distance, radius) {
  return Math.max(0, 1 - distance / (radius + 1));
}

function applyEnvironmentalReading(safetyCells, reading, parameters) {
  for (const safetyCell of safetyCells.values()) {
    const distance = manhattanDistance(safetyCell.coordinate, reading.coordinate);

    if (reading.type === "smoke") {
      const smokeLevel = Math.min(reading.value / parameters.criticalSmokeValue, 1);
      safetyCell.smokeRisk +=
        parameters.smokeRiskWeight *
        smokeLevel *
        falloff(distance, parameters.smokeInfluenceRadius);

      if (
        reading.value >= parameters.criticalSmokeValue &&
        distance <= parameters.criticalSmokeBlockRadius
      ) {
        safetyCell.blocked = true;
      }
    }

    if (reading.type === "temperature") {
      const temperatureLevel = Math.max(
        0,
        Math.min(
          (reading.value - parameters.temperatureRiskBegins) /
            (parameters.criticalTemperature - parameters.temperatureRiskBegins),
          1,
        ),
      );
      safetyCell.temperatureRisk +=
        parameters.temperatureRiskWeight *
        temperatureLevel *
        falloff(distance, parameters.temperatureInfluenceRadius);

      if (
        reading.value >= parameters.criticalTemperature &&
        distance <= parameters.criticalTemperatureBlockRadius
      ) {
        safetyCell.blocked = true;
      }
    }

    if (reading.type === "occupancy") {
      safetyCell.congestionRisk +=
        parameters.congestionRiskWeight *
        reading.value *
        falloff(distance, parameters.congestionInfluenceRadius);
    }
  }
}

export function buildSafetyMap(stateInput, parameterOverrides = {}) {
  const state = CurrentBuildingStateSchema.parse(stateInput);
  const parameters = SafetyParametersSchema.parse({
    ...DEFAULT_SAFETY_PARAMETERS,
    ...parameterOverrides,
  });
  const safetyCells = new Map(
    state.floorplan.cells
      .filter((cell) => cell.type !== "wall")
      .map((cell) => [
        coordinateKey(cell.coordinate),
        {
          coordinate: cell.coordinate,
          blocked: false,
          smokeRisk: 0,
          temperatureRisk: 0,
          congestionRisk: 0,
          totalRisk: 0,
          movementCost: parameters.baseMovementCost,
        },
      ]),
  );

  for (const reading of state.latestReadings) {
    if (!reading.healthy) {
      continue;
    }

    if (reading.type === "door") {
      if (!reading.value.open || reading.value.obstructed) {
        safetyCells.get(coordinateKey(reading.coordinate)).blocked = true;
      }
      continue;
    }

    applyEnvironmentalReading(safetyCells, reading, parameters);
  }

  for (const safetyCell of safetyCells.values()) {
    safetyCell.totalRisk =
      safetyCell.smokeRisk + safetyCell.temperatureRisk + safetyCell.congestionRisk;
    safetyCell.movementCost = parameters.baseMovementCost + safetyCell.totalRisk;
  }

  const safeExits = state.floorplan.exits.filter(
    (exit) => !safetyCells.get(coordinateKey(exit)).blocked,
  );

  return { safetyCells, safeExits, parameters };
}
