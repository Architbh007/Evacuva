# Evacuva

Evacuva is a university prototype that calculates a lower-risk evacuation route
through a simulated building. It combines a generated 100 by 100 floorplan with
smoke, temperature, occupancy, and exit-door readings. This is not a certified
emergency system and must not be used for real evacuation decisions.

**Current status:** The Phase 5 visual application now runs independently in
Next.js and React on port 3001. It presents the live 100 by 100 floorplan, all ten
occupants, 42 sensor readings, the current route, directional guidance, manual
sensor controls, and the recorded scalability evidence. Node-RED remains focused
on sensor validation, batching, its operational tables, and AWS forwarding. The
twentieth-request SLA passed four of five six-worker trials and zero of five
one-worker trials, so the prototype shows a clear scaling benefit without claiming
a guaranteed SLA.

## Current implemented flow

```text
42 simulated sensors
        |
        v
Local MQTT broker
        |
        v
Node-RED validation and batching
        |
        v
AWS IoT Core -> State-update queue -> State coordinator
                                             |
                                             v
                              DynamoDB current and versioned state

Local MQTT -> State engine -> retained layout, state, route and guidance
       |                                            |
       |                                            v
       +-> Next.js MQTT store -> React application and manual controls

HTTP client -> Application Load Balancer -> Two request-service tasks
                                                    |
                                  +-----------------+-----------------+
                                  v                                   v
                         SQS route queue                  DynamoDB result lookup
                                  |
                                  v
                 2-10 autoscaled ECS route workers
                                  |
                                  v
                        DynamoDB route results
```

## Approved next architecture

```text
One sensor batch -> State coordinator -> One immutable state version
                                                   |
                                                   v
Load generator -> ALB -> Node.js request-service tasks
                              |
                              v
                       SQS route queue
                    /         |         \
               Worker 1   Worker 2   Worker N
                    \         |         /
                       Route results
                              |
                   Lookup through the ALB
```

The ALB distributes HTTP submissions and result lookups among request-service
tasks. SQS separately distributes accepted calculation jobs among route workers.
The API does not calculate routes, and route workers are not ALB targets.

## Completed work

### Building and route model

- [x] Generate reproducible random 100 by 100 floorplans.
- [x] Create connected rooms, corridors, boundary exits, and one valid occupant
      start for the current baseline.
- [x] Place 42 smoke, temperature, occupancy, and exit-door sensors.
- [x] Convert sensor readings into route risk and hard-blocked cells.
- [x] Calculate the safest available route using Dijkstra's algorithm.
- [x] Independently validate successful routes and defined failure results.

### Sensor simulation and local messaging

- [x] Change five different sensor readings every five seconds.
- [x] Cover all 42 sensors during the 60-second automatic cycle.
- [x] Support immediate manual overrides and resuming automatic readings.
- [x] Publish validated readings through the local MQTT broker.
- [x] Display published sensor values in the simulator terminal.

### Node-RED and AWS ingestion

- [x] Validate readings and reject malformed, mismatched, or stale messages.
- [x] Combine five automatic readings into one route-request batch.
- [x] Send manual readings as immediate one-reading batches.
- [x] Display sensor, building-state, and route tables in Node-RED.
- [x] Publish accepted batches securely to AWS IoT Core.
- [x] Forward AWS IoT batches into `evacuva-route-requests` using an IoT rule.

### Reliable state and route processing

- [x] Receive and validate one SQS request at a time.
- [x] Store compact current and immutable building state in DynamoDB.
- [x] Store each independent route result without mutating building state.
- [x] Delete an SQS request only after durable processing succeeds.
- [x] Detect duplicate deliveries without recalculating or rewriting the result.
- [x] Retry genuine state-coordinator conflicts with a limit of three attempts.
- [x] Move messages to `evacuva-route-request-failures` after three failed receives.

### Container and registry

- [x] Package the existing route worker in a minimal Node.js 24 Docker image.
- [x] Run the container as a non-root user without test files or credentials.
- [x] Create the private `evacuva-route-worker` ECR repository.
- [x] Enable immutable tags, AES-256 encryption, and scan-on-push.
- [x] Push the verified image using tag `phase-4-4-1`.
- [x] Confirm that the local and ECR image digests match.
- [x] Rebuild and push the read-only worker as immutable tag `phase-4-5-4`.

### Multi-occupant request foundation

