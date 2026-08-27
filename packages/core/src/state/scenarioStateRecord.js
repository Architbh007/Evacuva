import {
  CurrentBuildingStateSchema,
  ScenarioStateRecordSchema,
  ScenarioStateVersionRecordSchema,
} from "@evacuva/contracts";

import { generateScenario } from "../scenario/generateScenario.js";

function storedStateFields(state) {
  return {
    scenarioId: state.scenarioId,
    stateVersion: state.stateVersion,
    floorplanConfiguration: state.floorplan.configuration,
    occupantStart: state.occupantStart,
    occupants: state.occupants,
    sensors: state.sensors,
    latestReadings: state.latestReadings,
    updatedAt: state.updatedAt,
  };
}

export function createScenarioStateRecord(stateInput) {
  const state = CurrentBuildingStateSchema.parse(stateInput);

  return ScenarioStateRecordSchema.parse({
    ...storedStateFields(state),
    recordKey: "STATE",
  });
}

export function createScenarioStateVersionRecord(stateInput) {
  const state = CurrentBuildingStateSchema.parse(stateInput);

  return ScenarioStateVersionRecordSchema.parse({
    ...storedStateFields(state),
    recordKey: `STATE#${state.stateVersion}`,
  });
}

function restoreStoredScenarioState(record) {
  const generatedState = generateScenario({
    ...record.floorplanConfiguration,
    occupantStarts: record.occupants.map((occupant) => occupant.start),
    timestamp: record.updatedAt,
  });

  return CurrentBuildingStateSchema.parse({
    ...generatedState,
    stateVersion: record.stateVersion,
    occupantStart: record.occupantStart,
    occupants: record.occupants,
    sensors: record.sensors,
    latestReadings: record.latestReadings,
    updatedAt: record.updatedAt,
  });
}

export function restoreScenarioState(recordInput) {
  return restoreStoredScenarioState(ScenarioStateRecordSchema.parse(recordInput));
}

export function restoreScenarioStateVersion(recordInput) {
  return restoreStoredScenarioState(ScenarioStateVersionRecordSchema.parse(recordInput));
}
