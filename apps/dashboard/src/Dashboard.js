"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  directionSymbol,
  formatSensorValue,
  formatTime,
  manualReadingValue,
  normaliseSnapshot,
  readingValueForControl,
  SENSOR_COLOURS,
  sensorCondition,
} from "./dashboardModel.js";
import { FloorplanCanvas } from "./FloorplanCanvas.js";

const REFRESH_INTERVAL_MS = 1_000;

export function Dashboard() {
  const [snapshot, setSnapshot] = useState(null);
  const [connectionMessage, setConnectionMessage] = useState("Connecting to MQTT…");
  const [selectedOccupantId, setSelectedOccupantId] = useState("occupant-01");
  const [selectedSensorId, setSelectedSensorId] = useState("");
  const [controlValue, setControlValue] = useState("");
  const [sensorFilter, setSensorFilter] = useState("all");
  const [controlMessage, setControlMessage] = useState("");
  const [controlPending, setControlPending] = useState(false);

  const loadSnapshot = useCallback(async () => {
    try {
      const response = await globalThis.fetch("/api/dashboard-snapshot", {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Dashboard data is unavailable");
      const currentSnapshot = normaliseSnapshot(body);
      setSnapshot(currentSnapshot);
      setConnectionMessage("Live MQTT data");
      setSelectedOccupantId((current) =>
        currentSnapshot.occupants.some((item) => item.occupantId === current)
          ? current
          : currentSnapshot.occupants[0]?.occupantId,
      );
      setSelectedSensorId((current) => {
        if (currentSnapshot.sensors.some((item) => item.sensorId === current)) {
          return current;
        }
        return currentSnapshot.sensors[0]?.sensorId ?? "";
      });
    } catch (error) {
      setConnectionMessage(error.message);
    }
  }, []);

  useEffect(() => {
    loadSnapshot();
    const timer = globalThis.setInterval(loadSnapshot, REFRESH_INTERVAL_MS);
    return () => globalThis.clearInterval(timer);
  }, [loadSnapshot]);

  const selectedOccupant = snapshot?.occupants.find(
    (item) => item.occupantId === selectedOccupantId,
  );
  const selectedSensor = snapshot?.sensors.find(
    (item) => item.sensorId === selectedSensorId,
  );
  const visibleReadings = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.readings.filter(
      (reading) => sensorFilter === "all" || reading.type === sensorFilter,
    );
  }, [snapshot, sensorFilter]);

  function selectSensor(sensorId) {
    setSelectedSensorId(sensorId);
    const reading = snapshot?.readings.find((item) => item.sensorId === sensorId);
    setControlValue(readingValueForControl(reading));
    setControlMessage("");
  }

  async function sendControl(input) {
    setControlPending(true);
    setControlMessage("");
    try {
      const response = await globalThis.fetch("/api/sensor-controls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The command was rejected");
      setControlMessage(
        input.action === "resume"
          ? "Automatic updates resumed."
          : "Manual reading published.",
      );
    } catch (error) {
      setControlMessage(error.message);
    } finally {
      setControlPending(false);
    }
  }

  function submitOverride(event) {
    event.preventDefault();
    if (!selectedSensor) return;
    try {
      const readingValue = manualReadingValue(selectedSensor.type, controlValue);
      sendControl({
        action: "override",
        sensorId: selectedSensor.sensorId,
        readingValue,
      });
    } catch (error) {
      setControlMessage(error.message);
    }
  }

  if (!snapshot) {
    return (
      <main className="loading-page">
        <section className="loading-card">
          <p className="eyebrow">Evacuva</p>
          <h1>Waiting for the local system</h1>
          <p>{connectionMessage}</p>
          <p className="muted">Start the broker and state engine before the dashboard.</p>
        </section>
      </main>
    );
  }

  const route = snapshot.routeEvent?.result;
  const guidance = snapshot.guidance;

  return (
    <main className="application-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Evacuva</p>
          <h1>Building evacuation view</h1>
        </div>
        <div className="live-status">
          <span className="live-dot" aria-hidden="true" />
          <span>{connectionMessage}</span>
        </div>
      </header>

      <section className="summary-strip" aria-label="Current scenario summary">
        <div>
          <span>Scenario</span>
          <strong>{snapshot.scenarioId}</strong>
        </div>
        <div>
          <span>State</span>
          <strong>{snapshot.stateVersion ?? "—"}</strong>
        </div>
        <div>
          <span>People</span>
          <strong>{snapshot.occupants.length}</strong>
        </div>
        <div>
          <span>Sensors</span>
          <strong>{snapshot.readings.length}</strong>
        </div>
        <div>
          <span>Updated</span>
          <strong>{formatTime(snapshot.updatedAt)}</strong>
        </div>
      </section>

      <div className="primary-grid">
        <section className="panel map-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Live floorplan</p>
              <h2>100 × 100 building map</h2>
            </div>
            <select
              aria-label="Highlighted occupant"
              value={selectedOccupantId}
              onChange={(event) => setSelectedOccupantId(event.target.value)}
            >
              {snapshot.occupants.map((occupant) => (
                <option key={occupant.occupantId} value={occupant.occupantId}>
                  {occupant.occupantId}
                </option>
              ))}
            </select>
          </div>

          <FloorplanCanvas
            snapshot={snapshot}
            selectedOccupantId={selectedOccupantId}
            onOccupantSelect={setSelectedOccupantId}
            onSensorSelect={selectSensor}
          />

          <div className="legend" aria-label="Map legend">
            <span>
              <i className="marker person" />
              Person
            </span>
            <span>
              <i className="marker route" />
              Safe route
            </span>
            {Object.entries(SENSOR_COLOURS).map(([type, colour]) => (
              <span key={type}>
                <i className="marker" style={{ backgroundColor: colour }} />
                {type === "door" ? "Exit door" : type}
              </span>
            ))}
          </div>
        </section>

        <aside className="side-column">
          <section className="panel guidance-panel">
            <p className="eyebrow">Current direction</p>
            <div className="direction-row">
              <span className="direction-symbol">
                {guidance?.status === "success"
                  ? directionSymbol(guidance.direction)
                  : "!"}
              </span>
              <div>
                <h2>
                  {guidance?.status === "success"
                    ? `Move ${guidance.direction}`
                    : "No direction yet"}
                </h2>
                <p>
                  {guidance?.status === "success"
                    ? `${guidance.remainingSteps} steps to exit (${guidance.selectedExit.x}, ${guidance.selectedExit.y})`
                    : "Waiting for a route calculation."}
                </p>
              </div>
            </div>
            <dl className="route-facts">
              <div>
                <dt>Route</dt>
                <dd>{route?.status ?? "Waiting"}</dd>
              </div>
              <div>
                <dt>Length</dt>
                <dd>{route?.status === "success" ? `${route.pathLength} steps` : "—"}</dd>
              </div>
              <div>
                <dt>Cost</dt>
                <dd>{route?.status === "success" ? route.routeCost.toFixed(2) : "—"}</dd>
              </div>
              <div>
                <dt>Latency</dt>
                <dd>{route ? `${route.totalLatencyMs.toFixed(2)} ms` : "—"}</dd>
              </div>
            </dl>
            <p className="small-note">
              The calculated local route is for occupant-01. Selecting another person
              highlights their position only.
            </p>
          </section>

          <section className="panel occupant-panel">
            <p className="eyebrow">Highlighted person</p>
            <h2>{selectedOccupant?.occupantId}</h2>
            <p>
              Coordinate ({selectedOccupant?.start.x}, {selectedOccupant?.start.y})
            </p>
          </section>

          <section className="panel control-panel">
            <p className="eyebrow">Sensor control</p>
            <h2>Manual override</h2>
            <form onSubmit={submitOverride}>
              <label htmlFor="sensor-select">Sensor</label>
              <select
                id="sensor-select"
                value={selectedSensorId}
                onChange={(event) => selectSensor(event.target.value)}
              >
                {snapshot.sensors.map((sensor) => (
                  <option key={sensor.sensorId} value={sensor.sensorId}>
                    {sensor.sensorId}
                  </option>
                ))}
              </select>

              <label htmlFor="control-value">New reading</label>
              {selectedSensor?.type === "door" ? (
                <select
                  id="control-value"
                  value={controlValue}
                  onChange={(event) => setControlValue(event.target.value)}
                >
                  <option value="open">Open and clear</option>
                  <option value="closed">Closed</option>
                  <option value="obstructed">Obstructed</option>
                </select>
              ) : (
                <input
                  id="control-value"
                  type="number"
                  value={controlValue}
                  min={selectedSensor?.type === "temperature" ? -50 : 0}
                  max={selectedSensor?.type === "occupancy" ? 1 : undefined}
                  step={selectedSensor?.type === "occupancy" ? 0.05 : 1}
                  onChange={(event) => setControlValue(event.target.value)}
                  required
                />
              )}

              <div className="button-row">
                <button type="submit" disabled={controlPending}>
                  Apply reading
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={controlPending}
                  onClick={() =>
                    sendControl({ action: "resume", sensorId: selectedSensorId })
                  }
                >
                  Resume automatic
                </button>
              </div>
              <p className="control-message" aria-live="polite">
                {controlMessage}
              </p>
            </form>
          </section>
        </aside>
      </div>

      <section className="panel readings-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Current readings</p>
            <h2>Sensor activity</h2>
          </div>
          <select
            aria-label="Sensor type filter"
            value={sensorFilter}
            onChange={(event) => setSensorFilter(event.target.value)}
          >
            <option value="all">All types</option>
            <option value="smoke">Smoke</option>
            <option value="temperature">Temperature</option>
            <option value="occupancy">Occupancy</option>
            <option value="door">Exit door</option>
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sensor</th>
                <th>Type</th>
                <th>Value</th>
                <th>Condition</th>
                <th>Sequence</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {visibleReadings.map((reading) => {
                const condition = sensorCondition(reading);
                return (
                  <tr
                    className={
                      reading.sensorId === selectedSensorId ? "selected-row" : ""
                    }
                    key={reading.sensorId}
                    onClick={() => selectSensor(reading.sensorId)}
                  >
                    <td>{reading.sensorId}</td>
                    <td>
                      <span
                        className="sensor-type-dot"
                        style={{ backgroundColor: SENSOR_COLOURS[reading.type] }}
                      />
                      {reading.type}
                    </td>
                    <td>{formatSensorValue(reading)}</td>
                    <td>
                      <span className={`condition ${condition.className}`}>
                        {condition.label}
                      </span>
                    </td>
                    <td>{reading.sequence}</td>
                    <td>{formatTime(reading.timestamp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="evidence-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Measured evidence</p>
            <h2>Scaling result</h2>
          </div>
        </div>
        <div className="evidence-grid">
          <article>
            <strong>4.207 s</strong>
            <span>20th request with six workers</span>
          </article>
          <article>
            <strong>13.843 s</strong>
            <span>20th request with one worker</span>
          </article>
          <article>
            <strong>480 / 480</strong>
            <span>valid sustained-load routes</span>
          </article>
        </div>
        <p className="small-note">
          Six workers passed four of five controlled SLA trials. This demonstrates a
          scaling benefit, not a guaranteed five-second service level.
        </p>
      </section>

      <footer>University prototype only. It is not a certified emergency system.</footer>
    </main>
  );
}
