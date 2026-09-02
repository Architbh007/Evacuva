import { getDashboardMqttStore } from "../../../src/dashboardMqttStore.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const store = getDashboardMqttStore();
  const snapshot = store.getSnapshot();

  if (!snapshot.layout) {
    return globalThis.Response.json(
      {
        message: "Waiting for the retained floorplan from the local MQTT broker",
        connectionStatus: snapshot.connectionStatus,
      },
      { status: 503 },
    );
  }

  return globalThis.Response.json(snapshot, {
    headers: { "cache-control": "no-store" },
  });
}
