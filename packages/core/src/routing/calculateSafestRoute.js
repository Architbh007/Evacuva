import { performance } from "node:perf_hooks";

import {
  CurrentBuildingStateSchema,
  RouteRequestSchema,
  RouteResultSchema,
} from "@evacuva/contracts";

import { buildSafetyMap } from "../safety/buildSafetyMap.js";
import { validateRoute } from "./validateRoute.js";

const ALGORITHM_VERSION = "dijkstra-v1";

function coordinateKey(coordinate) {
  return `${coordinate.x},${coordinate.y}`;
}

class MinimumPriorityQueue {
  constructor() {
    this.entries = [];
  }

  push(entry) {
    this.entries.push(entry);
    let index = this.entries.length - 1;

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.entries[parentIndex].cost <= this.entries[index].cost) {
        break;
      }
      [this.entries[parentIndex], this.entries[index]] = [
        this.entries[index],
        this.entries[parentIndex],
      ];
      index = parentIndex;
    }
  }

  pop() {
    const first = this.entries[0];
    const last = this.entries.pop();

    if (this.entries.length > 0) {
      this.entries[0] = last;
      let index = 0;

      while (true) {
        const leftIndex = index * 2 + 1;
        const rightIndex = leftIndex + 1;
        let smallestIndex = index;

        if (
          leftIndex < this.entries.length &&
          this.entries[leftIndex].cost < this.entries[smallestIndex].cost
        ) {
          smallestIndex = leftIndex;
        }
        if (
          rightIndex < this.entries.length &&
          this.entries[rightIndex].cost < this.entries[smallestIndex].cost
        ) {
          smallestIndex = rightIndex;
        }
        if (smallestIndex === index) {
          break;
        }

        [this.entries[index], this.entries[smallestIndex]] = [
          this.entries[smallestIndex],
          this.entries[index],
        ];
        index = smallestIndex;
      }
    }

    return first;
  }

  get size() {
    return this.entries.length;
  }
}

function createFailureResult(request, reason, visitedNodeCount, startedAt) {
  const elapsed = performance.now() - startedAt;

  return RouteResultSchema.parse({
    status: "failure",
    reason,
    requestId: request.requestId,
    scenarioId: request.scenarioId,
    stateVersion: request.stateVersion,
    visitedNodeCount,
    queueTimeMs: 0,
    computeTimeMs: elapsed,
    totalLatencyMs: elapsed,
    algorithmVersion: ALGORITHM_VERSION,
  });
}

function reconstructPath(selectedExitKey, previousCell, safetyCells) {
  const path = [];
  let currentKey = selectedExitKey;

  while (currentKey !== undefined) {
    path.push(safetyCells.get(currentKey).coordinate);
    currentKey = previousCell.get(currentKey);
  }

  return path.reverse();
}

export function calculateSafestRoute(stateInput, requestInput, parameterOverrides = {}) {
  const startedAt = performance.now();
  const state = CurrentBuildingStateSchema.parse(stateInput);
  const request = RouteRequestSchema.parse(requestInput);

  if (request.scenarioId !== state.scenarioId) {
    throw new Error("Route request scenario ID does not match the building state");
  }
  if (request.stateVersion !== state.stateVersion) {
    throw new Error("Route request state version does not match the building state");
  }

  const floorCell = state.floorplan.cells.find(
    (cell) =>
      cell.coordinate.x === request.start.x && cell.coordinate.y === request.start.y,
  );
  if (floorCell?.type !== "floor") {
    return createFailureResult(request, "invalid_start", 0, startedAt);
  }

  const { safetyCells, safeExits } = buildSafetyMap(state, parameterOverrides);
  const startKey = coordinateKey(request.start);
  if (safetyCells.get(startKey).blocked) {
    return createFailureResult(request, "blocked_start", 0, startedAt);
  }
  if (safeExits.length === 0) {
    return createFailureResult(request, "all_exits_blocked", 0, startedAt);
  }

  const safeExitKeys = new Set(safeExits.map(coordinateKey));
  const distances = new Map([[startKey, 0]]);
  const previousCell = new Map();
  const visited = new Set();
  const queue = new MinimumPriorityQueue();
  queue.push({ key: startKey, cost: 0 });
  let selectedExitKey;

  while (queue.size > 0) {
    const current = queue.pop();
    if (visited.has(current.key)) {
      continue;
    }

    visited.add(current.key);
    if (safeExitKeys.has(current.key)) {
      selectedExitKey = current.key;
      break;
    }

    const currentCell = safetyCells.get(current.key);
    const neighbours = [
      { x: currentCell.coordinate.x, y: currentCell.coordinate.y - 1 },
      { x: currentCell.coordinate.x + 1, y: currentCell.coordinate.y },
      { x: currentCell.coordinate.x, y: currentCell.coordinate.y + 1 },
      { x: currentCell.coordinate.x - 1, y: currentCell.coordinate.y },
    ];

    for (const neighbour of neighbours) {
      const neighbourKey = coordinateKey(neighbour);
      const neighbourCell = safetyCells.get(neighbourKey);
      if (!neighbourCell || neighbourCell.blocked || visited.has(neighbourKey)) {
        continue;
      }

      const newCost = current.cost + neighbourCell.movementCost;
      if (newCost < (distances.get(neighbourKey) ?? Number.POSITIVE_INFINITY)) {
        distances.set(neighbourKey, newCost);
        previousCell.set(neighbourKey, current.key);
        queue.push({ key: neighbourKey, cost: newCost });
      }
    }
  }

  if (selectedExitKey === undefined) {
    return createFailureResult(request, "unreachable_exit", visited.size, startedAt);
  }

  const path = reconstructPath(selectedExitKey, previousCell, safetyCells);
  const computeTimeMs = performance.now() - startedAt;
  const result = {
    status: "success",
    requestId: request.requestId,
    scenarioId: request.scenarioId,
    stateVersion: request.stateVersion,
    path,
    selectedExit: safetyCells.get(selectedExitKey).coordinate,
    routeCost: distances.get(selectedExitKey),
    pathLength: path.length - 1,
    visitedNodeCount: visited.size,
    queueTimeMs: 0,
    computeTimeMs,
    totalLatencyMs: computeTimeMs,
    algorithmVersion: ALGORITHM_VERSION,
    validationPassed: true,
  };
  const validation = validateRoute(state, request, result, parameterOverrides);

  if (!validation.valid) {
    throw new Error(
      `Calculated route failed validation: ${validation.errors.join("; ")}`,
    );
  }

  result.totalLatencyMs = performance.now() - startedAt;
  return RouteResultSchema.parse(result);
}
