"use client";

import { useEffect, useRef, useState } from "react";

import { formatSensorValue, SENSOR_COLOURS, sensorCondition } from "./dashboardModel.js";

const MAP_SIZE = 100;
const CANVAS_SIZE = 800;

function pointFor(coordinate, cellSize) {
  return {
    x: (coordinate.x + 0.5) * cellSize,
    y: (coordinate.y + 0.5) * cellSize,
  };
}

function drawMap(context, snapshot, selectedOccupantId) {
  const cellSize = CANVAS_SIZE / MAP_SIZE;
  const cellColours = { "#": "#4b4e52", ".": "#e7e7e4", E: "#2f7954" };
  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  for (let y = 0; y < MAP_SIZE; y += 1) {
    for (let x = 0; x < MAP_SIZE; x += 1) {
      context.fillStyle = cellColours[snapshot.layout.rows[y][x]];
      context.fillRect(x * cellSize, y * cellSize, cellSize + 0.2, cellSize + 0.2);
    }
  }

  const result = snapshot.routeEvent?.result;
  if (result?.status === "success") {
    context.beginPath();
    result.path.forEach((coordinate, index) => {
      const point = pointFor(coordinate, cellSize);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.strokeStyle = "#e0b43b";
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
  }

  const readings = new Map(
    snapshot.readings.map((reading) => [reading.sensorId, reading]),
  );
  for (const sensor of snapshot.sensors) {
    const point = pointFor(sensor.coordinate, cellSize);
    const condition = readings.has(sensor.sensorId)
      ? sensorCondition(readings.get(sensor.sensorId))
      : { className: "normal" };
    context.beginPath();
    context.arc(point.x, point.y, 3.4, 0, Math.PI * 2);
    context.fillStyle = SENSOR_COLOURS[sensor.type];
    context.fill();
    if (condition.className === "critical") {
      context.lineWidth = 2;
      context.strokeStyle = "#551a15";
      context.stroke();
    }
  }

  for (const occupant of snapshot.occupants) {
    const point = pointFor(occupant.start, cellSize);
    const selected = occupant.occupantId === selectedOccupantId;
    context.beginPath();
    context.arc(point.x, point.y, selected ? 6.2 : 4.8, 0, Math.PI * 2);
    context.fillStyle = "#111214";
    context.fill();
    context.lineWidth = selected ? 2.5 : 1;
    context.strokeStyle = selected ? "#ffffff" : "#111214";
    context.stroke();
  }
}

function coordinateFromPointer(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(
      0,
      Math.min(99, Math.floor(((event.clientX - bounds.left) / bounds.width) * 100)),
    ),
    y: Math.max(
      0,
      Math.min(99, Math.floor(((event.clientY - bounds.top) / bounds.height) * 100)),
    ),
  };
}

function itemAt(snapshot, coordinate) {
  const occupant = snapshot.occupants.find(
    (item) => item.start.x === coordinate.x && item.start.y === coordinate.y,
  );
  if (occupant) return { type: "occupant", item: occupant };

  const sensor = snapshot.sensors.find(
    (item) => item.coordinate.x === coordinate.x && item.coordinate.y === coordinate.y,
  );
  if (sensor) return { type: "sensor", item: sensor };
  return null;
}

export function FloorplanCanvas({
  snapshot,
  selectedOccupantId,
  onOccupantSelect,
  onSensorSelect,
}) {
  const canvasRef = useRef(null);
  const [mapDetail, setMapDetail] = useState("Move over the map to inspect a cell.");

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (context) drawMap(context, snapshot, selectedOccupantId);
  }, [snapshot, selectedOccupantId]);

  function describePointer(event) {
    const coordinate = coordinateFromPointer(event);
    const match = itemAt(snapshot, coordinate);
    if (match?.type === "occupant") {
      setMapDetail(`${match.item.occupantId} at (${coordinate.x}, ${coordinate.y})`);
      return;
    }
    if (match?.type === "sensor") {
      const reading = snapshot.readings.find(
        (item) => item.sensorId === match.item.sensorId,
      );
      const value = reading ? ` · ${formatSensorValue(reading)}` : "";
      setMapDetail(
        `${match.item.sensorId} at (${coordinate.x}, ${coordinate.y})${value}`,
      );
      return;
    }
    const cell = snapshot.layout.rows[coordinate.y][coordinate.x];
    const cellName = { "#": "Wall", ".": "Walkable", E: "Exit" }[cell];
    setMapDetail(`${cellName} cell (${coordinate.x}, ${coordinate.y})`);
  }

  function selectMapItem(event) {
    const match = itemAt(snapshot, coordinateFromPointer(event));
    if (match?.type === "occupant") onOccupantSelect(match.item.occupantId);
    if (match?.type === "sensor") onSensorSelect(match.item.sensorId);
  }

  return (
    <figure className="map-figure">
      <canvas
        aria-label="Interactive 100 by 100 evacuation floorplan"
        height={CANVAS_SIZE}
        onClick={selectMapItem}
        onPointerMove={describePointer}
        onPointerLeave={() => setMapDetail("Move over the map to inspect a cell.")}
        ref={canvasRef}
        tabIndex="0"
        width={CANVAS_SIZE}
      />
      <figcaption>{mapDetail}</figcaption>
    </figure>
  );
}