- [x] Generate ten distinctly identified occupants on unique walkable cells.
- [x] Preserve the original seeded occupant as the focused routing baseline.
- [x] Accept either one explicit baseline start or ten explicit starts.
- [x] Require occupant ID, start, scenario, state version, and submission time in
      each independent route request.
- [x] Create and reconstruct compact `STATE#<version>` records without storing the
      generated 100 by 100 floorplan.

### State coordinator implementation

- [x] Separate state advancement from route calculation without duplicating logic.
- [x] Consume and validate one sensor-batch SQS message at a time.
- [x] Atomically write `STATE`, `STATE#<version>`, and `BATCH#<batchId>`.
- [x] Delete the message only after the DynamoDB transaction succeeds.
- [x] Recognise duplicate batches and retry genuine state conflicts safely.
- [x] Add a repeatable setup command for `evacuva-state-updates`.
- [x] Add a live-test command that queues two identical valid batches from current
      DynamoDB sensor sequences.

### HTTP request service

- [x] Accept and validate one occupant request with `POST /route-requests`.
- [x] Verify the exact immutable state version and occupant start before queuing.
- [x] Return queued, pending, and completed request status as JSON.
- [x] Expose `GET /health` for the future Application Load Balancer.
- [x] Keep route calculation out of the HTTP process.
- [x] Package the service as a non-root Node.js 24 image without test files.

### AWS request ingress

- [x] Push the verified request-service image to private ECR.
- [x] Register the exact image digest in a Fargate task definition.
- [x] Run two request-service tasks in separate availability zones.
- [x] Restrict task port 3000 to traffic from the ALB security group.
- [x] Route public HTTP port 80 to both healthy task targets.
- [x] Verify live health and pending-result responses through the ALB.

### Read-only route-worker pool

- [x] Consume independent `route-calculation-requested` events from SQS.
- [x] Consistently load the exact immutable `STATE#<version>` record.
- [x] Calculate and validate one occupant route without changing `STATE`.
- [x] Conditionally store one idempotent `RESULT#<requestId>` record.
- [x] Keep failed messages available for the existing SQS retry and failure queue.
- [x] Run two Fargate workers as competing consumers with zero inbound rules.
- [x] Verify a complete route and duplicate delivery through the live ALB.

### Phase 5 visual application

- [x] Render the complete 100 by 100 floorplan on a browser canvas.
- [x] Show all ten occupants and highlight the selected occupant without implying
      that a new route has been calculated.
- [x] Use black occupant markers and distinct red, blue, orange, and green sensor
      markers with a visible legend.
- [x] Show the current validated route, its status, cost, and first safe direction.
- [x] Show all 42 sensor readings with type, condition, value, and coordinates.
- [x] Run the Next.js and React application independently from Node-RED.
- [x] Expose the latest validated MQTT data through one Next.js snapshot API.
- [x] Publish validated manual override and resume commands from the application.
- [x] Allow map hover inspection and map selection of occupants and sensors.
- [x] Present the measured SLA, sustained-load, and worker comparison evidence.
- [x] State the prototype, scalability, and sustainability limitations visibly.

## Verification completed

The current project quality check reports:

```text
ESLint: passed
Prettier: passed
Tests: 125 passed, 0 failed
```

The earlier route-worker image scan reported 3 critical, 5 high, 11 medium, and
1 low package findings. The current request-service and `phase-4-5-4` worker tags
use OCI image indexes generated by Docker Buildx, which AWS basic scanning reports
as unsupported image types. These limitations are recorded rather than presented
as clean scans.

## Remaining work

### Phase 4.5.1 completed

- [x] Generate ten distinct occupants on valid walkable coordinates.
- [x] Give each occupant a descriptive ID and start coordinate.
- [x] Define independent route requests containing occupant ID, start, request ID,
      state version, and submission time.
- [x] Define compact immutable building-state version records for queued requests.

### Phase 4.5.2 completed in AWS

- [x] Create the dedicated `evacuva-state-updates` queue in AWS.
- [x] Redirect the AWS IoT rule from the route queue to the state-update queue.
- [x] Run the coordinator against the real queue and DynamoDB table.
- [x] Verify one `STATE`, one `STATE#6`, and one `BATCH#<batchId>` record.
- [x] Replay the same batch and prove that the state remained at version 6.

### Phase 4.5.3 completed in AWS

- [x] Add `POST /route-requests`, `GET /route-results/{requestId}`, and
      `GET /health` to a focused Node.js request service.
