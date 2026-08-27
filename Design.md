# Evacuva Project Design

**Status:** Phase 4.5.4 completed and verified in AWS  
**Last updated:** 22 August 2026  
**Governed by:** `Rules.md`

## 1. Purpose of this document

This document defines what Evacuva is intended to demonstrate, how the five phases
fit together, and what evidence will be used to evaluate the result. It is a design
record, not a claim that any feature has already been implemented.

The submitted project proposal reviewed on 5 August 2026 is the primary scope source
for this design. The original PDF is not kept in the working project folder. Where
an earlier assumption conflicts with the proposal, the proposal takes priority
unless a later decision is explicitly recorded.

## 2. Problem statement

Fixed evacuation signs cannot react to simulated changes such as smoke, heat,
crowding, or an unavailable exit. Evacuva will investigate whether an event-driven
IoT system can combine changing sensor information with a building model to
calculate a lower-risk route, while continuing to respond as the number of events
and route requests increases. The submitted architecture uses Node-RED at the edge
and a queue-based AWS backend so that route requests can be buffered and processed
by automatically scaled Node.js workers.

Evacuva is a university software prototype. It is not a certified emergency system
and must not be presented as providing real-world evacuation instructions.

## 3. Research question

**Main question:**

How can an event-driven evacuation-routing prototype preserve correct route results
and useful response times as simulated sensor and route-request load increases?

**Supporting questions:**

1. How does workload size affect latency, throughput, errors, and resource usage?
2. Which parts of the route workflow become bottlenecks first?
3. Does adding route workers improve throughput, and what resource cost does that
   introduce?
4. Which measurements can responsibly act as sustainability proxies when direct
   energy measurements are unavailable?

## 4. Project objectives

Evacuva should:

1. Create reproducible simulated building scenarios.
2. Represent smoke, temperature, occupancy, and door conditions.
3. Convert sensor readings into hard blocks and soft movement penalties.
4. Calculate and independently validate a route from each simulated occupant to
   an available exit.
5. Move sensor and route messages through a local event-driven workflow.
6. Ingest accepted telemetry through AWS IoT Core using MQTT over TLS.
7. Queue independent occupant route requests in Amazon SQS and process them with
   an ECS Fargate worker pool.
8. Store operational state, history, and experiment evidence using the approved AWS
   data services.
9. Evaluate fixed and automatically scaled workers under repeatable load levels.
10. Compare correctness, performance, scalability, and resource trade-offs.
11. Produce evidence that can be explained and reproduced by the student.

### Mandatory tutor feedback

The following requirements come directly from Mehul's feedback and have the highest
project priority. A phase cannot be accepted if its relevant tutor requirement lacks
working evidence.

| ID    | Mandatory interpretation                                                                  |
| ----- | ----------------------------------------------------------------------------------------- |
| TF-01 | Generate randomised, valid floorplans whose layout and complexity vary by controlled seed. |
| TF-02 | Randomise the start by default and allow the script to set any valid walkable start cell.  |
| TF-03 | Place multiple sensors across valid coordinates and use them to map the virtual floor.    |
| TF-04 | Combine floorplan, sensor, hazard, obstacle, and door data into current building state.    |
| TF-05 | Return the safest valid route for that state, not merely a fixed or shortest known path.   |
| TF-06 | Queue route computation when consecutive requests accumulate instead of dropping work.   |
| TF-07 | Return a valid safe path for the twentieth request within 5 seconds end-to-end.           |

Randomisation is a controlled testing technique, not uncontrolled behaviour. Every
generated case must record its seed and configuration so that a failed or slow case
can be reproduced exactly.

### Tutor scaling update - 20 August 2026

The later tutor discussion changed the scaling workload from one occupant per
building update to multiple occupants sharing the same building state.

| ID    | Updated interpretation |
| ----- | ---------------------- |
| TU-01 | Generate ten distinct simulated occupants on valid walkable coordinates. |
| TU-02 | One five-second sensor batch updates the shared building state once. |
| TU-03 | A load generator submits ten independent HTTP route requests for that state version. |
| TU-04 | Compare one sequential worker with multiple automatically scaled workers. |
| TU-05 | Preserve the twentieth-request five-second SLA and test larger bursts when ten requests do not create backlog. |
| TU-06 | Put an Application Load Balancer in front of the Node.js request service. |

The updated design now has two deliberate distribution boundaries. The Application
Load Balancer distributes incoming HTTP requests across Node.js request-service
tasks. Those tasks validate and enqueue route work. SQS then distributes the queued
calculations across the autoscaled route-worker tasks. Route workers are not ALB
targets because they consume SQS messages rather than HTTP requests.

## 5. Assumptions and limitations

- The initial building is a single-floor two-dimensional grid.
- Movement is limited to north, south, east, and west.
- Sensors, occupants, hazards, and workloads are simulated.
- One route request represents one occupant start position.
- The approved periodic workload creates ten occupant requests from one shared
  state version every five seconds.
- Hazard values are experimental model parameters, not certified safety limits.
- The first route algorithm is a clear baseline, not a claim of global real-world
  safety.
- The current AWS Academy implementation uses `us-east-1`; Academy lab limits and
  budget still constrain later experiments.
- Direct electrical-energy measurement may not be available. CPU time, runtime,
  memory use, request volume, and AWS cost may be used only as declared proxies.
- Results from one computer or cloud configuration are not automatically
  generalisable to every environment.
- Multi-floor routing, real sensors, emergency-service integration, and public use
  are outside this university project.

## 6. Five-phase boundary

| Phase | Purpose                                  | Main evidence                                     |
| ----- | ---------------------------------------- | ------------------------------------------------- |
| 1     | Requirements, research, and design       | Approved design and traceability                  |
| 2     | Local evacuation baseline                | Correct routes, tests, and baseline metrics       |
| 3     | MQTT, Node-RED, and AWS IoT integration  | Validated edge-to-cloud message evidence           |
| 4     | AWS queue, workers, storage, and scaling | SLA results and fixed-versus-auto-scaled evidence  |
| 5     | Evaluation and submission                | Dashboard, analysis, limitations, report, and demo |

Later-phase files or dependencies must not be created during an earlier phase.

## 7. Functional requirements

| ID    | Requirement                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------ |
| FR-01 | The same valid seed and configuration must reproduce the same simulated scenario.                 |
| FR-02 | A scenario must contain valid walls, walkable cells, rooms, corridors, and boundary exits.         |
| FR-03 | Every occupant and sensor must be placed only on an allowed cell type.                             |
| FR-04 | Smoke, temperature, occupancy, and door readings must be validated before use.                    |
| FR-05 | Invalid or unhealthy readings must not silently influence a route.                                |
| FR-06 | The safety model must distinguish hard-blocked cells from soft movement risk.                     |
| FR-07 | A route must use only adjacent accessible cells and may finish at any safe exit.                   |
| FR-08 | The selected route must have the lowest known cost under the approved baseline algorithm.         |
| FR-09 | An independent validator must check the path, exit, blocks, state version, and reported cost.      |
| FR-10 | An impossible request must return an explicit reason instead of an empty successful result.        |
| FR-11 | Every sensor event and route request must have an ID, timestamp, scenario ID, and sequence context. |
| FR-12 | Node-RED must validate, filter, aggregate, and prioritise simulated sensor messages.               |
| FR-13 | Accepted telemetry must be forwarded to AWS IoT Core using MQTT over TLS.                           |
| FR-14 | Duplicate, invalid, noisy, and out-of-order messages must be handled predictably.                  |
| FR-15 | Amazon SQS must buffer independent route requests and support retries and a dead-letter queue.     |
| FR-16 | Stateless ECS workers must load the requested immutable state version, calculate, validate, and store one result. |
| FR-17 | ECS Service Auto Scaling must respond to queue backlog per active worker.                           |
| FR-18 | DynamoDB must store scenarios, current and versioned state, and route request/result records.       |
| FR-19 | Timestream must store sensor history, while S3 and CloudWatch retain experiment evidence.          |
| FR-20 | Route processing must expose queue time, compute time, total latency, route cost, and validity.     |
| FR-21 | Results must support a dashboard and an MQTT update to a simulated directional-sign actuator.      |
| FR-22 | The experiment runner must compare fixed and automatically scaled workers under controlled loads. |
| FR-23 | One accepted sensor batch must advance building state exactly once before route requests are submitted. |
| FR-24 | The standard periodic workload must create ten distinct occupant route requests every five seconds. |
| FR-25 | Every route request must identify its occupant, start coordinate, and immutable state version.      |
| FR-26 | An Application Load Balancer must distribute HTTP route requests across healthy request-service tasks. |
| FR-27 | Duplicate delivery must not create a second result for the same request ID.                         |
| FR-28 | The request service must validate and enqueue each request, return its ID, and expose result lookup. |
| FR-29 | SQS must distribute queued calculations across the available ECS route-worker tasks.                |

## 8. Non-functional requirements

| ID     | Quality              | Requirement                                                                    |
| ------ | -------------------- | ------------------------------------------------------------------------------ |
| NFR-01 | Correctness          | A successful route must pass independent validation.                           |
| NFR-02 | Reproducibility      | Seeds, workloads, configurations, and environments must be recorded.           |
| NFR-03 | Maintainability      | Code and files must follow `Rules.md` and have clear responsibilities.          |
| NFR-04 | Explainability       | Algorithms, formulas, and trade-offs must be understandable to the student.    |
| NFR-05 | Performance          | In a 20-request burst, the twentieth valid request must finish within 5 seconds. |
| NFR-06 | Scalability          | Functional, 20-request, 50-request, 100-request, and higher loads are compared.  |
| NFR-07 | Reliability          | Invalid input must fail clearly; failed queue messages must be retried safely.  |
| NFR-08 | Sustainability       | Resource proxies and their limitations must be reported honestly.              |
| NFR-09 | Security and privacy | Use TLS, separate device credentials, least-privilege IAM, and no committed secrets. |
| NFR-10 | Academic evidence    | Claims must link to a test, measurement, reference, or stated limitation.       |

## 9. Proposed architecture

The architecture will grow only when each phase requires the next boundary.

```text
Phase 2
Local scenario simulator -> Safety model -> Route engine -> Route validator

Phase 3
Node.js simulator -> MQTT -> Node-RED tables and batching -> Local state engine
                                                        -> AWS IoT Core over TLS

Phase 4
AWS IoT rule -> State-update queue -> State coordinator -> DynamoDB state version
                                                        |
                                                        v
Load generator -> Application Load Balancer -> Node.js request-service tasks
                                                        |
                                                        v
                                             Route-request SQS queue
                                                |       |       |
                                             Worker 1 Worker 2 Worker N
                                                \       |       /
                                                 DynamoDB route results
                                                        |
                              Result lookup through the load balancer

CloudWatch observes load-balancer traffic, queue backlog, task count, latency,
and scaling.

Phase 5
Stored results -> Dashboard, fixed-versus-auto-scaled analysis, and final demo
```

