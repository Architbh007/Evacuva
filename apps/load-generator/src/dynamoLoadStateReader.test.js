import assert from "node:assert/strict";
import test from "node:test";

import { createScenarioStateRecord, generateScenario } from "@evacuva/core";

import { createDynamoLoadStateReader } from "./dynamoLoadStateReader.js";

const TABLE_NAME = "evacuva-routing-data";

test("the load generator consistently reads the current experiment state", async () => {
  const state = generateScenario();
  const commands = [];
  const reader = createDynamoLoadStateReader({
    documentClient: {
      async send(command) {
        commands.push(command);
        return { Item: createScenarioStateRecord(state) };
      },
    },
    tableName: TABLE_NAME,
  });

  const loaded = await reader.loadCurrentState(state.scenarioId);

  assert.deepEqual(loaded, state);
  assert.deepEqual(commands[0].input.Key, {
    scenarioId: state.scenarioId,
    recordKey: "STATE",
  });
  assert.equal(commands[0].input.ConsistentRead, true);
});

test("a missing experiment state is reported before requests are sent", async () => {
  const reader = createDynamoLoadStateReader({
    documentClient: { send: async () => ({}) },
    tableName: TABLE_NAME,
  });

  await assert.rejects(
    () => reader.loadCurrentState("scenario-missing"),
    /No current state exists/,
  );
});
