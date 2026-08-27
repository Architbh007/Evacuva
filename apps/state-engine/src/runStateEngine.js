import process from "node:process";

import { generateScenario } from "@evacuva/core";

import { connectStateEngineToMqtt } from "./mqttStateEngine.js";

async function run() {
  const brokerUrl = process.env.EVACUVA_MQTT_URL ?? "mqtt://127.0.0.1:1883";
  const initialState = generateScenario();
  const connection = await connectStateEngineToMqtt({
    brokerUrl,
    initialState,
    onUpdate(update) {
      const { result } = update.resultEvent;
      process.stdout.write(
        `State ${update.state.stateVersion} | ${update.stateEvent.appliedReadingCount} reading(s) | route=${result.status} | latency=${result.totalLatencyMs.toFixed(2)} ms\n`,
      );
    },
    onError(error) {
      process.stderr.write(`${error.message}\n`);
    },
  });

  async function stop() {
    await connection.close();
    process.stdout.write("State engine stopped.\n");
  }

  function reportStopError(error) {
    process.stderr.write(`State engine shutdown failed: ${error.message}\n`);
    process.exitCode = 1;
  }

  process.once("SIGINT", () => stop().catch(reportStopError));
  process.once("SIGTERM", () => stop().catch(reportStopError));
  process.stdout.write(
    `State engine connected to ${brokerUrl} for ${initialState.scenarioId}.\n`,
  );
  process.stdout.write(`Listening for batches on ${connection.topics.readingBatches}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