The core routing logic must not depend on MQTT, Node-RED, AWS, or a user interface.
This allows the same tested domain behaviour to run locally and inside each ECS
worker without being duplicated.

### Dependency direction

```text
Applications and integrations
            |
Core simulation, safety, and routing
            |
Shared validated contracts
```

Lower layers must not import applications or integration tools. This direction is
intended to prevent circular dependencies and duplicated business logic.

## 10. Proposed technology choices

These choices come from the submitted proposal. Exact versions and AWS settings will
be selected only when their implementation phase begins.

| Choice                         | Reason                                                                    |
| ------------------------------ | ------------------------------------------------------------------------- |
| JavaScript modules on Node.js  | One readable language shared by simulation, workers, and Node-RED.        |
| Runtime schema validation      | JavaScript objects and later network messages require explicit checks.    |
| Dijkstra's algorithm           | Clear weighted baseline for non-negative movement costs.                  |
| MQTT and Node-RED              | Small event-driven workflow suitable for simulated sensor events.         |
| AWS IoT Core                   | Secure MQTT ingestion and routing of accepted device events.              |
| Application Load Balancer      | Distribute HTTP submissions and result lookups across request-service tasks. |
| Amazon SQS and a dead-letter queue | Buffer route bursts, expose backlog, retry failures, and decouple workers. |
| Amazon ECS on Fargate          | Run stateless Node.js route workers and compare fixed with automatic scaling. |
| DynamoDB                       | Store scenario state and route request/result records by known IDs.       |
| Amazon Timestream              | Keep time-ordered sensor history separate from operational records.       |
| Amazon S3 and CloudWatch       | Retain experiment outputs, logs, alarms, and scaling/latency metrics.      |
| Built-in test runner or Vitest | Deterministic behaviour tests with minimal test configuration.            |
| JSON messages                  | Human-readable during development and demonstrations.                     |
| CSV or JSON experiment records | Simple reproducible input for later analysis and charts.                  |

The Application Load Balancer and SQS have different responsibilities. The load
balancer distributes HTTP traffic across request-service tasks. SQS stores accepted
calculation jobs and distributes them across the route-worker pool. The request
service never calculates a route, and route workers are not load-balancer targets.

Only the services named above are approved. A frontend framework, infrastructure-as-
code tool, CI/CD pipeline, Kubernetes configuration, or additional database must not
be added unless a later assessed requirement demonstrates the need.

## 11. Domain model

The exact runtime schemas will be created only in Phase 2 or Phase 3 when first
used.

### Scenario

- Scenario ID
- Seed and floorplan configuration
- Grid cells and exits
- Ten distinct simulated occupants for the standard periodic workload
- Sensor definitions
- State version
- Creation time

The simulator input will support a seed, grid and complexity settings, sensor counts,
an occupant count, and optional explicit start coordinates. If starts are not
provided, the script will select distinct coordinates from valid walkable non-exit
cells using the seeded random source. This keeps every start controllable for a
demonstration while preserving reproducible randomised coverage.

### Occupant

- Descriptive occupant ID
- Valid walkable start coordinate
- Scenario ID
- Generation seed or explicit-input source

### Sensor reading

Common fields:

- Event ID
- Scenario ID
- Sensor ID and sensor type
- Coordinate
- Timestamp
- Sequence number
- Health status

Type-specific values:

- Smoke concentration
- Temperature
- Normalised occupancy density
- Door open and obstruction state

### Current building state

- Scenario ID and monotonically increasing state version
- Complete floorplan coordinate map
- Latest accepted reading for each known sensor
- Current hazard, congestion, obstacle, and door availability map
- Time at which the snapshot became current

The coordinator will retain an immutable compact record for each state version used
by queued requests. Route workers must load that requested version instead of a
newer mutable `STATE` record. A route result must record the version it used so the
path can be traced back to the exact floorplan and sensor snapshot.

### Safety cell

- Coordinate
- Blocked status
- Smoke risk
- Temperature risk
- Congestion risk
- Total risk

### Route request

- Request ID
- Occupant ID
- Scenario ID and immutable state version
- Start coordinate
- Priority: normal or critical
- Submission time

### Route result

A successful result contains the state version, path, selected exit, total cost,
path length, visited-node count, queue time, compute time, total latency, and
algorithm version. An unsuccessful result contains a defined reason such as invalid
start, blocked start, blocked exits, or unreachable exit.

### HTTP request service

The Node.js request service provides three small HTTP boundaries:

- `POST /route-requests` validates one occupant request, sends one SQS message, and
  returns HTTP `202` with its request ID.
- `GET /route-results/{requestId}` returns either a pending response or the stored
  DynamoDB result.
- `GET /health` allows the load balancer to exclude unhealthy tasks.

The service is asynchronous because route calculation belongs to the worker pool.
It must not contain a second routing implementation. Reusing a request ID makes a
client retry safe and keeps the API result correlated with one logical request.

### Experiment record

- Experiment and run IDs
- Date and environment description
- Scenario and workload configuration
- Worker count
- Completed and failed requests
- Latency distribution
- Throughput
- CPU-time and memory proxies
- Notes about anomalies or limitations

## 12. Safety and routing model

Permanent geometry and changing safety state must remain separate. A wall is
permanent geometry. Smoke, heat, congestion, and door conditions belong to the
current scenario state.

The proposed movement model is:

```text
movement cost = base movement cost + smoke risk + heat risk + congestion risk
```

Risk may decrease with Manhattan distance from a healthy sensor. Critical smoke,
critical heat, and unavailable doors may create hard blocks. Exact values must be
configurable and documented as experimental. They will not be selected or
presented as real safety thresholds without an appropriate authoritative source.

Dijkstra's algorithm is proposed because movement costs are non-negative. The
search will stop when the cheapest reachable safe exit is selected. A later
comparison algorithm is optional and should be added only if the rubric requires
it or the evaluation has a clear research purpose.

## 13. Messaging design for Phase 3

Approved topic patterns:

```text
evacuva/scenarios/{scenarioId}/sensors/{sensorId}/readings
evacuva/scenarios/{scenarioId}/sensor-reading-batches
evacuva/scenarios/{scenarioId}/sensor-controls/manual-overrides
evacuva/scenarios/{scenarioId}/sensor-controls/resume-automatic
evacuva/scenarios/{scenarioId}/building-state/updates
evacuva/scenarios/{scenarioId}/route-requests
evacuva/scenarios/{scenarioId}/route-results/{requestId}
```

The route-request topic is reserved for the Phase 4 queue boundary. The current
local state engine creates its route request in memory and does not publish an
unconsumed MQTT request after calculation.

Messages are validated at entry. Scenario ID, state version, event ID, sequence
number, batch ID, and request ID support correlation and predictable duplicate or
out-of-order handling. Node-RED maintains the live sensor table and aggregates one
five-reading interval. A separate Node.js state engine owns the current state and
calls the existing routing package so that domain logic is not duplicated inside
Node-RED. The same accepted batch is forwarded to AWS IoT Core using MQTT over TLS;
invalid and incomplete readings never reach that output branch.

## 14. AWS design for Phase 4

Phase 3 established AWS IoT Core as the cloud ingestion boundary, and Phase 4.1
connected its accepted-batch topic to Amazon SQS. Phase 4.2 adds the first local
Node.js worker baseline. It receives one queued batch at a time, uses the shared
state-and-route operation, and deletes the SQS message only after a validated route
result. Phases 4.3.1 through 4.3.4 then added durable state, atomic result storage,
duplicate recovery, conflict retries, and a dead-letter queue. This completed a
correct single-route baseline but still combines state mutation and route
calculation in one queued operation.

The multi-occupant design separates those responsibilities before ECS scaling:

1. AWS IoT sends each accepted sensor batch to a dedicated state-update queue.
2. One state coordinator applies the batch exactly once and stores both the current
   state pointer and an immutable compact `STATE#<version>` record.
3. After that version is available, the load generator sends ten independent HTTP
   route requests through the Application Load Balancer.
4. A healthy request-service task validates each request, sends one message to the
   existing `evacuva-route-requests` queue, and returns HTTP `202` with the request
   ID.
5. Route workers load the requested immutable state version, calculate and
   validate one route, and store `RESULT#<requestId>` without modifying state.
6. The load generator retrieves each correlated result through the load balancer.
7. A repeated route message finds its existing result and is deleted safely.

The state coordinator owns state advancement only; it does not calculate routes or
submit occupant requests. The load generator retains deterministic request IDs. If
an HTTP submission is retried, the request service reuses that logical ID and the
stored result makes later SQS duplicate delivery safe. A request must never silently
use a newer state version merely because it waited in the queue.

The architecture therefore has two separate scaling signals. Request-service tasks
may scale from ALB request count per target or task CPU. Route-worker tasks scale
from SQS queue backlog per active worker. Failed route requests follow a bounded
SQS retry policy before moving to a dead-letter queue. The fixed worker
configuration and the automatically scaled configuration will be tested with the
same workloads.

SQS uses competing consumers to distribute messages among the active worker tasks,
so route workers remain outside the load-balancer target group. The ALB targets at
least two request-service tasks and uses `GET /health` for health checks. The
experiment will identify which request-service and worker task handled each request
through its task ID and CloudWatch log stream.

At the observed local baseline of approximately 100 ms per route, ten requests
represent roughly one second of sequential computation and an arrival rate of two
requests per second. Ten requests may therefore be too small to create a backlog on
one worker. This is a hypothesis, not an AWS result. The experiment must measure
10-request periodic loads and 20-, 50-, and 100-request bursts without adding
artificial delays.

Approved storage responsibilities are:

- DynamoDB: floorplans, current device state, route requests, and route results.
- Timestream: timestamped sensor history and trends.
- S3: raw experiment evidence and exported report data.
- CloudWatch: ALB request and target metrics, logs, queue/worker metrics, latency
  metrics, alarms, and scaling evidence.

Security evidence will include MQTT over TLS, separate gateway credentials,
least-privilege IoT and IAM policies, schema validation, idempotent request handling,
documented access controls for the request API, SQS retries, and the dead-letter
queue.

## 15. Testing and evaluation strategy

### Phase 2 behaviour tests

