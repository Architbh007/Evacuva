/* global document, fetch, window */

import {
  directionSymbol,
  formatSensorValue,
  formatTime,
  normaliseSnapshot,
  sensorCondition,
} from "./dashboardModel.js";

const REFRESH_INTERVAL_MS = 1_000;
const MAP_SIZE = 100;
const SENSOR_COLOURS = Object.freeze({
  smoke: "#d44f4f",
  temperature: "#e08432",
  occupancy: "#247db4",
  door: "#16865c",
});

const elements = Object.freeze({
  canvas: document.querySelector("#floorplan-canvas"),
  mapPlaceholder: document.querySelector("#map-placeholder"),
  connectionDot: document.querySelector("#connection-dot"),
  connectionLabel: document.querySelector("#connection-label"),
  scenarioId: document.querySelector("#scenario-id"),
  stateVersion: document.querySelector("#state-version"),
  readingCount: document.querySelector("#reading-count"),
  lastUpdate: document.querySelector("#last-update"),
  occupantSelect: document.querySelector("#occupant-select"),
  selectedOccupant: document.querySelector("#selected-occupant"),
  occupantPosition: document.querySelector("#occupant-position"),
  occupantSource: document.querySelector("#occupant-source"),
  directionIcon: document.querySelector("#direction-icon"),
  guidanceTitle: document.querySelector("#guidance-title"),
  guidanceDetail: document.querySelector("#guidance-detail"),
  routeStatus: document.querySelector("#route-status"),
  routeLength: document.querySelector("#route-length"),
  routeCost: document.querySelector("#route-cost"),
  routeExit: document.querySelector("#route-exit"),
  routeLatency: document.querySelector("#route-latency"),
  sensorFilter: document.querySelector("#sensor-filter"),
  sensorTableBody: document.querySelector("#sensor-table-body"),
});

let currentSnapshot = null;
let selectedOccupantId = "occupant-01";

function mapPoint(coordinate, cellSize) {
  return {
    x: (coordinate.x + 0.5) * cellSize,
    y: (coordinate.y + 0.5) * cellSize,
  };
}

