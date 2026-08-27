import process from "node:process";

import { startLocalMqttBroker } from "./localMqttBroker.js";

async function run() {
  const host = process.env.EVACUVA_MQTT_HOST ?? "127.0.0.1";
  const port = Number(process.env.EVACUVA_MQTT_PORT ?? 1883);
  const localBroker = await startLocalMqttBroker({ host, port });
  let stopping = false;

  async function stopBroker() {
    if (stopping) {
      return;
    }
    stopping = true;
    await localBroker.close();
    process.stdout.write("Local MQTT broker stopped.\n");
  }

  function requestStop() {
    stopBroker().catch((error) => {
      process.stderr.write(`Local MQTT broker shutdown failed: ${error.message}\n`);
      process.exitCode = 1;
    });
  }

  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  localBroker.server.on("error", (error) => {
    process.stderr.write(`Local MQTT broker failed: ${error.message}\n`);
    process.exitCode = 1;
  });

  process.stdout.write(`Local MQTT broker listening at ${localBroker.url}.\n`);
}

run().catch((error) => {
  process.stderr.write(`Local MQTT broker could not start: ${error.message}\n`);
  process.exitCode = 1;
});