- Same seed produces the same scenario.
- Different seeds produce valid scenarios.
- At least 100 standard-profile seeds satisfy structural invariants.
- The script randomises the start by default and accepts an explicit valid start.
- An invalid, wall, or exit start is rejected with a clear reason.
- Multiple sensors are distributed only across valid cells and retain their exact
  coordinates in the current building state.
- Invalid sensor values are rejected.
- Unhealthy readings have no safety effect.
- Soft risk can produce a longer but cheaper route.
- The chosen route changes when the recorded building state changes.
- Hard blocks never appear in a successful path.
- A blocked or unreachable scenario returns the correct failure reason.
- Valid routes pass independent validation.
- Disconnected paths and incorrect costs fail validation.

### Phase 3 integration tests

- A valid sensor event produces an updated correlated route result.
- An invalid message is rejected with a clear reason.
- A duplicate event does not apply the same state change twice.
- An older sequence does not overwrite a newer accepted state.
- A broker or flow restart has a documented and tested effect.
- The configured Node-RED AWS output uses verified TLS, the approved client ID,
  QoS 1, and the accepted-batch branch.
- Consecutive five-reading batches appear on the exact AWS IoT topic.

### Phase 4 experiment design

The submitted proposal defines these workload groups:

- Functional: one and ten occupant requests using a recorded 100 by 100 state.
- Periodic: ten occupant requests generated every five seconds after one sensor
  state update.
- SLA: 20 consecutive route requests.
- Scale: bursts of 50, 100, and higher request counts where budget permits.
- Complexity: increasing grid size and hazard density.

Each configuration will be repeated rather than represented by one favourable run.
Each run will record:

- offered and completed requests
- throughput
- median and tail latency
- errors and timeouts
- worker count and queue depth where available
- ALB request count, healthy target count, and target response time
- request-service task count
- CPU time, runtime, and peak memory where measurable

### Mandatory SLA test protocol

1. Prepare one reproducible building state version and a recorded list of 20
   uniquely identified occupants with valid start coordinates.
2. Submit 20 uniquely identified route requests consecutively without waiting for
   an earlier result before submitting the next request.
3. Measure each request from its HTTP submission through the Application Load
   Balancer until the result lookup returns the correlated stored result.
4. Include queue waiting, state retrieval, graph construction, hazard weighting,
   routing, validation, result storage, and return time in end-to-end latency.
5. Count the twentieth request as successful only if its returned path passes the
   independent route validator.
6. Record ALB target response time, request-service task count, SQS queue depth,
   queue waiting time, worker count, compute time, total latency, retries, and
   errors.
7. Run at least five recorded 20-request bursts for each compared configuration,
   keeping the scenario list and test environment consistent.
8. Record warm or cold worker conditions and do not combine them without labelling
   the difference.

The periodic ten-occupant workload will be measured separately from the mandatory
20-request burst. If one worker completes ten requests without a meaningful queue,
the result will be reported honestly and the 50- and 100-request workloads will
provide the autoscaling comparison. No deterministic delay will be inserted merely
to make autoscaling appear necessary.

The SLA passes only when the twentieth request in each accepted trial returns a
valid safe path within 5 seconds end-to-end. Any failed trial must be reported and
investigated rather than removed. The report will include raw results, summary
statistics, environment details, and an explanation of unusual results. It will not
claim energy savings from CPU or memory proxies alone.

## 16. Measurable success criteria

| ID    | Criterion                                                                                 |
| ----- | ----------------------------------------------------------------------------------------- |
| SC-01 | The same seed and configuration reproduce equivalent scenario content.                    |
| SC-02 | At least 100 standard-profile seeds pass all structural invariants.                       |
| SC-03 | Every reported successful route passes independent validation.                            |
| SC-04 | No successful route contains a wall or hard-blocked cell.                                 |
| SC-05 | Known invalid, blocked, and unreachable cases return their expected failure result.       |
| SC-06 | MQTT telemetry completes a validated Node-RED-to-AWS-IoT-Core ingestion path.              |
| SC-07 | Duplicate, noisy, invalid, and out-of-order messages produce their documented result.      |
| SC-08 | Functional, 20-request, 50-request, and 100-request workloads are repeated and compared.  |
| SC-09 | The twentieth request in the controlled 20-request burst returns a valid path within 5 seconds. |
| SC-10 | Fixed and automatically scaled ECS worker configurations use the same comparison workload. |
| SC-11 | Every experiment records enough configuration and environment detail to be repeated.      |
| SC-12 | Formatting, static checks, build, and all relevant tests pass at each milestone.           |
| SC-13 | Random and explicitly selected valid start coordinates both produce testable requests.    |

The five-second SLA comes directly from the submitted proposal. No additional
latency or throughput target will be invented before the baseline is measured.

## 17. Requirement traceability

| Requirement group | Planned phase | Planned evidence                                             |
| ----------------- | ------------- | ------------------------------------------------------------ |
| FR-01 to FR-03    | Phase 2       | Generator tests and structural invariants                    |
| FR-04 to FR-06    | Phase 2       | Contract and safety-model tests                              |
| FR-07 to FR-10    | Phase 2       | Routing tests, validator results, and local demonstration     |
| FR-11             | Phases 2-3    | Shared message contracts and traceability tests               |
| FR-12 to FR-14    | Phase 3       | Node-RED and AWS IoT Core integration tests                   |
| FR-15 to FR-20    | Phase 4       | AWS deployment records, tests, logs, and metrics              |
| FR-21             | Phases 3 and 5 | MQTT actuator response and final route visualisation         |
| FR-22             | Phase 4       | Fixed-versus-auto-scaled workload evidence                    |
| NFR-01 to NFR-04  | All phases    | Reviews, tests, documentation, and student explanation        |
| NFR-05 to NFR-08  | Phases 2-5    | Baseline and scalability results with limitations             |
| NFR-09            | Phases 2-4    | Boundary validation and repository review                     |
| NFR-10            | All phases    | Traceability, references, evidence, and final critical review |
| TF-01 to TF-05    | Phase 2       | Reproducible generator, state-map, route, and validation tests |
| TF-06             | Phase 4       | SQS queue-depth, waiting-time, and completion evidence         |
| TF-07             | Phase 4       | Mandatory repeated 20-request SLA test                        |

## 18. Source and citation plan

The submitted proposal reviewed on 5 August 2026 is the source for the approved
project concept, AWS architecture, service responsibilities, workloads, and SLA
recorded in this document. Mehul's written feedback, supplied on 5 August 2026, is
the source for the mandatory `TF` requirements and their priority. Later technical
explanations will cite authoritative sources for MQTT, Node-RED, and each
implemented AWS service when those phases begin. References will use the
university's required style when that style is confirmed.

