# Evacuva Project Progress - Summary

## Purpose
- University prototype that finds a lower-risk evacuation route through a simulated building.
- Combines a generated floorplan with smoke, temperature, occupancy, and door readings; dangerous cells become costly or blocked, so the chosen path may be longer than the shortest one.
- Simulated research only — not a certified emergency system.

## Phase status
- Phase 1 (requirements/architecture/design) — Completed
- Phase 2 (local floorplan, sensors, safety, routing) — Completed
- Phase 3 (MQTT, Node-RED, AWS IoT Core) — Completed
- Phase 4 (SQS, ECS workers, storage, autoscaling) — Completed
- Phase 5 (evaluation, dashboard, report, demo) — In progress

## Phase 3 highlights
- Message contracts: 5-second sensor interval, descriptive IDs, reading/command/state/route envelopes, shared MQTT topic patterns; invalid messages rejected early.
- Simulator: 42 logical sensor nodes in one Node.js process; 5 readings every 5 s; 12-batch, 60-second cycle covers every sensor and models hazard onset and recovery.
- Manual control: per-sensor manual override (immediate emit) and resume-automatic commands; invalid commands rejected.
- Local MQTT: Aedes broker on `127.0.0.1:1883`, QoS 1, no retained messages, duplicate command IDs ignored; deliberately no auth/TLS/persistence.
- Node-RED 5.0.4 dashboard: live 42-sensor table, state-update and route-result tables, override/resume forms; one state version + one route per accepted batch. Flow file is intentionally `.gitignore`d (reproducibility limitation).
- AWS IoT Core: accepted batches forwarded over TLS 8883 from client `evacuva-node-red-edge`; certificates kept outside the repo; verified 15 Aug 2026.

## Phase 4 highlights
- **4.1 SQS boundary:** IoT rule `evacuva_sensor_batches_to_sqs` → `evacuva-route-requests`, using Academy `LabRole` (broader than least-privilege; documented).
- **4.2 Worker baseline:** single sequential worker; deletes message only after full success; state committed only after AWS confirms deletion.
- **4.3.1 DynamoDB:** full state is 496 KB (too big); compact record (~14 KB) regenerates the deterministic floorplan. Table `evacuva-routing-data` seeded with `scenario-48291`.
- **4.3.2 Durable worker:** one transaction writes `STATE` + `RESULT#<batchId>` with version check; deletion only after commit.
- **4.3.3 Duplicates/conflicts:** pre-checks existing result; bounded 3-attempt retry on conflict; live replay verified as duplicate.
- **4.3.4 Retry/failure:** dead-letter queue `evacuva-route-request-failures`, 3-receive redrive, 14-day retention; live-verified.
- **4.4 Container + ECR:** minimal non-root Node 24 image (~85 MB), pushed with immutable tags; scan findings (3 critical, 5 high, 11 medium, 1 low) recorded, not hidden.
- **4.5 Multi-occupant redesign (tutor, 20 Aug):** ten occupants, ten independent route requests every 5 s on one state version. Split into:
  - State coordinator (dedicated `evacuva-state-updates` queue; atomic `STATE`, `STATE#<version>`, `BATCH#<id>` writes; exactly-once logical update verified live).
  - Request service (built-in Node HTTP; `POST /route-requests` → 202, `GET /route-results/{id}`, `/health`); deployed on ECS Fargate behind ALB `evacuva-request-alb` with 2 tasks and healthy targets. HTTP only, no auth — explicit prototype limitation.
  - Read-only route-worker pool (loads immutable state, one conditional `RESULT#<requestId>` write, never mutates state); deployed as ECS service with 2 tasks, no inbound rules; live idempotency verified.
- **4.6 Load + autoscaling:**
  - Load generator supports single bursts and periodic (10 req / 5 s) mode.
  - One-worker 20-request trials: 5/5 SLA fails (20th-request median 11,431 ms).
  - Autoscaling: 2–10 tasks on `messages visible / running tasks`, calibrated to 0.5 with a one-period step scale-out; observed scale 2 → 6 during periodic runs (480/480 valid routes).
  - Six-worker 20-request trials: 4/5 SLA passes (20th-request median 4,050 ms, ~69.6% faster); three client errors traced to ALB-generated 5xx, results still stored.
  - 50/100-request bursts: six workers cut median latency 41.7% / 67.6% and p95 63.7% / 71.3%, but still exceeded 5 s.
  - Found and fixed a queue-time double-counting bug in stored timings (client-observed figures unaffected; redeploy pending).

## What currently works (core engine)
- Seeded 100×100 floorplan (24 rooms, corridors, 6 boundary exits, fully connected); demo seed `48291` → 7,450 walls, 2,544 floor, 6 exits.
- Seeded or explicit occupant starts (default `(86, 77)`); now ten distinct occupants.
- 42 fixed sensors: 12 smoke, 12 temperature, 12 occupancy, 6 door; neutral initial readings; strict runtime schemas.
- Versioned building state linking floorplan, sensors, latest readings, and timestamp.
- Safety map: distance-decayed risk per cell; hard blocks at ≥250 ppm smoke, ≥80 °C, or closed/obstructed doors; unhealthy readings ignored.
- Dijkstra routing on safety cost (N/S/E/W moves) with explicit failure reasons: `invalid_start`, `blocked_start`, `all_exits_blocked`, `unreachable_exit`.
- Independent route validator that recomputes cost and checks adjacency, blocks, exits, and state version.
- Demonstrated route change: smoke at `(86, 74)` shifts the route from a 38-step path (cost 90.59) to a safer 42-step path (cost 65.90).

## Quality and evidence
- 124 passing tests (Node built-in runner), ESLint and Prettier passing; no TypeScript, IaC, or CI/CD added.
- npm audit: 14 transitive advisories (Node-RED/jsonata); automatic fix would downgrade Node-RED 5 → 3, so not applied; documented as a local-only limitation.
- Local engine benchmark: 20/20 valid, median 32.3 ms, p95 43.2 ms — route computation only, not the official SLA.
- No secrets, certificates, or credentials committed.

## Tutor requirements
- TF-01 to TF-06 implemented and verified; TF-07 SLA measured (4/5 scaled passes, 0/5 fixed).
- TU-01 to TU-05 (ten occupants, coordinator + ALB intake, matched 1 vs 6 worker comparisons, autoscaling, five-trial SLA) all implemented and measured.

## Phase 5 application (verified 27 Aug 2026)
- Browser app at `http://127.0.0.1:1880/app/` served by the existing Node-RED process; read-only snapshot at `/api/dashboard-snapshot`.
- Shows live 100-row floorplan, ten occupants, 42 sensors/readings, validated `occupant-01` route, cardinal first-step guidance, and experiment evidence.
- Occupant picker only changes the map highlight; it does not submit cloud requests.

## Key commands
- `npm.cmd install` · `npm.cmd test` · `npm.cmd run check`
- Local workflow (4 terminals): `mqtt:broker`, `state-engine`, `node-red`, `simulate:sensors`

## Not yet done
- Persistent Timestream history / S3 experiment evidence
- Final sustainability evaluation and submission report
- Demonstration rehearsal and assessment packaging

## Known limitations (kept visible)
- 80% SLA pass rate with six workers — not a guarantee.
- Unexplained ALB-generated 502s.
- HTTP-only, unauthenticated public ALB.
- Broad `LabRole` permissions; recorded ECR scan findings.
- Git-ignored Node-RED flow reduces reproducibility.

## Next milestone
- Final submission prep: write the evaluation, decide on persistent AWS history, capture reproducible evidence, rehearse the demo.
