import process from "node:process";

import { SENSOR_UPDATE_INTERVAL_MS } from "@evacuva/contracts";
import { generateScenario } from "@evacuva/core";

import { connectSensorSimulatorToMqtt } from "./mqttSensorConnection.js";
import { createSensorSimulator } from "./sensorSimulator.js";

function printPublishedReading(event, topic) {
  const { reading } = event;
  process.stdout.write(
    `MQTT published | ${reading.sensorId} | value=${JSON.stringify(reading.value)} | sequence=${reading.sequence} | topic=${topic}\n`,
  );
}

async function run() {
  const brokerUrl = process.env.EVACUVA_MQTT_URL ?? "mqtt://127.0.0.1:1883";
  const state = generateScenario();
  const simulator = createSensorSimulator(state);
  let stopping = false;
  let mqttConnection;

  async function stopSimulator() {
    if (stopping) {
      return;
    }
    stopping = true;
    simulator.stop();
    if (mqttConnection) {
      await mqttConnection.close();
    }
    process.stdout.write("MQTT sensor simulator stopped.\n");
  }

  function requestStop() {
    stopSimulator().catch((error) => {
      process.stderr.write(`MQTT shutdown failed: ${error.message}\n`);
      process.exitCode = 1;
    });
  }

  mqttConnection = await connectSensorSimulatorToMqtt({
    brokerUrl,
    scenarioId: state.scenarioId,
    simulator,
    onCommandHandled({ command, duplicate }) {
      if (duplicate) {
        process.stdout.write(`MQTT ignored duplicate command ${command.commandId}.\n`);
      } else if (command.messageType === "resume-automatic-sensor") {
        process.stdout.write(`MQTT resumed ${command.sensorId} automatically.\n`);
      }
    },
    onError(error) {
      process.stderr.write(`${error.message}\n`);
    },
    onManualReading: printPublishedReading,
  });

  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  process.stdout.write(
    `MQTT sensor simulator connected to ${brokerUrl} for ${state.scenarioId}.\n`,
  );
  process.stdout.write(
    `${simulator.changesPerInterval} sensor readings will be published every ${SENSOR_UPDATE_INTERVAL_MS} ms.\n`,
  );
  process.stdout.write(
    `Manual commands: ${mqttConnection.topics.manualSensorOverrides}\n`,
  );
  process.stdout.write(
    `Resume commands: ${mqttConnection.topics.resumeAutomaticSensor}\n`,
  );

  simulator.start(
    async (event) => {
      const topic = await mqttConnection.publishReading(event);
      printPublishedReading(event, topic);
    },
    (error) => {
      process.stderr.write(`MQTT sensor simulator failed: ${error.message}\n`);
      process.exitCode = 1;
      requestStop();
    },
  );
}

run().catch((error) => {
  process.stderr.write(`MQTT sensor simulator could not start: ${error.message}\n`);
  process.exitCode = 1;
});
