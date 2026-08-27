import assert from "node:assert/strict";
import test from "node:test";

import { generateFloorplan } from "./generateFloorplan.js";
import { validateFloorplan } from "./validateFloorplan.js";

test("generates the agreed 100 by 100 floorplan", () => {
  const floorplan = generateFloorplan();
  const roomIds = new Set(
    floorplan.cells.flatMap((cell) => (cell.roomId ? [cell.roomId] : [])),
  );

  assert.equal(floorplan.configuration.width, 100);
  assert.equal(floorplan.configuration.height, 100);
  assert.equal(floorplan.cells.length, 10_000);
  assert.equal(roomIds.size, 24);
  assert.equal(floorplan.exits.length, 6);
  assert.equal(validateFloorplan(floorplan).valid, true);
});

test("repeats the same floorplan when the seed is unchanged", () => {
  const firstFloorplan = generateFloorplan({ seed: 12_345 });
  const secondFloorplan = generateFloorplan({ seed: 12_345 });

  assert.deepEqual(secondFloorplan, firstFloorplan);
});

test("changes the floorplan when the seed changes", () => {
  const firstFloorplan = generateFloorplan({ seed: 10 });
  const secondFloorplan = generateFloorplan({ seed: 11 });

  assert.notDeepEqual(secondFloorplan.cells, firstFloorplan.cells);
});

test("places every exit on the boundary and marks its matching cell", () => {
  const floorplan = generateFloorplan({ seed: 902 });
  const cellsByCoordinate = new Map(
    floorplan.cells.map((cell) => [`${cell.coordinate.x},${cell.coordinate.y}`, cell]),
  );

  for (const exit of floorplan.exits) {
    const onBoundary = exit.x === 0 || exit.x === 99 || exit.y === 0 || exit.y === 99;

    assert.equal(onBoundary, true);
    assert.equal(cellsByCoordinate.get(`${exit.x},${exit.y}`).type, "exit");
  }
});

test("generates connected and valid floorplans across 100 seeds", () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const result = validateFloorplan(generateFloorplan({ seed }));

    assert.equal(result.valid, true, `Seed ${seed}: ${result.errors.join("; ")}`);
  }
});

test("validator rejects a floorplan whose exit cell is blocked", () => {
  const floorplan = JSON.parse(JSON.stringify(generateFloorplan({ seed: 44 })));
  const exit = floorplan.exits[0];
  const exitCell = floorplan.cells.find(
    (cell) => cell.coordinate.x === exit.x && cell.coordinate.y === exit.y,
  );

  exitCell.type = "wall";

  const result = validateFloorplan(floorplan);
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes("Exit must reference an exit cell"), true);
});
