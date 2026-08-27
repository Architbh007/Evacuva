const EXPECTED_FLOORPLAN_SIZE = 100;

function hasValidLayout(layout) {
  return (
    layout &&
    layout.width === EXPECTED_FLOORPLAN_SIZE &&
    layout.height === EXPECTED_FLOORPLAN_SIZE &&
    Array.isArray(layout.rows) &&
    layout.rows.length === EXPECTED_FLOORPLAN_SIZE &&
    layout.rows.every(
      (row) =>
        typeof row === "string" &&
        row.length === EXPECTED_FLOORPLAN_SIZE &&
        /^[.#E]+$/.test(row),
    )
  );
}

export function normaliseSnapshot(input) {
  if (!input || typeof input !== "object" || !hasValidLayout(input.layout)) {
    throw new Error("Dashboard snapshot does not contain a valid 100 by 100 layout");
  }

  const occupants = Array.isArray(input.occupants) ? [...input.occupants] : [];
  const sensors = Array.isArray(input.sensors) ? [...input.sensors] : [];
  const readings = Array.isArray(input.readings) ? [...input.readings] : [];

  occupants.sort((first, second) => first.occupantId.localeCompare(second.occupantId));
  sensors.sort((first, second) => first.sensorId.localeCompare(second.sensorId));
  readings.sort((first, second) => first.sensorId.localeCompare(second.sensorId));

  return {
    scenarioId: input.scenarioId,
    stateVersion: input.stateVersion,
    updatedAt: input.updatedAt,
    layout: input.layout,
    occupants,
    sensors,
    readings,
    routeEvent: input.routeEvent ?? null,
    guidance: input.guidance ?? null,
  };
}

export function sensorCondition(reading) {
  if (!reading.healthy) return { label: "Unhealthy", className: "unhealthy" };

  if (reading.type === "door") {
    if (!reading.value.open || reading.value.obstructed) {
      return { label: "Blocked", className: "critical" };
    }
    return { label: "Clear", className: "normal" };
  }

  if (
    (reading.type === "smoke" && reading.value >= 250) ||
    (reading.type === "temperature" && reading.value >= 80)
  ) {
    return { label: "Critical", className: "critical" };
  }

  if (
    (reading.type === "smoke" && reading.value >= 125) ||
    (reading.type === "temperature" && reading.value >= 35) ||
    (reading.type === "occupancy" && reading.value >= 0.75)
  ) {
    return { label: "Elevated", className: "elevated" };
  }

  return { label: "Normal", className: "normal" };
}

export function formatSensorValue(reading) {
  if (reading.type === "door") {
    if (reading.value.obstructed) return "Obstructed";
    return reading.value.open ? "Open" : "Closed";
  }
  if (reading.type === "temperature") return `${reading.value.toFixed(1)} °C`;
  if (reading.type === "occupancy") return `${Math.round(reading.value * 100)}%`;
  return reading.value.toFixed(1);
}

export function directionSymbol(direction) {
  return { north: "↑", east: "→", south: "↓", west: "←" }[direction] ?? "·";
}

export function formatTime(timestamp) {
  if (!timestamp) return "—";
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.valueOf())
    ? "—"
    : parsed.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}
