import { createServer } from "node:net";

import { Aedes } from "aedes";

function closeAedesBroker(broker) {
  return new Promise((resolve) => broker.close(resolve));
}

export async function startLocalMqttBroker(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 1883;

  if (typeof host !== "string" || host.length === 0) {
    throw new TypeError("MQTT broker host must be a non-empty string");
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("MQTT broker port must be an integer from 0 to 65535");
  }

  const broker = await Aedes.createBroker();
  const server = createServer(broker.handle);

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host, port }, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await closeAedesBroker(broker);
    throw error;
  }

  const address = server.address();
  let closed = false;

  return {
    server,
    url: `mqtt://${host}:${address.port}`,
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await closeAedesBroker(broker);
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