function drawFloorplan(snapshot) {
  const context = elements.canvas.getContext("2d");
  const cellSize = elements.canvas.width / MAP_SIZE;
  const cellColours = { "#": "#26303f", ".": "#f1f5f2", E: "#2dbf78" };

  context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  for (let y = 0; y < MAP_SIZE; y += 1) {
    for (let x = 0; x < MAP_SIZE; x += 1) {
      context.fillStyle = cellColours[snapshot.layout.rows[y][x]];
      context.fillRect(x * cellSize, y * cellSize, cellSize + 0.25, cellSize + 0.25);
    }
  }

  const result = snapshot.routeEvent?.result;
  if (result?.status === "success") {
    context.beginPath();
    result.path.forEach((coordinate, index) => {
      const point = mapPoint(coordinate, cellSize);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.strokeStyle = "#f4b942";
    context.lineWidth = Math.max(3, cellSize * 0.55);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
  }

  const readingsBySensor = new Map(
    snapshot.readings.map((reading) => [reading.sensorId, reading]),
  );
  for (const sensor of snapshot.sensors) {
    const point = mapPoint(sensor.coordinate, cellSize);
    const condition = readingsBySensor.has(sensor.sensorId)
      ? sensorCondition(readingsBySensor.get(sensor.sensorId))
      : { className: "normal" };
    context.beginPath();
    context.arc(point.x, point.y, Math.max(2.2, cellSize * 0.3), 0, Math.PI * 2);
    context.fillStyle = SENSOR_COLOURS[sensor.type];
    context.fill();
    if (condition.className === "critical") {
      context.lineWidth = 2;
      context.strokeStyle = "#8d2020";
      context.stroke();
    }
  }

  for (const occupant of snapshot.occupants) {
    const point = mapPoint(occupant.start, cellSize);
    const selected = occupant.occupantId === selectedOccupantId;
    context.beginPath();
    context.arc(
      point.x,
      point.y,
      selected ? cellSize * 0.8 : cellSize * 0.52,
      0,
      Math.PI * 2,
    );
    context.fillStyle = selected ? "#7048c8" : "#aa98d8";
    context.fill();
    context.lineWidth = selected ? 3 : 1.5;
    context.strokeStyle = "#ffffff";
    context.stroke();
  }
}

function renderOccupant(snapshot) {
  const existingIds = Array.from(elements.occupantSelect.options).map(
    (option) => option.value,
  );
  const nextIds = snapshot.occupants.map((occupant) => occupant.occupantId);

  if (existingIds.join("|") !== nextIds.join("|")) {
    elements.occupantSelect.replaceChildren(
      ...snapshot.occupants.map((occupant) => {
        const option = document.createElement("option");
        option.value = occupant.occupantId;
        option.textContent = occupant.occupantId;
        return option;
      }),
    );
    elements.occupantSelect.disabled = false;
  }

  if (!nextIds.includes(selectedOccupantId)) selectedOccupantId = nextIds[0];
  elements.occupantSelect.value = selectedOccupantId;
  const occupant = snapshot.occupants.find(
    (candidate) => candidate.occupantId === selectedOccupantId,
  );
  if (!occupant) return;

  elements.selectedOccupant.textContent = occupant.occupantId;
  elements.occupantPosition.textContent = `Coordinate (${occupant.start.x}, ${occupant.start.y})`;
  elements.occupantSource.textContent =
    occupant.startSource === "generated"
      ? "Randomly placed on a walkable cell for this scenario."
      : "Placed at an explicitly selected walkable coordinate.";
}

function renderGuidance(guidance) {
  if (!guidance) return;

  if (guidance.status === "unavailable") {
    elements.directionIcon.textContent = "!";
    elements.guidanceTitle.textContent = "No safe direction available";
    elements.guidanceDetail.textContent = guidance.reason.replaceAll("_", " ");
    return;
  }

  elements.directionIcon.textContent = directionSymbol(guidance.direction);
  elements.guidanceTitle.textContent = `Move ${guidance.direction}`;
  elements.guidanceDetail.textContent =
    `${guidance.occupantId} should move to (${guidance.nextCoordinate.x}, ` +
    `${guidance.nextCoordinate.y}); ${guidance.remainingSteps} step(s) remain.`;
}

function renderRoute(routeEvent) {
  if (!routeEvent?.result) return;
  const { result } = routeEvent;
  elements.routeStatus.textContent = result.status === "success" ? "Validated" : "Failed";
  elements.routeStatus.className =
    result.status === "success" ? "status-badge success" : "status-badge failure";
  elements.routeLatency.textContent = `${result.totalLatencyMs.toFixed(2)} ms`;

  if (result.status === "failure") {
    elements.routeLength.textContent = "—";
    elements.routeCost.textContent = "—";
    elements.routeExit.textContent = result.reason.replaceAll("_", " ");
    return;
  }

  elements.routeLength.textContent = `${result.pathLength} steps`;
  elements.routeCost.textContent = result.routeCost.toFixed(2);
  elements.routeExit.textContent = `(${result.selectedExit.x}, ${result.selectedExit.y})`;
}

function appendCell(row, text, className) {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = text;
  row.append(cell);
  return cell;
}

function renderReadings(readings) {
  const filter = elements.sensorFilter.value;
  const visibleReadings = readings.filter(
    (reading) => filter === "all" || reading.type === filter,
  );
  const rows = visibleReadings.map((reading) => {
    const row = document.createElement("tr");
    const condition = sensorCondition(reading);
    appendCell(row, reading.sensorId);
    appendCell(row, reading.type);
    appendCell(row, formatSensorValue(reading));
    appendCell(row, String(reading.sequence));
    const conditionCell = appendCell(row, "");
    const badge = document.createElement("span");
    badge.className = `condition ${condition.className}`;
    badge.textContent = condition.label;
    conditionCell.append(badge);
    appendCell(row, formatTime(reading.timestamp));
    return row;
  });

  if (rows.length === 0) {
    const row = document.createElement("tr");
    appendCell(row, "No readings match this filter.", "empty-row").colSpan = 6;
    rows.push(row);
  }
  elements.sensorTableBody.replaceChildren(...rows);
}

function renderSnapshot(snapshot) {
  elements.connectionDot.classList.add("connected");
  elements.connectionLabel.textContent = "Live data received";
  elements.scenarioId.textContent = snapshot.scenarioId;
  elements.stateVersion.textContent = snapshot.stateVersion ?? "—";
  elements.readingCount.textContent = snapshot.readings.length;
  elements.lastUpdate.textContent = formatTime(snapshot.updatedAt);
  elements.mapPlaceholder.classList.add("hidden");

  renderOccupant(snapshot);
  renderGuidance(snapshot.guidance);
  renderRoute(snapshot.routeEvent);
  renderReadings(snapshot.readings);
  drawFloorplan(snapshot);
}

async function refreshSnapshot() {
  try {
    const response = await fetch("/api/dashboard-snapshot", { cache: "no-store" });
    if (!response.ok) throw new Error(`Snapshot request returned ${response.status}`);
    currentSnapshot = normaliseSnapshot(await response.json());
    renderSnapshot(currentSnapshot);
  } catch {
    elements.connectionDot.classList.remove("connected");
    elements.connectionLabel.textContent = "Waiting for live data";
  } finally {
    window.setTimeout(refreshSnapshot, REFRESH_INTERVAL_MS);
  }
}

elements.occupantSelect.addEventListener("change", () => {
  selectedOccupantId = elements.occupantSelect.value;
  if (currentSnapshot) renderSnapshot(currentSnapshot);
});

elements.sensorFilter.addEventListener("change", () => {
  if (currentSnapshot) renderReadings(currentSnapshot.readings);
});

refreshSnapshot();
