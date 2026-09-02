import { getDashboardMqttStore } from "../../../src/dashboardMqttStore.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  try {
    const input = await request.json();
    const command = await getDashboardMqttStore().publishSensorControl(input);
    return globalThis.Response.json(
      { accepted: true, commandId: command.commandId },
      { status: 202 },
    );
  } catch (error) {
    const message =
      error.name === "ZodError"
        ? (error.issues[0]?.message ?? "The sensor value is invalid")
        : error.message;
    return globalThis.Response.json({ accepted: false, message }, { status: 400 });
  }
}