The Phase 2 routing algorithm is based on Dijkstra's original shortest-path work:
Dijkstra, E. W. (1959), "A Note on Two Problems in Connexion with Graphs",
*Numerische Mathematik*, 1, pp. 269-271,
[doi:10.1007/BF01386390](https://doi.org/10.1007/BF01386390).

## 19. Decisions deferred to their owning phase

The project scope, architecture, requirements, and evidence plan are approved. The
following operational values will be agreed at the start of the phase that first
uses them. Deferring these values avoids unsupported choices before baseline or
platform evidence exists; they must still be resolved before related code is added.

| Owning phase | Decisions to resolve before implementation                                      |
| ------------ | ------------------------------------------------------------------------------ |
| Phase 2      | Resolved in Section 21 before local implementation begins.                       |
| Phase 3      | QoS/retention, noise handling, critical priority and sign behaviour before use.  |
| Phase 4      | AWS region/budget, worker limits, scaling threshold, retention and API need.    |
| Phase 5      | Final submission items, referencing style and dashboard presentation.           |

## 20. Phase 1 completion checklist

- [x] The submitted proposal has been checked against this design.
- [x] Mehul's high-priority comments are represented as mandatory requirements.
- [x] Functional and non-functional requirements are approved.
- [x] In-scope and excluded features are approved.
- [x] Architecture and dependency direction are approved.
- [x] Technology choices are approved.
- [x] Testing and experiment evidence are approved.
- [x] Traceability contains the proposal and tutor requirements.
- [x] The citation plan is defined; final style is assigned to Phase 5.
- [x] Phase-specific operational decisions are assigned in Section 19.
- [x] `Design.md` has been reviewed against every applicable rule in `Rules.md`.

Phase 1 is approved. This status confirms the design baseline only and does not
claim that any application feature has been implemented.

## 21. Phase 2 local baseline specification

**Milestone:** Phase 2.1 - simulation defaults and contract design  
**Status:** Approved specification

### 21.1 Scope

Phase 2 will create a local, deterministic baseline for the tutor requirements
`TF-01` to `TF-05`. It will generate a virtual building, create a versioned current
state from multiple sensors, calculate the lowest-risk valid route, independently
validate that route, and report local baseline metrics.

Phase 2 excludes MQTT, Node-RED, AWS, dashboards, physical devices, deployment
configuration, and SLA claims. These depend on the tested local engine and belong to
later phases.

### 21.2 Default simulation configuration

Phase 2 starts with one approved 100x100 building profile. The grid size is fixed in
this phase so implementation and tests do not carry unused complexity. Seed, room
placement, corridors, exits, sensors, hazards, and the occupant start still vary in
a controlled and reproducible way.

| Setting                      | Default or rule                                      |
| ---------------------------- | ---------------------------------------------------- |
| Demonstration seed           | `48291`                                              |
| Main demonstration grid      | 100 columns by 100 rows                              |
| Rooms                        | 24 rectangular rooms                                 |
| Exits                        | 6 exits on the grid boundary                         |
| Room size                    | 5 to 14 cells per side                               |
| Smoke sensors                | 12                                                   |
| Temperature sensors          | 12                                                   |
| Occupancy sensors            | 12                                                   |
| Door sensors                 | 1 for each exit                                      |
| Random start                 | Seeded choice from any walkable, non-exit cell       |
| Explicit start               | Accepted only when it is a walkable, non-exit cell   |
| Movement                     | North, south, east, and west only                    |
| Initial state version        | 1                                                    |
| Time representation          | ISO 8601 UTC string                                  |

The 100x100 map contains 10,000 cells and 42 sensors when the six door sensors are
included. A larger grid may be introduced only during the approved Phase 4
complexity experiment, after the 100x100 baseline has been measured. No 40x40
profile is part of the project.

Permanent obstacles are represented as wall cells. Temporary obstacles, unavailable
doors, and hazards belong to the changing safety state rather than the permanent
floorplan.

Configuration validation will accept sensible local experiment ranges:

- grid width and height: exactly 100 cells during Phase 2
- room count: 2 to 50
- exit count: 1 to 8
- minimum room side: 3 to 12 cells
- maximum room side: 4 to 20 cells
- seed: non-negative integer

The maximum room side must not be smaller than the minimum or exceed the available
grid interior. A configuration that cannot produce the requested building must fail
clearly rather than return an incomplete floorplan.

### 21.3 Controlled randomisation

One deterministic pseudo-random source will control room candidates, corridor
orientation, exit placement, sensors, hazards, and the default start. The same seed
and configuration must reproduce equivalent scenario content. Different seeds are
expected to vary the layout, but every generated scenario must still pass the same
structural rules.

The generator will:

1. Fill the grid with walls.
2. Place non-overlapping rectangular rooms inside the boundary.
3. Carve each accepted room into walkable cells.
4. Connect room centres using L-shaped corridors.
5. Place exits on boundary coordinates and connect them to the floor network.
6. Select or validate the occupant start.
7. Place environmental sensors on floor cells and door sensors on exits.
8. Validate the completed scenario independently.

### 21.4 Runtime contract boundaries

Runtime schemas will validate data entering the core system. JavaScript object
shapes alone are not sufficient because later phases receive JSON from MQTT and AWS.

#### Coordinate

- non-negative integer `x` and `y`
- must be inside the referenced floorplan when used in a scenario

#### Floorplan configuration

- seed, width, height, room count, exit count, and room-size limits

#### Floorplan cell

- coordinate
- type: `wall`, `floor`, or `exit`
- optional room identifier where the cell belongs to a generated room

#### Floorplan

- floorplan ID
- validated configuration
- exactly one cell for every grid coordinate
- unique boundary exit coordinates matching exit cells

#### Sensor definition

- sensor ID
- type: `smoke`, `temperature`, `occupancy`, or `door`
- valid coordinate

Smoke, temperature, and occupancy sensors belong on floor cells. Door sensors belong
on exit cells.

#### Sensor reading

Every reading contains an event ID, scenario ID, sensor ID, coordinate, timestamp,
sequence number, and health status. Its value depends on the sensor type:

- smoke: non-negative parts per million
- temperature: Celsius value from -50 to 300 for input validation
- occupancy: density from 0 to 1
- door: open and obstructed flags

#### Current building state

- scenario ID and state version
- floorplan and occupant start
- known sensor definitions
- one latest accepted reading per sensor
- state update time

#### Route request

- request ID, scenario ID, and required state version
- start coordinate
- priority: `normal` or `critical`
- submission time

#### Route result

A successful result contains the state version, ordered path, selected exit, route
cost, path length, visited-node count, queue time, compute time, total latency, and
algorithm version. During Phase 2, queue time is zero and total latency measures the
local call; the fields remain compatible with the later queued workflow.

An unsuccessful result contains no path and returns one reason: invalid start,
blocked start, all exits blocked, or unreachable exit.

### 21.5 Initial sensor state

The reproducible normal starting state is:

- smoke: 0 parts per million
- temperature: 22 degrees Celsius
- occupancy density: 0.1
- doors: open and unobstructed
- sensors: healthy with sequence number 1

These values exist only to create a neutral initial simulation. Tests will replace
them with controlled hazard readings.

### 21.6 Experimental safety parameters

The following values are configurable model parameters, not real emergency limits:

| Parameter                         | Phase 2 default |
| --------------------------------- | --------------- |
| Base movement cost                | 1               |
| Smoke risk weight                 | 12              |
| Smoke influence radius            | 4 cells         |
| Critical smoke value              | 250 ppm         |
| Critical smoke block radius       | 1 cell          |
| Temperature risk weight           | 10              |
| Temperature influence radius      | 3 cells         |
| Temperature risk begins           | 35 C            |
| Critical temperature              | 80 C            |
| Critical temperature block radius | 1 cell          |
| Congestion risk weight            | 8               |
| Congestion influence radius       | 2 cells         |

Risk reduces with Manhattan distance:

```text
falloff(distance, radius) = max(0, 1 - distance / (radius + 1))

smoke risk = 12 * clamp(smoke ppm / 250, 0, 1) * falloff(distance, 4)

temperature risk = 10 * clamp((temperature C - 35) / (80 - 35), 0, 1)
                   * falloff(distance, 3)

congestion risk = 8 * density * falloff(distance, 2)

movement cost = 1 + smoke risk + temperature risk + congestion risk
```

Smoke at or above 250 ppm and temperature at or above 80 C block affected cells
within Manhattan distance 1. A closed or obstructed door blocks its exit coordinate.
Unhealthy sensors have no safety effect.

### 21.7 Phase 2.1 completion evidence

- [x] Local scope and exclusions are explicit.
- [x] Default scenario and controlled randomisation rules are defined.
- [x] Random and explicit start behaviour is defined.
- [x] Runtime contract responsibilities are defined without implementation detail.
- [x] Current state and route result traceability are defined.
- [x] Experimental hazard values are configurable and labelled honestly.
- [x] Behaviour tests required by the tutor comments are already listed in Section 15.
- [x] No application code, dependencies, or later-phase scaffolding were created
      during the Phase 2.1 design milestone.

## 22. Phase 2 JavaScript foundation

**Milestone:** Phase 2.2 - minimal local workspace and first contracts  
**Status:** Completed on 5 August 2026

Phase 2 uses plain JavaScript ES modules on Node.js 24. It does not use TypeScript.
At the completion of this milestone, the workspace contained one justified shared
package for contracts because the same runtime schemas will later be consumed by the
simulator, Node-RED boundary, and ECS workers.

The only runtime dependency is Zod for validating JavaScript objects and later JSON
messages. ESLint and Prettier are development-only quality tools. Tests use Node's
built-in `node:test` and `node:assert` modules, avoiding an unnecessary test package.

This milestone's implemented boundary included only:

- non-negative integer coordinate validation
- the fixed 100x100 Phase 2 configuration
- room, exit, and room-size limits
- the approved seed and 24-room, 6-exit defaults

The floorplan generator, cells, sensors, state, safety model, routing, MQTT, and AWS
are not implemented in this milestone.

### 22.1 Phase 2.2 verification

- [x] Node.js 24 runs the project as JavaScript ES modules.
- [x] The four contract behaviour tests pass with Node's test runner.
- [x] ESLint reports no issues.
- [x] Prettier reports no formatting differences.
- [x] The dependency audit reports no known vulnerabilities.
- [x] No TypeScript, generator, cloud, deployment, or future-phase files exist.
- [x] The implementation and dependencies were reviewed against `Rules.md`.

## 23. Seeded floorplan generation

**Milestone:** Phase 2.3 - deterministic 100x100 floorplan  
**Status:** Completed on 5 August 2026

The local core package now generates the permanent building layout required by
`TF-01` and `FR-02`. One seeded pseudo-random source controls room candidates,
corridor orientation, and exit positions. Twenty-four non-overlapping rectangular
rooms are carved inside the boundary, their centres are joined by corridors, and
six boundary exits are connected to the same walkable network.

The generator returns a complete 10,000-cell floorplan and validates it at the
runtime contract boundary. A separate breadth-first connectivity validator checks
that the expected room identifiers exist and every non-wall cell belongs to one
connected network. Invalid generation fails with an explicit error rather than
returning a partial map.

For the approved demonstration seed `48291`, the verified output contains 7,450
wall cells, 2,544 floor cells, and 6 exit cells. Its exit coordinates are `(90, 0)`,
`(99, 52)`, `(70, 99)`, `(0, 30)`, `(72, 0)`, and `(99, 30)`. These figures describe
this seed only and are not performance results.

Sensors, occupant placement, changing hazards, route calculation, MQTT, and AWS are
deliberately excluded from this milestone. They remain assigned to their approved
later milestones.

### 23.1 Phase 2.3 verification

- [x] The default output is exactly 100 columns by 100 rows and 10,000 cells.
- [x] The default output contains 24 rooms and 6 boundary exits.
- [x] Reusing a seed reproduces the same floorplan.
- [x] Different seeds produce different floorplan content.
- [x] One hundred consecutive seeds pass the structural and connectivity checks.
- [x] A deliberately blocked exit is rejected by the independent validator.
- [x] All ten project tests, ESLint, and Prettier checks pass.
- [x] No sensor, routing, cloud, deployment, or other later-phase code was added.
- [x] The implementation and dependency direction were reviewed against `Rules.md`.

## 24. Initial building state

**Milestone:** Phase 2.4 - occupant, sensors, and neutral initial readings  
**Status:** Completed on 5 August 2026

The scenario generator now combines a generated floorplan with one occupant start,
42 sensor definitions, one initial reading per sensor, and state version 1. The
environmental sensors occupy 36 unique floor coordinates: 12 smoke, 12 temperature,
and 12 occupancy sensors. Each of the six exit cells has one door sensor.

The default occupant start is selected by the seeded random source from walkable,
non-exit floor cells. A caller may instead supply an explicit coordinate, which is
accepted only when it refers to the same allowed cell type. Changing only the start
does not change the seeded floorplan or sensor placement.

The initial readings use the approved neutral values: zero smoke, 22 C temperature,
0.1 occupancy density, and open unobstructed doors. Every reading starts healthy at
sequence 1 and retains its scenario ID, sensor ID, coordinate, event ID, and
timestamp. Runtime validation rejects readings outside their allowed value range,
unknown or duplicate sensors, mismatched coordinates or types, and missing latest
readings.

The default simulation timestamp is the fixed value
`2026-08-05T00:00:00.000Z`, so an unchanged seed reproduces the complete initial
state. Tests and later callers can supply another ISO 8601 timestamp. This field is
simulation input and must not be interpreted as the computer's current time.

For demonstration seed `48291`, the verified default occupant start is `(86, 77)`.
This coordinate is specific to the current approved generator and seed.

Hazard influence, changing sensor events, safety costs, path calculation, MQTT, and
AWS are deliberately excluded from this milestone.

### 24.1 Phase 2.4 verification

- [x] The initial state contains 12 sensors for each environmental type and 6 door
      sensors, with one validated reading for every sensor.
- [x] Environmental sensors use unique floor cells and door sensors use exit cells.
- [x] The default start is a seeded floor coordinate and a valid explicit start is
      accepted without changing sensor placement.
- [x] Wall and exit start coordinates are rejected clearly.
- [x] The same seed and timestamp reproduce the complete state.
- [x] Invalid value ranges and mismatched reading scenario IDs are rejected.
- [x] One hundred consecutive scenario seeds pass the state contract.
- [x] All 19 project tests, ESLint, and Prettier checks pass.
- [x] No new package dependency or later-phase integration file was added.
- [x] The implementation and dependency direction were reviewed against `Rules.md`.

## 25. Safety map and safest-route baseline

**Milestone:** Phase 2.5 - local risk-weighted routing and validation  
**Status:** Completed on 5 August 2026

The safety map now keeps permanent walls separate from the changing readings in a
building-state snapshot. Each healthy smoke, temperature, and occupancy reading
adds its approved distance-based risk to affected walkable cells. Contributions
from multiple healthy sensors are added together. Critical smoke and temperature
block cells within their configured block radius. A healthy closed or obstructed
door blocks its exit. An unhealthy reading is ignored and therefore has no safety
effect.

The local route function accepts a validated request containing request ID,
scenario ID, state version, start, priority, and submission time. It applies
Dijkstra's algorithm to north, south, east, and west movements with non-negative
cell-entry costs. The starting cell has no entry cost. Search stops when the
lowest-cost available exit is removed from the priority queue.

A separate route validator does not call the route search. It checks request,
scenario, and state-version correlation; the first and last coordinates; exit
availability; adjacency; blocked cells; reported path length; and a recalculated
route cost. The route engine returns a successful result only after this validator
passes. Defined failure reasons are `invalid_start`, `blocked_start`,
`all_exits_blocked`, and `unreachable_exit`.

The controlled smoke test demonstrates the difference between shortest and safest.
For seed `48291`, adding a soft smoke reading at `(86, 74)` makes the original
38-step shortcut cost `90.5888`. The selected alternative is 42 steps with cost
`65.904`. At the critical smoke value, the returned route still succeeds without
using any hard-blocked cell.

### 25.1 Local baseline measurement

A single local diagnostic run submitted 20 route calculations consecutively against
the unchanged seed `48291` state. Scenario generation happened before measurement.
Each recorded total includes state and request validation, safety-map construction,
route search, and the route engine's independent validation. It excludes MQTT,
queue waiting, AWS state retrieval, storage, and network return time.

| Setting or result       | Recorded value                              |
| ----------------------- | ------------------------------------------- |
| Node.js                 | 24.16.0                                     |
| Platform                | Windows x64                                 |
| CPU                     | 12th Gen Intel Core i5-12450H               |
| Grid and seed           | 100x100, seed 48291                         |
| Requests                | 20 sequential local calls                   |
| Successful and valid    | 20 of 20                                    |
| Median total latency    | 32.2587 ms                                  |
| 95th-percentile latency | 43.1570 ms                                  |
| Maximum total latency   | 56.0137 ms                                  |
| Twentieth request       | Valid, 32.2806 ms total, 14.2442 ms compute |

This is a measured routing-only baseline from one machine and one run. It is not the
mandatory five-second SLA result because no SQS queue, ECS worker, storage, or
end-to-end return path exists yet. The repeated Phase 4 protocol remains required,
and these local figures must not be generalised to AWS performance.

### 25.2 Phase 2.5 verification

- [x] Smoke, temperature, and occupancy risks match the approved formulas.
- [x] Critical smoke, critical temperature, and unavailable doors create hard
      blocks.
- [x] Unhealthy readings have no effect on safety costs or blocks.
- [x] A soft-risk case selects a longer but lower-cost route.
- [x] Successful routes contain only adjacent, accessible cells and finish at an
      available exit.
- [x] Invalid, blocked, all-exits-blocked, and unreachable cases return their
      defined failure reason.
- [x] The independent validator rejects disconnected paths, incorrect costs, and
      stale state versions.
- [x] Twenty generated scenarios return independently valid routes.
- [x] All 32 project tests, ESLint, and Prettier checks pass.
- [x] The Dijkstra source is cited and the experimental safety values remain
      labelled as non-certified model parameters.
- [x] No new dependency, messaging integration, cloud resource, or deployment file
      was added.
- [x] The implementation and dependency direction were reviewed against `Rules.md`.

## 26. Phase 3 event contracts and naming

**Milestone:** Phase 3.1 - message boundaries and descriptive names  
**Status:** Completed on 6 August 2026

Phase 3 begins with validated messages before any broker or flow is introduced.
The automatic sensor interval is fixed at 5,000 milliseconds. Manual overrides are
defined as immediate commands and remain conceptually active until a separate
resume-automatic command is accepted. Timer execution, override storage, MQTT, and
Node-RED behaviour belong to the next implementation milestones.

Generated sensor IDs now describe their purpose and use a two-digit number:

```text
smoke-sensor-01
temperature-sensor-01
occupancy-sensor-01
exit-door-sensor-01
```

Runtime contracts reject ambiguous IDs such as `sensor-1` and reject a sensor ID
whose type does not match its message. Implemented message types are:

- `sensor-reading`, including `automatic-simulator` or `manual-control` source
- `manual-sensor-override`
- `resume-automatic-sensor`
- `building-state-updated`
- `route-calculation-requested`
- `route-calculation-result`

State-update messages must increase the previous version by exactly one. Route
messages retain the existing validated request and result contracts. Topic patterns
are stored as shared constants so later Node.js, Node-RED, and AWS boundaries use
the same descriptive names.

### 26.1 Phase 3.1 verification

- [x] Existing scenarios use descriptive sensor IDs and still pass all local tests.
- [x] The agreed five-second automatic interval is represented once as a named
      domain value.
- [x] Sensor, manual override, resume, state update, route request, and route result
      envelopes have runtime validation.
- [x] Ambiguous sensor IDs, mismatched manual types, and skipped state versions are
      rejected.
- [x] All 34 project tests, ESLint, and Prettier checks pass.
- [x] No timer, MQTT package, broker, Node-RED flow, AWS resource, secret, or
      deployment file was added.
- [x] The changes were reviewed against `Rules.md`.

## 27. Automatic sensor simulator

**Milestone:** Phase 3.2 - non-blocking scripted sensor events  
**Status:** Completed on 6 August 2026

One Node.js simulator process now contains 42 independent logical sensor nodes. It
does not create 42 operating-system processes. Every node owns its sensor ID, type,
coordinate, current reading, and sequence number. Advancing one node does not alter
another node's sequence. Every five seconds the shared scheduler processes one
batch containing five different sensors and emits a validated `sensor-reading`
event for each available automatic node.

Events can be delivered to the original local callback and console runner or
published through the Phase 3.4 MQTT runner. They are not yet applied to the
building state automatically. The shared process avoids unnecessary
operating-system overhead, while separate logical state preserves the behaviour
expected from individual simulated devices.

The default emergency script contains 12 batches and 60 total readings:

| Batch | Sensors changed                                              | Purpose                |
| ----- | ------------------------------------------------------------ | ---------------------- |
| 1     | Smoke 01-03, temperature 01, occupancy 01                    | Initial warning        |
| 2     | Smoke 04-06, temperature 02, occupancy 02                    | Wider smoke detection  |
| 3     | Smoke 07-09, temperature 03, occupancy 03                    | Wider smoke detection  |
| 4     | Smoke 10-12, temperature 04, occupancy 04                    | All smoke nodes reached |
| 5     | Temperature 05-07, occupancy 05-06                           | Heat and crowd growth  |
| 6     | Temperature 08-10, occupancy 07-08                           | Heat and crowd growth  |
| 7     | Temperature 11-12, occupancy 09-11                           | All heat nodes reached |
| 8     | Occupancy 12 and exit doors 01-04                            | Door obstruction       |
| 9     | Exit doors 05-06, smoke 01, temperature 01, occupancy 01     | Critical conditions    |
| 10    | Smoke 02-03, temperature 02, occupancy 02, exit door 02      | Hazard movement        |
| 11    | Smoke 01-02, temperature 01, occupancy 01, exit door 02      | Early recovery         |
| 12    | Smoke 01-02, temperature 01, occupancy 01, exit door 06      | Recovery               |

Every one of the 42 sensors is included at least once during the 60-second cycle.
The batches then repeat while sequence numbers continue increasing independently.
Every emitted event records its actual emission timestamp, sensor coordinate, next
sequence number, and `automatic-simulator` source.

Scheduling uses a recursive non-blocking timer rather than a loop or blocking sleep.
The next five-second timer is scheduled only after all event callbacks in the
current batch have finished. This prevents overlapping publishes if a later MQTT
or Node-RED boundary is temporarily slow. Tests call the direct `advance` operation,
so the suite does not contain five-second waits.

The simulator command is:

```text
npm.cmd run simulate:sensors
```

After MQTT became mandatory in Phase 3.4, this command was consolidated into the
MQTT-enabled runner and therefore requires the local broker. Direct simulator tests
still exercise the sensor callback boundary without MQTT or five-second waits.

An observed runtime check printed all five first-batch values in the terminal at
the same timestamp: smoke 01 at 60 ppm, smoke 02 at 45 ppm, smoke 03 at 30 ppm,
temperature 01 at 32 C, and occupancy 01 at 0.35 density.

### 27.1 Phase 3.2 verification

- [x] One Node.js process contains exactly 42 independent logical sensor nodes.
- [x] Each node owns and increments its reading sequence without changing another
      node.
- [x] Every normal interval produces five contract-valid automatic sensor events.
- [x] One complete 60-event cycle reaches all 42 sensors.
- [x] A complete cycle and the continuing per-sensor sequence are tested.
- [x] Empty or incorrectly sized batches, repeated or unknown sensors, and invalid
      values are rejected.
- [x] The scheduler uses the approved 5,000-millisecond interval.
- [x] A new interval is not scheduled until all five callbacks finish.
- [x] The runnable command printed all five values from a real timed batch.
- [x] All 45 project tests, ESLint, and Prettier checks pass.
- [x] No MQTT dependency, manual-control implementation, Node-RED flow, AWS
      resource, secret, or deployment file was added.
- [x] The changes were reviewed against `Rules.md`.

## 28. Manual sensor override and resume

**Milestone:** Phase 3.3 - per-sensor manual control  
**Status:** Completed on 6 August 2026

The local simulator now accepts the validated `manual-sensor-override` and
`resume-automatic-sensor` commands defined in Phase 3.1. This is a programmatic
Node.js boundary. MQTT delivery is implemented in Phase 3.4; the user-facing
Node-RED controls remain a later Phase 3 milestone.

An accepted override immediately emits a contract-valid sensor reading with the
`manual-control` source and places only that logical sensor node in manual mode.
Further automatic batch values for that node are retained as its latest automatic
value but are not emitted. The remaining nodes in that batch continue normally, so
one override does not pause the other sensors or block the Node.js event loop.

An accepted resume command returns the selected node to automatic mode without
emitting immediately. On the next scheduler cycle, the node emits its latest
scripted automatic value. If the resumed node is already selected by that batch,
it emits only once. This makes the transition predictable and keeps the five-second
automatic schedule intact. Repeating a manual override is allowed; resuming a
sensor that is already automatic is rejected with a clear error.

Commands are rejected when their runtime schema is invalid, their scenario does
not match the running simulator, or their sensor is unavailable. Each emitted
reading continues the selected node's sequence number, regardless of whether its
source is automatic or manual.

Manual commands are processed synchronously by the local simulator, while automatic
batches remain on the five-second timer. This is local simulator behaviour only;
it is not an MQTT, cloud, or official five-second SLA measurement.

### 28.1 Phase 3.3 verification

- [x] A valid manual command immediately emits a `manual-control` reading.
- [x] Manual mode belongs only to the selected logical sensor node.
- [x] Automatic steps for an overridden node are suppressed without increasing
      its emitted sequence.
- [x] Other selected sensor nodes in the same batch continue without blocking or
      timer sleeps.
- [x] Resume returns the node to automatic mode and publishes its latest scripted
      value on the next cycle without a duplicate event.
- [x] Different-scenario, unavailable-sensor, invalid-value, and duplicate-resume
      cases are rejected.
- [x] Direct tests verify timing behaviour without real five-second delays.
- [x] All 45 project tests, ESLint, and Prettier checks pass.
- [x] No new file, dependency, MQTT integration, Node-RED flow, AWS resource,
      secret, or deployment configuration was added.
- [x] The implementation and documentation were reviewed against `Rules.md`.

## 29. Local MQTT communication

**Milestone:** Phase 3.4 - local broker and simulator messaging  
**Status:** Completed on 6 August 2026

The local messaging boundary uses MQTT.js 5.15.2 as the Node.js client and Aedes
1.1.1 as an in-memory MQTT 3.1.1 broker. Both packages were checked against their
current registry engine requirements before installation. MQTT.js is maintained at
<https://github.com/mqttjs/MQTT.js> and Aedes at
<https://github.com/moscajs/aedes>.

The broker listens on `127.0.0.1:1883` by default, so it is reachable only from the
local machine. It has no authentication, TLS, disk persistence, clustering, or
production configuration. Those exclusions are deliberate for this university
baseline. An ephemeral port can be selected in tests to prevent port conflicts.

The existing topic patterns are now used at runtime:

```text
evacuva/scenarios/{scenarioId}/sensors/{sensorId}/readings
evacuva/scenarios/{scenarioId}/sensor-controls/manual-overrides
evacuva/scenarios/{scenarioId}/sensor-controls/resume-automatic
```

Every automatic or manual reading is validated before it is serialized as JSON and
published to its sensor-specific topic. Messages use QoS 1 and are not retained.
The simulator subscribes to the two control topics at QoS 1. Valid manual commands
immediately publish a `manual-control` reading; valid resume commands restore the
selected logical node for its next automatic cycle.

QoS 1 can redeliver a message. The local connection therefore remembers accepted
control `commandId` values and ignores a duplicate during the current process run.
This memory is intentionally not persistent. Sensor event IDs allow the later
Node-RED state flow to detect duplicate reading delivery in Phase 3.5.

Malformed JSON, invalid contracts, unavailable sensors, and scenario mismatches are
reported through the error callback without stopping later valid publishing. The
client uses a clean MQTT 3.1.1 session and disables hidden reconnect retries for
this local milestone, so an unavailable broker produces a clear startup failure.

The two verified runners are started in separate terminals:

```text
npm.cmd run mqtt:broker
npm.cmd run simulate:sensors
```

A real two-process run connected the simulator to an ephemeral local broker and
printed five successful per-sensor publishes on the first five-second interval. A
separate real command check published smoke value 250 through the manual topic and
accepted the resume command through the resume topic.

### 29.1 Phase 3.4 verification

- [x] The local Node.js broker starts on the configured loopback host and port.
- [x] Five automatic readings are delivered through five descriptive sensor topics.
- [x] Published payloads pass the existing sensor-reading runtime contract.
- [x] Manual override and resume commands are received through their control topics.
- [x] A manual command immediately produces a published manual reading.
- [x] A repeated QoS 1 control command ID does not change the sensor twice.
- [x] Malformed JSON is reported and later valid publishing continues.
- [x] A different-scenario reading and an unavailable broker are rejected.
- [x] Real integration tests use an actual ephemeral TCP broker without five-second
      test sleeps.
- [x] All 49 project tests, ESLint, and Prettier passed at this milestone.
- [x] No Node-RED flow, AWS resource, state aggregator, route trigger, Docker file,
      deployment configuration, secret, or production broker feature was added.
- [x] The implementation and documentation were reviewed against `Rules.md`.

## 30. Local Node-RED tables and state workflow

**Milestone:** Phase 3.5 - local dashboard, batching, state, and route results  
**Status:** Completed on 6 August 2026

The Node-RED runtime binds to `127.0.0.1:1880` and uses FlowFuse Dashboard 2.0.
Its overview page contains three actual `ui-table` widgets: live sensor readings,
building-state updates, and safest-route results. It also contains manual override
and resume forms. These controls publish the same validated MQTT commands already
accepted by the sensor simulator; they do not bypass that boundary.

Four native Debug nodes expose raw readings, accepted reading batches,
building-state updates, and route results in the Node-RED Debug sidebar. They are
used for the local demonstration and do not add another processing Function node.

The sensor flow subscribes to all 42 per-sensor topics. It performs the first
network-boundary checks, rejects stale per-sensor sequences, and keeps one latest
row per sensor. Five automatic readings sharing an interval timestamp become one
`sensor-reading-batch`. A manual reading becomes a one-reading batch immediately.
Both forms use clear sensor IDs rather than hypothetical device names.

The separate state-engine application subscribes to the batch topic and performs
the authoritative runtime-schema validation. It replaces the accepted latest
readings, increases the building state by exactly one version, creates the
in-memory request required by the route engine, and calls the existing core route
calculation and independent validator. It publishes the correlated state update
and route result through MQTT. Queue-bound route-request publication remains Phase
4 work. Keeping this work in Node.js means Node-RED orchestrates messages and
tables without becoming a second implementation of the safety or Dijkstra logic.

The local runtime remains intentionally in memory. Restarting Node-RED clears its
table rows and sequence cache; restarting the state engine returns to the seeded
initial state. MQTT uses QoS 1 without retained messages. Persistent state and
restart recovery belong to the approved AWS storage phase rather than this local
milestone.

The local `flows.json` and its flow-specific test are ignored by Git at the
student's request. This keeps the visually edited Node-RED flow on the development
computer, but it means the repository alone cannot reproduce the dashboard. A
manual demonstration or separately submitted Node-RED export is therefore required
as assessment evidence.

One real run started the broker, state engine, Node-RED, and sensor simulator. The
dashboard page returned HTTP 200. Eleven consecutive five-reading batches produced
state versions 2 through 12, and every recorded route result was successful and
independently validated. This is functional integration evidence, not the official
twentieth-request SLA experiment.

### 30.1 Phase 3.5 verification

- [x] The dashboard renders a sensor table, building-state table, and route-result
      table at the verified local URL.
- [x] The live sensor table can contain one latest row for each of the 42 sensors.
- [x] Manual override and resume controls publish descriptive MQTT commands.
- [x] Malformed, mismatched, and stale readings are rejected before state use.
- [x] Five automatic readings create one batch, one state version, and one route.
- [x] A manual reading creates an immediate one-reading state update.
- [x] The state engine reuses the existing core route logic instead of duplicating
      it in Node-RED.
- [x] All 57 project tests, ESLint, and Prettier checks pass.
- [x] The real local workflow and dashboard HTTP endpoint were exercised.
- [x] No AWS resource, Docker file, deployment configuration, CI/CD file, database,
      or speculative production layer was added.
- [x] Node-RED's current transitive audit advisories and loopback-only limitation
      are recorded honestly in `Progress.md`.
- [x] The implementation and documentation were reviewed against `Rules.md`.

## 31. AWS IoT Core ingestion

**Milestone:** Phase 3.6 - validated edge-to-cloud publishing  
**Status:** Completed on 15 August 2026

The existing Node-RED accepted-batch output now has one additional destination. A
local state-engine subscriber still receives the batch, while an AWS MQTT output
publishes the same message to AWS IoT Core. This preserves the working local route
workflow and avoids a second validation or batching implementation.

The AWS connection uses:

- region `us-east-1`
- MQTT 3.1.1 over TLS on port 8883
- client ID and Thing name `evacuva-node-red-edge`
- policy `evacuva-node-red-edge-policy`
- QoS 1 with retained messages disabled
- server-certificate verification using the Amazon root CA
- one permitted publish topic:
  `evacuva/scenarios/scenario-48291/sensor-reading-batches`

The device certificate, private key, and root CA are local files outside the
project folder. Their contents are not present in source code, `flows.json`, or
project documentation. Node-RED stores only the external file paths. The IoT policy
allows this certificate to connect only as the attached Thing's client ID and to
publish only to the approved scenario batch topic. Subscribe and receive
permissions were deliberately excluded because Node-RED does not need them in this
milestone.

The first policy version accidentally contained the placeholder `ACCOUNT_ID`, so
AWS completed TLS but rejected MQTT authorisation. Policy version 2 replaced both
placeholders with account `620491751244` and became the default. This is recorded as
a genuine configuration defect and verification case rather than hidden from the
project evidence.

After correction, Node-RED displayed a green connected state. The AWS IoT MQTT test
client received consecutive five-reading batches at approximately five-second
intervals. Recorded evidence includes batch
`automatic-batch-2026-08-15T13:11:42.623Z` for `scenario-48291`, with three
temperature readings and two occupancy readings. This validates ingestion only;
it does not include an IoT rule, SQS queue delivery, route workers, storage,
autoscaling, or the official twentieth-request SLA.

### 31.1 Phase 3.6 verification

- [x] The active certificate matches the certificate attached to the AWS IoT Thing.
- [x] The certificate is active and has the intended IoT policy attached.
- [x] The least-privilege policy uses the real account-specific client and topic
      ARNs.
- [x] TLS server verification succeeds with the certificate files outside the
      repository.
- [x] Node-RED reports the AWS MQTT output as connected.
- [x] Only accepted, complete batches are wired to the AWS output.
- [x] Consecutive five-reading batches were observed in the AWS IoT MQTT test
      client on the exact approved topic.
- [x] A focused flow test checks the TLS, broker, client, QoS, and output wiring.
- [x] No cloud worker, database, container, CI/CD file, deployment YAML, or duplicate
      validation implementation was introduced.
- [x] The implementation and documentation were reviewed against `Rules.md`.

## 32. AWS IoT to SQS queue boundary

**Milestone:** Phase 4.1 - durable cloud work intake  
**Status:** Completed on 16 August 2026

The IoT rule `evacuva_sensor_batches_to_sqs` listens only to:

```text
evacuva/scenarios/scenario-48291/sensor-reading-batches
```

Its SQL statement selects the complete accepted JSON object and sends it to the
existing standard queue `evacuva-route-requests`. The action keeps Base64 encoding
disabled so the SQS body remains the same readable `sensor-reading-batch` envelope
defined by the shared contracts. The rule is enabled and uses AWS IoT SQL version
`2016-03-23`.

The SQS action uses the AWS Academy-managed `LabRole`. Its trust policy was checked
and explicitly includes `iot.amazonaws.com`; no role, trust relationship, inline
policy, or managed-policy attachment was changed. `LabRole` is broader than the
dedicated least-privilege service role that would be preferred outside the
restricted teaching account. This is an Academy constraint and must be reported as
a security limitation rather than described as production least privilege.

A live test started only the local MQTT broker, Node-RED, and simulator. Node-RED
connected to AWS IoT over TLS and published several accepted batches. SQS reported
five visible messages. A receive operation returned message
`55b9b27f-966e-4756-9c1b-d7afb50fa4f1`, whose body was batch
`automatic-batch-2026-08-16T04:18:35.689Z` with five validated readings. The receive
used a five-second visibility timeout and did not delete the message, so the five
messages remain usable for the next worker milestone.

This milestone proves durable queue intake only. It does not claim worker
processing, idempotency, retries, dead-letter handling, persistence, ECS,
autoscaling, or compliance with the twentieth-request SLA.

### 32.1 Phase 4.1 verification

- [x] The existing queue is a standard SQS queue in `us-east-1`.
- [x] The enabled IoT rule selects only the accepted scenario batch topic.
- [x] The action writes readable JSON without Base64 encoding.
- [x] AWS IoT can assume the existing Academy `LabRole`.
- [x] Five live accepted batches appeared in SQS.
- [x] One received body contains the expected batch ID, scenario ID, source,
      timestamp, and exactly five readings.
- [x] The evidence receive did not delete or process the queued message.
- [x] No source file, dependency, worker, database, container, or deployment file
      was added prematurely.
- [x] The implementation and documentation were reviewed against `Rules.md`.

## 33. First SQS route worker

**Milestone:** Phase 4.2 - sequential worker baseline  
**Status:** Completed on 16 August 2026

The first worker is a plain Node.js application that uses the AWS SDK for
JavaScript. Each receive requests at most one message from
`evacuva-route-requests`. The worker parses the readable SQS body and passes it to
the same shared batch operation used by the local MQTT state engine. This prevents
a second implementation of state validation, safety weighting, route calculation,
or route validation.

The normal command continues polling sequentially. A separate `--once` command
uses the same runner and performs one receive attempt for controlled demonstration
evidence without creating a duplicate entry point.

After processing succeeds, the worker sends `DeleteMessage` using that delivery's
receipt handle. The updated in-memory state is committed only after deletion
succeeds. A malformed body, contract error, stale reading, or failed deletion
returns a clear rejection and leaves both the SQS message and prior state intact.

This is intentionally a single-process baseline. It does not yet provide durable
state, stored results, idempotency, retry limits, a dead-letter queue, ECS,
autoscaling, or end-to-end SLA timing. Standard SQS delivery can be duplicated or
out of order, so safe concurrency depends on the later persistence and reliability
milestone.

A live AWS Academy run received message
`55b9b27f-966e-4756-9c1b-d7afb50fa4f1`, advanced the in-memory building state to
version 2, and returned a successful independently validated route with 37.39 ms
of route computation. The success line was emitted only after `DeleteMessage`
completed. This is worker-boundary evidence, not an end-to-end latency result,
because queue waiting and return-path time were not measured.

### 33.1 Phase 4.2 verification

- [x] The worker receives at most one message per request.
- [x] The SQS body uses the existing validated sensor-batch contract.
- [x] Local and SQS processing share one batch-to-route implementation.
- [x] A successful validated route triggers deletion with the receipt handle.
- [x] Invalid input and deletion failure do not commit state or delete the message.
- [x] Four focused worker tests and all 62 project tests pass.
- [x] ESLint, Prettier, package resolution, and the `Rules.md` review pass.
- [x] A real AWS Academy queue message has been processed and deleted by this
      worker.

## 34. DynamoDB state foundation

**Milestone:** Phase 4.3.1 - compact durable scenario state  
**Status:** Completed on 16 August 2026

The complete default building state serialises to 496,137 bytes because its
floorplan contains 10,000 cells. This exceeds DynamoDB's 400 KB item limit. The
floorplan is deterministic, so the state record stores its generation
configuration instead of the generated cells. It also stores the occupant start,
42 sensor definitions, 42 latest readings, state version, and update time. The
default compact record serialises to approximately 14 KB.

One on-demand table named `evacuva-routing-data` uses `scenarioId` as its partition
key and `recordKey` as its sort key. The first item uses `recordKey` value `STATE`.
Later result items may share the scenario partition, but they are not implemented
in this sub-phase.

The setup command creates the table if it is missing, waits until it is active, and
conditionally stores the initial `scenario-48291` state. Repeating the command does
not overwrite an existing state record. No route-worker read or write integration,
result record, concurrency handling, retry policy, or dead-letter queue is included
yet.

The live AWS Academy run created the table, stored its initial state, and read the
item back consistently. Reconstruction verified state version 1 and all 42 sensors.
The stored JSON serialised to 14,099 bytes, remaining well below the 400 KB item
limit.

### 34.1 Phase 4.3.1 verification

- [x] The complete and compact state sizes were measured rather than estimated.
- [x] The compact state omits only the reproducible floorplan cells.
- [x] A compact record reconstructs the exact validated complete state.
- [x] Invalid persisted sensor data is rejected during reconstruction.
- [x] The on-demand table uses the approved partition and sort keys.
- [x] Repeated setup cannot overwrite an existing scenario state.
- [x] A live consistent read verified version 1, 42 sensors, and a 14,099-byte
      serialised record.
- [x] All 65 tests, ESLint, Prettier, dependency checks, and `Rules.md` review pass.

## 35. Durable worker persistence

**Milestone:** Phase 4.3.2 - atomic state and route-result storage  
**Status:** Completed on 16 August 2026

For each valid SQS batch, the worker consistently reads the scenario's `STATE`
item and reconstructs the complete floorplan. It applies the existing shared batch
operation and prepares two records: the next compact `STATE` and one
`RESULT#<batchId>` item containing the source batch and validated route result.

Both records are written in one DynamoDB transaction. The state write requires the
previous state version, and the result key must not already exist. SQS deletion is
attempted only after the transaction succeeds. Conflict recovery and recognising a
previously committed result after an SQS deletion failure remain Phase 4.3.3.

Local tests cover consistent reconstruction, the two-record transaction, missing
state, invalid queue data, storage failure, and deletion failure after a durable
write. The full project has 69 passing tests.

A live worker run received SQS message
`eb1befc6-e4a0-46c0-af6a-c19df4c02714`. The DynamoDB transaction advanced the
scenario state from version 1 to version 2 and created
`RESULT#automatic-batch-2026-08-16T04:18:20.654Z`. The route passed independent
validation with 42.18 ms of computation, and SQS deletion completed before the
worker reported success. This computation measurement excludes queue waiting,
storage, deletion, and return-path time and is not an SLA result.

### 35.1 Phase 4.3.2 verification

- [x] The worker consistently reads and reconstructs stored scenario state.
- [x] One transaction writes the next state and correlated result.
- [x] The state write checks the previously loaded version.
- [x] A result key cannot be overwritten by the transaction.
- [x] SQS deletion occurs only after durable storage succeeds.
- [x] Missing state, malformed input, storage failure, and deletion failure have
      focused tests.
- [x] A real message advanced DynamoDB, stored a successful validated result, and
      was deleted from SQS.
- [x] All 69 tests, ESLint, Prettier, dependency checks, and `Rules.md` review pass.

## 36. Duplicate and state-conflict handling

**Milestone:** Phase 4.3.3 - idempotent standard-queue processing  
**Status:** Completed on 16 August 2026

Before calculating, the worker consistently checks for
`RESULT#<batchId>`. If it already exists and passes the stored-result contract, the
batch was previously committed and the worker deletes the repeated SQS delivery
without changing state or calculating again.

A canceled DynamoDB transaction is treated as a state conflict only when its
cancellation reasons contain `ConditionalCheckFailed` or `TransactionConflict`.
The worker checks again for a committed result, otherwise reloads current state and
retries. At most three state-write attempts occur during one SQS delivery. Other
storage failures are not disguised as conflicts and remain undeleted for the later
SQS retry policy.

A small integration command reads the source batch from a validated stored result
and sends that exact batch to the standard queue again. This creates a controlled,
reproducible duplicate without modifying state, result records, or worker timing.
The worker output must identify and delete it while reporting the original state
version and result key.

The live test republished batch
`automatic-batch-2026-08-16T04:18:20.654Z` as SQS message
`25cea65b-10ed-480b-9791-01ec162c4523`. Two legitimate queued batches were
delivered first and advanced the current state to version 5. When the repeated
message arrived, the worker found its existing version-2 result and printed
`Deleted duplicate` before removing the SQS message. It did not load and advance
the current state, calculate another route, or create a second result.

### 36.1 Phase 4.3.3 verification

- [x] Existing results are checked consistently before state is loaded.
- [x] A repeated batch is deleted without state mutation or route calculation.
- [x] Only conditional and transaction cancellation reasons are treated as
      conflicts.
- [x] A genuine state conflict reloads current state and retries at most three
      times.
- [x] A same-batch conflict is recognised as a committed duplicate.
- [x] Unresolved conflicts and unrelated storage errors remain undeleted.
- [x] A live repeated message was recognised using its original result while the
      current scenario state remained at version 5.
- [x] All 76 tests, ESLint, Prettier, dependency checks, and `Rules.md` review
      pass.

## 37. Bounded queue retries and failure isolation

**Milestone:** Phase 4.3.4 - SQS dead-letter queue and retry limit  
**Status:** Completed on 16 August 2026

The route-request standard queue will use one dedicated standard dead-letter queue
named `evacuva-route-request-failures`. A source message that cannot be processed
is deliberately left undeleted. SQS may deliver it up to three times before its
redrive policy isolates it in the failure queue. Three receives provide a small
retry opportunity while keeping the university demonstration practical; this
value must be evaluated under load before it is treated as an operational choice.

The failure queue retains messages for 14 days, longer than the source queue's
current default retention period, so failed evidence is not lost earlier than the
original request. Its redrive allow policy names only the Evacuva source queue.
The setup command creates or reuses the failure queue, applies both policies, and
reads the attributes back before reporting success. Because AWS queue-attribute
updates can take up to 60 seconds to propagate, verification polls at ten-second
intervals for no more than 60 seconds instead of treating the first stale read as
a setup failure. The read-back comparison also accepts AWS's numeric
normalisation of `maxReceiveCount`.

The worker requests `ApproximateReceiveCount` with each SQS message and includes it
when reporting a rejection. Retry counting and movement remain SQS
responsibilities; the worker does not implement a second local retry queue or
delete a rejected request. No automatic redrive from the failure queue is included
because a malformed request should be inspected before it is sent back.

The live test sent malformed message
`0e8e5e79-39b4-40b4-8904-5f6b08bd0e99` to the otherwise empty source queue. The
worker rejected the same message at receive counts 1, 2, and 3 without deleting
it. After the final visibility timeout, another source receive returned no
message. A direct failure-queue read returned the same message ID and unchanged
test body, proving that SQS isolated it rather than the worker discarding it.

### 37.1 Phase 4.3.4 completion checks

- [x] The setup logic creates one standard failure queue with 14-day retention.
- [x] Only the route-request queue is permitted to use it as a dead-letter queue.
- [x] The source queue policy contains a three-receive threshold.
- [x] Applied policies are read back and validated.
- [x] Worker rejection output includes the SQS receive count.
- [x] Invalid setup input and the normal policy setup have focused tests.
- [x] All 79 tests, ESLint, Prettier, dependency checks, and local `Rules.md` review
      pass.
- [x] Live AWS setup verifies both queue policies for
      `evacuva-route-requests` and `evacuva-route-request-failures`.
- [x] A controlled invalid message moves to the failure queue without being
      deleted by the worker.

## 38. First Fargate worker deployment

**Milestone:** Phase 4.4 - run the existing worker on ECS Fargate  
**Status:** Phase 4.4.2 completed; original Phase 4.4.3 deployment superseded by the
multi-occupant redesign

Phase 4.4 is divided into three small checks. Phase 4.4.1 packages and verifies the
existing worker locally. Phase 4.4.2 creates one private ECR repository and pushes
that image. The original Phase 4.4.3 would have deployed the single-route worker,
but the 20 August tutor update changed the required unit of work before deployment.
Deploying the old combined state-and-route worker now would create cloud evidence
for an architecture that cannot process ten occupants in parallel, so that step is
not being performed.

The route-worker image uses the Node.js 24 Debian slim runtime required by the
project. Its build context contains only the root dependency manifests and the
route-worker, contracts, and core packages. Test files, local dependencies,
certificates, Node-RED data, documentation, and unrelated applications are not
sent into the image. Production dependencies are installed from the lock file,
and the process runs as the image's non-root `node` user.

No health endpoint is added because this worker is not an HTTP service. Its
running Node.js process is the task health signal, while the existing SIGTERM
handler allows an ECS stop request to finish the current long poll before exiting.

### 38.1 Phase 4.4.1 completion checks

- [x] One route-worker Dockerfile has a clear deployment responsibility.
- [x] The Docker context excludes credentials and unrelated project files.
- [x] Only production workspace dependencies are installed.
- [x] The container runs as a non-root user.
- [x] The image builds successfully from the repository root.
- [x] The built image contains the required runtime modules and no test files.
- [x] The container starts the existing worker and validates its required queue
      configuration.

The verified local image is `evacuva-route-worker:local`. Its build context was
342.63 KB, its image size was 85,423,868 bytes, and npm installed 37 production
packages. The build-time dependency output did not inspect operating-system
packages in the base image. Inspection confirmed
Node.js 24.19.0, `NODE_ENV=production`, Linux `amd64`, working directory `/app`,
and non-root UID 1000. The AWS SQS and DynamoDB clients and both Evacuva workspace
packages loaded successfully. No `*.test.js` file was present. Starting the normal
command without `EVACUVA_SQS_QUEUE_URL` exited with the intended clear boundary
error, proving the existing worker entry point owns container execution.

### 38.2 Phase 4.4.2 completion checks

- [x] One private repository named `evacuva-route-worker` exists in `us-east-1`.
- [x] Image tags are immutable and repository encryption is AES-256.
- [x] Scan-on-push is enabled.
- [x] The verified image is pushed with tag `phase-4-4-1`.
- [x] The ECR index digest exactly matches the local Docker image digest.
- [x] The Linux `amd64` runnable image is active and its scan completed.
- [x] Registry scan findings and their deployment limitation are documented.

The pushed URI is
`620491751244.dkr.ecr.us-east-1.amazonaws.com/evacuva-route-worker:phase-4-4-1`.
The local and registry index digest is
`sha256:585a198b601a47138514059e488632c9e243087a4dfdf7f85e9aebb848ec8d83`.
ECR reports an 85.42 MB active image index with a Linux `amd64` runnable manifest.

The runnable-image scan completed on 20 August 2026 and reported 3 critical,
5 high, 11 medium, and 1 low package findings. Phase 4.4.2 therefore proves
artifact identity and registry availability, not security readiness. Before the
first Fargate task, the base image must be refreshed and the scan repeated; any
remaining accepted limitation must be explained as part of the university
prototype rather than described as production-safe.

The pushed image remains valid baseline evidence and is not deleted. The worker
image will be rebuilt and given a new immutable tag after the multi-occupant
request boundary is implemented and tested.

## 39. Multi-occupant worker-pool redesign

**Milestone:** Phase 4.5 - separate state updates from parallel route calculation  
**Status:** Phases 4.5.1 to 4.6 completed

The redesign is split into focused sub-phases:

### 39.1 Phase 4.5.1 - occupants, contracts, and versioned state

- [x] Generate ten distinct occupants on valid walkable coordinates.
- [x] Add occupant ID, start coordinate, state version, and submission time to the
      route-request contract.
- [x] Define and reconstruct compact `STATE#<version>` records.
- [x] Keep the existing one-occupant route API usable for focused algorithm tests.

### 39.2 Phase 4.5.2 - state coordinator and versioned update

- [x] Add a repeatable setup command for the dedicated state-update queue.
- [x] Create `evacuva-state-updates` in AWS with the verified queue settings.
- [x] Redirect the IoT rule to the state-update queue.
- [x] Apply each accepted batch through a state-only coordinator operation.
- [x] Atomically store the new current state, immutable state version, and applied
      batch marker.
- [x] Prove that duplicate delivery and coordinator retry cannot create a second
      state update.
- [x] Add a repeatable live-test command that uses current stored sensor sequences.
- [x] Run the coordinator against AWS and verify all three DynamoDB records.

### 39.3 Phase 4.5.3 - request service and load balancer

- [x] Implement a focused Node.js request service with `POST /route-requests`,
      `GET /route-results/{requestId}`, and `GET /health`.
- [x] Validate each submission, send one SQS route job, and return HTTP `202` with
      its request ID without calculating the route.
- [x] Build and smoke-test a minimal non-root local request-service image.
- [x] Create the private `evacuva-request-service` ECR repository.
- [x] Push the verified local image to that repository.
- [x] Put two healthy request-service tasks behind an Application Load
      Balancer target group.
- [x] Verify HTTP health and read-only result lookup through the live load
      balancer.

### 39.4 Phase 4.5.4 - read-only route worker

- [x] Load the immutable state version named by the route request.
- [x] Calculate and independently validate one occupant route without modifying
      building state.
- [x] Store one idempotent `RESULT#<requestId>` record.
- [x] Preserve SQS retry and failure-queue behaviour.
- [x] Rebuild, locally verify, and push the revised worker image; record AWS basic
      scanning's OCI image-index limitation.
- [x] Run two workers as competing SQS consumers and verify one end-to-end request.

### 39.5 Phase 4.6 - ECS services, load generation, and autoscaling

- [x] Run two request-service tasks behind the load balancer.
- [x] Create the route-worker ECS service with two fixed competing consumers.
- [x] Make the load generator send ten independent HTTP requests every five
      seconds after the state version is available.
- [x] Run one Fargate worker task as the fixed baseline.
- [x] Run multiple worker tasks as competing SQS consumers.
- [x] Scale the worker service from queue backlog per active task.
- [x] Evaluate request-service scaling from ALB or CPU evidence. Two tasks were
      retained because the final window had zero target 5xx and connection errors;
      the remaining ALB-generated 5xx is recorded as a limitation.
- [x] Record ALB traffic and health, request-service task count, worker task ID,
      queue depth, queue wait, compute time, total time, retries, errors, and
      validated outcome.
- [x] Compare fixed and automatically scaled workers using identical 10-periodic,
      20-, 50-, and 100-request workloads.
- [x] Evaluate the twentieth-request five-second SLA without artificial delays.

Five one-worker 20-request trials returned 100 valid routes but zero SLA passes.
Five six-worker trials returned 97 valid client results and four SLA passes. The
twentieth-request median improved from 11,431 ms to 4,050 ms, but an 80 percent
trial pass rate is not a guaranteed SLA.

The 50-request comparison reduced median latency from 18,911 ms to 11,020 ms and
p95 from 34,953 ms to 12,690 ms. The 100-request comparison reduced median latency
from 37,112 ms to 12,024 ms and p95 from 68,106 ms to 19,537 ms. Valid client
results improved from 97 to 99 at 100 requests. These larger bursts were run once
per capacity because of the AWS Academy budget; they are supporting scale evidence,
not a repeated SLA claim.

The periodic experiment independently proved automatic scale-out from two to six
workers. For the controlled burst comparison, scale-in was paused so one and six
warm workers remained stable, and it was restored afterwards. The live route queue
was empty at the end, the service returned to two tasks, and both policies remained
active on the normal two-to-ten target.

The deployed experiment image stored misleading internal queue and total timing:
queue time ended after computation and compute time was added again. Client-observed
end-to-end results remain valid. The source now records queue time at processing
start and total time directly from submission to completion; a future worker image
deployment is required before AWS result records use that correction.

The ALB is limited to the HTTP request service and is not placed between SQS and
route workers. Deployment YAML, CI/CD pipelines, and additional databases remain
outside the approved university scope.
