import {
  DEFAULT_FLOORPLAN_CONFIGURATION,
  FloorplanConfigurationSchema,
  FloorplanSchema,
} from "@evacuva/contracts";

import { createSeededRandom, randomInteger } from "./seededRandom.js";
import { validateFloorplan } from "./validateFloorplan.js";

const CORRIDOR = "corridor";

function createGrid(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(null));
}

function canPlaceRoom(grid, room) {
  for (let y = room.y - 1; y <= room.y + room.height; y += 1) {
    for (let x = room.x - 1; x <= room.x + room.width; x += 1) {
      if (grid[y][x] !== null) {
        return false;
      }
    }
  }

  return true;
}

function carveRoom(grid, room) {
  for (let y = room.y; y < room.y + room.height; y += 1) {
    for (let x = room.x; x < room.x + room.width; x += 1) {
      grid[y][x] = room.id;
    }
  }
}

function placeRooms(grid, configuration, random) {
  const rooms = [];
  const maximumAttempts = configuration.roomCount * 500;

  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    if (rooms.length === configuration.roomCount) {
      return rooms;
    }

    const width = randomInteger(
      random,
      configuration.minRoomSize,
      configuration.maxRoomSize,
    );
    const height = randomInteger(
      random,
      configuration.minRoomSize,
      configuration.maxRoomSize,
    );
    const room = {
      id: `room-${rooms.length + 1}`,
      x: randomInteger(random, 2, configuration.width - width - 2),
      y: randomInteger(random, 2, configuration.height - height - 2),
      width,
      height,
    };

    if (canPlaceRoom(grid, room)) {
      carveRoom(grid, room);
      rooms.push(room);
    }
  }

  throw new Error(
    `Could not place ${configuration.roomCount} rooms using seed ${configuration.seed}`,
  );
}

function roomCentre(room) {
  return {
    x: room.x + Math.floor(room.width / 2),
    y: room.y + Math.floor(room.height / 2),
  };
}

function carveCorridorCell(grid, x, y) {
  if (grid[y][x] === null) {
    grid[y][x] = CORRIDOR;
  }
}

function carveHorizontalCorridor(grid, startX, endX, y) {
  const minimumX = Math.min(startX, endX);
  const maximumX = Math.max(startX, endX);

  for (let x = minimumX; x <= maximumX; x += 1) {
    carveCorridorCell(grid, x, y);
  }
}

function carveVerticalCorridor(grid, x, startY, endY) {
  const minimumY = Math.min(startY, endY);
  const maximumY = Math.max(startY, endY);

  for (let y = minimumY; y <= maximumY; y += 1) {
    carveCorridorCell(grid, x, y);
  }
}

function connectRooms(grid, rooms, random) {
  for (let index = 1; index < rooms.length; index += 1) {
    const previousCentre = roomCentre(rooms[index - 1]);
    const currentCentre = roomCentre(rooms[index]);

    if (random() < 0.5) {
      carveHorizontalCorridor(grid, previousCentre.x, currentCentre.x, previousCentre.y);
      carveVerticalCorridor(grid, currentCentre.x, previousCentre.y, currentCentre.y);
    } else {
      carveVerticalCorridor(grid, previousCentre.x, previousCentre.y, currentCentre.y);
      carveHorizontalCorridor(grid, previousCentre.x, currentCentre.x, currentCentre.y);
    }
  }
}

function boundaryCoordinate(side, position, width, height) {
  switch (side) {
    case "top":
      return { x: position, y: 0 };
    case "right":
      return { x: width - 1, y: position };
    case "bottom":
      return { x: position, y: height - 1 };
    default:
      return { x: 0, y: position };
  }
}

function coordinateKey(coordinate) {
  return `${coordinate.x},${coordinate.y}`;
}

function chooseExitCoordinate(side, target, configuration, random, usedExits) {
  const horizontalSide = side === "top" || side === "bottom";
  const limit = horizontalSide ? configuration.width : configuration.height;
  const targetPosition = horizontalSide ? target.x : target.y;
  const firstPosition = Math.max(
    1,
    Math.min(limit - 2, targetPosition + randomInteger(random, -4, 4)),
  );

  for (let offset = 0; offset < limit - 2; offset += 1) {
    const position = 1 + ((firstPosition - 1 + offset) % (limit - 2));
    const coordinate = boundaryCoordinate(
      side,
      position,
      configuration.width,
      configuration.height,
    );

    if (!usedExits.has(coordinateKey(coordinate))) {
      return coordinate;
    }
  }

  throw new Error(`Could not place an exit on the ${side} boundary`);
}

function connectExit(grid, exit, target, side, width, height) {
  if (side === "top" || side === "bottom") {
    const insideY = side === "top" ? 1 : height - 2;
    carveVerticalCorridor(grid, exit.x, insideY, target.y);
    carveHorizontalCorridor(grid, exit.x, target.x, target.y);
  } else {
    const insideX = side === "left" ? 1 : width - 2;
    carveHorizontalCorridor(grid, insideX, target.x, exit.y);
    carveVerticalCorridor(grid, target.x, exit.y, target.y);
  }

  grid[exit.y][exit.x] = "exit";
}

function placeExits(grid, rooms, configuration, random) {
  const sides = ["top", "right", "bottom", "left"];
  const exits = [];
  const usedExits = new Set();

  for (let index = 0; index < configuration.exitCount; index += 1) {
    const side = sides[index % sides.length];
    const roomIndex = Math.floor((index * rooms.length) / configuration.exitCount);
    const target = roomCentre(rooms[roomIndex]);
    const exit = chooseExitCoordinate(side, target, configuration, random, usedExits);

    connectExit(grid, exit, target, side, configuration.width, configuration.height);
    usedExits.add(coordinateKey(exit));
    exits.push(exit);
  }

  return exits;
}

function createCells(grid) {
  return grid.flatMap((row, y) =>
    row.map((value, x) => {
      if (value === null) {
        return { coordinate: { x, y }, type: "wall" };
      }

      if (value === "exit") {
        return { coordinate: { x, y }, type: "exit" };
      }

      if (value === CORRIDOR) {
        return { coordinate: { x, y }, type: "floor" };
      }

      return { coordinate: { x, y }, type: "floor", roomId: value };
    }),
  );
}

export function generateFloorplan(configurationOverrides = {}) {
  const configuration = FloorplanConfigurationSchema.parse({
    ...DEFAULT_FLOORPLAN_CONFIGURATION,
    ...configurationOverrides,
  });
  const random = createSeededRandom(configuration.seed);
  const grid = createGrid(configuration.width, configuration.height);
  const rooms = placeRooms(grid, configuration, random);

  connectRooms(grid, rooms, random);
  const exits = placeExits(grid, rooms, configuration, random);
  const floorplan = FloorplanSchema.parse({
    floorplanId: `floorplan-${configuration.seed}`,
    configuration,
    cells: createCells(grid),
    exits,
  });
  const validation = validateFloorplan(floorplan);

  if (!validation.valid) {
    throw new Error(`Generated an invalid floorplan: ${validation.errors.join("; ")}`);
  }

  return floorplan;
}
