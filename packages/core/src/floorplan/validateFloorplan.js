import { FloorplanSchema } from "@evacuva/contracts";

function coordinateKey(coordinate) {
  return `${coordinate.x},${coordinate.y}`;
}

export function validateFloorplan(floorplan) {
  const parsed = FloorplanSchema.safeParse(floorplan);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const roomIds = new Set(
    parsed.data.cells.flatMap((cell) => (cell.roomId ? [cell.roomId] : [])),
  );
  const errors = [];

  if (roomIds.size !== parsed.data.configuration.roomCount) {
    errors.push(
      `Expected ${parsed.data.configuration.roomCount} rooms but found ${roomIds.size}`,
    );
  }

  const walkableCells = parsed.data.cells.filter((cell) => cell.type !== "wall");
  const cellsByCoordinate = new Map(
    walkableCells.map((cell) => [coordinateKey(cell.coordinate), cell]),
  );
  const firstCell = walkableCells[0];

  if (!firstCell) {
    errors.push("Floorplan has no walkable cells");
    return { valid: false, errors };
  }

  const visited = new Set([coordinateKey(firstCell.coordinate)]);
  const queue = [firstCell.coordinate];
  let queueIndex = 0;

  while (queueIndex < queue.length) {
    const coordinate = queue[queueIndex];
    queueIndex += 1;

    const neighbours = [
      { x: coordinate.x, y: coordinate.y - 1 },
      { x: coordinate.x + 1, y: coordinate.y },
      { x: coordinate.x, y: coordinate.y + 1 },
      { x: coordinate.x - 1, y: coordinate.y },
    ];

    for (const neighbour of neighbours) {
      const key = coordinateKey(neighbour);
      if (cellsByCoordinate.has(key) && !visited.has(key)) {
        visited.add(key);
        queue.push(neighbour);
      }
    }
  }

  if (visited.size !== walkableCells.length) {
    errors.push(`${walkableCells.length - visited.size} walkable cells are disconnected`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