- [x] Build and smoke-test its minimal non-root local container image.
- [x] Create the private `evacuva-request-service` ECR repository.
- [x] Push the verified local image to that repository.
- [x] Run two healthy request-service tasks in the ALB target group.
- [x] Verify health and read-only result lookup through the live ALB.

### Phase 4.5.4 completed in AWS

- [x] Change route workers to read the requested state version without modifying
      shared state.
- [x] Store one idempotent result per route request.
- [x] Preserve retry, duplicate, and failure-queue behaviour.
- [x] Review the ECR scan limitation, rebuild the revised worker, and push a new immutable
      image tag.
- [x] Run two read-only workers and verify a live validated route through the ALB.

### Phase 4.6 scaling work

- [x] Create the route-worker ECS service.
- [x] Run one Fargate task as the fixed-worker baseline.
- [x] Run multiple worker tasks as competing SQS consumers.
- [x] Configure ECS autoscaling using queue backlog per active task.
- [x] Evaluate request-service scaling. It was not added because two healthy
      targets produced no target 5xx or connection errors during the final burst;
      the remaining ALB-generated 5xx is recorded as a limitation.
- [x] Record ALB traffic, task counts and identities, queue depth, stored route
      timings, client-observed latency, retries, errors, and validated outcomes.
- [x] Send and retrieve a verified request through the ALB and worker pool.
- [x] Test ten route requests every five seconds for 48 intervals with no failed
      or invalid routes.
- [x] Run five autoscaled 20-request bursts.
- [x] Run three supplementary six-worker SLA trials; all 60 routes were valid and
      each twentieth request completed within five seconds.
- [x] Run four more one-worker 20-request bursts for an equal five-trial baseline.
- [x] Run matching 50- and 100-request comparison bursts.
- [x] Measure the twentieth request in the one-worker baseline; it returned a valid
      route in 13.843 seconds and therefore failed the five-second SLA.
- [x] Measure the twentieth request with six warm autoscaled workers; it returned a
      valid route in 4.207 seconds and passed the five-second SLA.
- [x] Compare fixed-worker and six-worker results without artificial delays.

| Burst | Workers | Valid  | Median   | p95      | Maximum  |
| ----- | ------- | ------ | -------- | -------- | -------- |
| 50    | 1       | 50/50  | 18.911 s | 34.953 s | 36.509 s |
| 50    | 6       | 50/50  | 11.020 s | 12.690 s | 13.554 s |
| 100   | 1       | 97/100 | 37.112 s | 68.106 s | 70.924 s |
| 100   | 6       | 99/100 | 12.024 s | 19.537 s | 20.481 s |

The 50-request six-worker run reduced median latency by 41.7 percent and p95 by
63.7 percent. At 100 requests, it reduced median latency by 67.6 percent and p95
by 71.3 percent. These larger diagnostic bursts still exceeded five seconds and
one 100-request call received an ALB-generated HTTP 502 response.

### Phase 5 application and evaluation

- [x] Build the visual 100 by 100 floorplan and route map.
- [x] Add the experiment dashboard and measured evidence.
- [x] Evaluate scalability and sustainability trade-offs in the application.
- [x] Document the application and experiment limitations.
- [ ] Prepare the final written submission and rehearse the demonstration.
- [ ] Add Timestream or S3 history only if the final assessment evidence requires
      persistent historical storage.

## Verified local commands

Install dependencies and run the complete quality check:

```text
npm.cmd install
npm.cmd run check
```

Run the local workflow in five terminals:

```text
npm.cmd run mqtt:broker
npm.cmd run state-engine
npm.cmd run node-red
npm.cmd run simulate:sensors
npm.cmd run dashboard
```

Open the visual application at `http://127.0.0.1:3001`. Node-RED remains available
separately at `http://127.0.0.1:1880` for flow editing, debug output, and its
existing operational tables.

Run the request service against AWS from Git Bash after loading valid Academy
credentials:

```text
export EVACUVA_ROUTE_REQUEST_QUEUE_URL='https://sqs.us-east-1.amazonaws.com/620491751244/evacuva-route-requests'
npm.cmd run request-service
```

Its health boundary is then available at `http://127.0.0.1:3000/health`. The live
AWS route queue now uses the independent per-occupant message contract.

## Project documentation

- `Rules.md` defines the required coding and testing standards.
- `Design.md` records the architecture and milestone decisions.
- `Progress.md` contains detailed implementation and verification evidence.

Node-RED flow files are intentionally ignored by Git and must be demonstrated from
this computer or exported separately for assessment. AWS credentials, certificates,
and private keys must never be committed.
