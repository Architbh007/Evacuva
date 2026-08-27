# Evacuva Project Progress

**Last updated:** 27 August 2026  
**Current status:** Phase 5 visual application implemented and verified locally  
**Runtime:** Node.js 24 with plain JavaScript ES modules  
**Project rules:** All work is governed by `Rules.md`

## 1. Project purpose

Evacuva is a university prototype that finds a lower-risk evacuation route through
a simulated building. It combines a generated floorplan with smoke, temperature,
occupancy, and door readings. Dangerous cells can become expensive or completely
blocked, so the selected path may be longer than the geometrically shortest path.

This is a simulated research project. It is not a certified emergency system and
must not be used for real evacuation decisions.

## 2. Overall phase progress

| Phase | Purpose                                       | Status      |
| ----- | --------------------------------------------- | ----------- |
| 1     | Requirements, architecture, and design        | Completed   |
| 2     | Local floorplan, sensors, safety, and routing | Completed   |
| 3     | MQTT, Node-RED, and AWS IoT Core              | Completed   |
| 4     | SQS, ECS workers, storage, and autoscaling    | Completed   |
| 5     | Evaluation, dashboard, report, and demo       | In progress |

The project currently has a working local decision engine, validated Phase 3
message contracts, a runnable automatic sensor-event simulator, and user-facing
manual override and resume controls. The local MQTT and Node-RED workflow validates
and batches readings before forwarding accepted batches to AWS IoT Core over TLS.
AWS IoT Core forwards accepted batches to the dedicated state-update queue. The
state coordinator advances DynamoDB state once, while the public ALB sends
independent occupant requests through two request-service tasks to the route queue.
Read-only ECS route workers now consume that queue, load immutable state, and store
idempotent route results without changing current state. Their service scales from
two to ten tasks using queue backlog per active worker. The controlled one-worker
and six-worker experiments, including repeated 20-request SLA trials and 50- and
100-request bursts, are complete. The browser application now presents the live
floorplan, occupants, readings, route, directional guidance, and experiment
evidence. Final submission writing, demonstration rehearsal, and any specifically
required historical evidence storage remain.

### 2.1 Phase 3.1 message progress

The first Phase 3 sub-phase is complete. It added no messaging runtime; it defined
and tested the boundaries that later components will use.

Implemented decisions:

- automatic sensor interval: 5 seconds
- descriptive IDs such as `smoke-sensor-01` and `exit-door-sensor-01`
- automatic and manual sensor-reading envelopes
- persistent manual-override and resume-automatic command envelopes
- building-state update envelopes with consecutive version checks
- route calculation request and result envelopes
- shared descriptive MQTT topic patterns

Ambiguous IDs and inconsistent messages are rejected before they can enter the
future event workflow.

### 2.2 Phase 3.2 simulator progress

One Node.js process now contains 42 independent logical sensor nodes. Each node owns
its ID, sensor type, coordinate, current reading, and sequence number. This provides
individual simulated-device behaviour without running 42 separate operating-system
processes. The shared scheduler processes five different sensor changes every five
seconds instead of publishing all 42 readings at once.

The 12-batch, 60-second cycle emits 60 readings and reaches every one of the 42
sensors at least once. It progressively introduces smoke, heat, congestion,
blocked exits, and then recovery. Events contain valid IDs, coordinates,
timestamps, sources, and increasing per-sensor sequence numbers. The scheduler
waits for all five callbacks to finish before scheduling the next interval,
preventing overlapping work.

The single runnable simulator publishes the validated events through MQTT and
prints each sensor ID, value, sequence, and topic in the terminal. Direct tests
still exercise the underlying callback boundary without a broker or real
five-second waits. Phase 3.5 consumes the MQTT events for building-state and route
updates.

### 2.3 Phase 3.3 manual-control progress

Each logical sensor node can now switch independently between automatic and manual
mode. A valid manual command emits its reading immediately and keeps that sensor in
manual mode. Automatic script values for it are remembered but not emitted, while
the other selected sensor nodes in the batch continue normally.

A separate resume command returns the selected node to automatic mode. Its latest
scripted automatic value is emitted on the next five-second cycle. Commands for a
different scenario, an unavailable sensor, an invalid value, or a sensor that is
already automatic are rejected.

This control is available through the simulator's Node.js functions and MQTT
command topics. Phase 3.5 adds the user-facing Node-RED forms that publish those
same validated commands.

### 2.4 Phase 3.4 local MQTT progress

A Node.js Aedes broker now listens on `127.0.0.1:1883` by default. The MQTT.js
simulator client connects to it using a clean MQTT 3.1.1 session. Five automatic
readings are published every five seconds to separate descriptive sensor topics.
Manual readings are published immediately to the same type of topic.

The simulator subscribes to the manual-override and resume-automatic topics.
Payloads are parsed and validated before they can change a sensor. QoS 1 is used
for readings and commands, retained messages are disabled, and a repeated command
ID is ignored during the current process run.

Malformed JSON and invalid messages are reported without preventing later valid
publishing. The local broker deliberately has no authentication, TLS, persistence,
clustering, or production deployment configuration. Node-RED uses this local broker;
the separate AWS connection was added later in Phase 3.6.

### 2.5 Phase 3.5 Node-RED dashboard progress

Node-RED 5.0.4 now subscribes to every sensor-reading topic for scenario `48291`.
It rejects malformed, mismatched, and stale readings, replaces the matching row in
a live sensor table, and groups the five automatic readings from one interval into
one validated `sensor-reading-batch`. A manual reading creates an immediate
one-reading batch instead of waiting for the next interval.

A separate Node.js state engine applies each accepted batch to the versioned
building state and calls the existing tested route engine. This keeps routing out
of Node-RED Function nodes and avoids duplicate domain logic. One automatic batch
therefore creates one newer state version and one correlated route result, rather
than five near-identical calculations.

The dashboard at `http://127.0.0.1:1880/dashboard/overview` contains:

- a searchable live table for up to all 42 sensor readings
- a 20-row building-state update table
- a 20-row safest-route result table
- a manual sensor override form
- a form that resumes automatic updates for a selected sensor
- visible success and rejection notifications
- Node-RED Debug sidebar output for readings, accepted batches, state updates, and
  route results

The dashboard, broker, state engine, and simulator remain local applications. The
same accepted reading batches are also forwarded to AWS IoT Core as described in
Phase 3.6.

The visual flow and its local flow test are intentionally listed in `.gitignore`
at the student's request. They remain in `apps/node-red` on this computer and are
edited through the Node-RED interface, but they will not be included automatically
in a future Git commit. This choice reduces repository reproducibility and must be
supported with demonstration evidence or a separately submitted export if the
assessment requires it.

### 2.6 Phase 3.6 AWS IoT Core progress

Node-RED now forwards only the batches accepted by its existing validation and
aggregation flow. It connects to the account-specific AWS IoT Core data endpoint
in `us-east-1` using MQTT 3.1.1 over verified TLS on port 8883. The connection uses
the descriptive client ID `evacuva-node-red-edge`, QoS 1, and no retained messages.

The device certificate, private key, and Amazon root CA remain outside the project
folder and are referenced as local files by Node-RED. No secret or certificate
content was added to the repository. The active certificate is attached to the
Thing `evacuva-node-red-edge` and the policy
`evacuva-node-red-edge-policy`. That policy permits only this client connection and
publishing to:

```text
evacuva/scenarios/scenario-48291/sensor-reading-batches
```

On 15 August 2026, Node-RED reported a green connected state and the AWS IoT MQTT
test client received consecutive five-reading batches at five-second intervals.
One recorded batch was `automatic-batch-2026-08-15T13:11:42.623Z`, containing five
valid readings for `scenario-48291`. This proves the Phase 3 edge-to-cloud ingestion
path. It does not prove SQS processing or the five-second twentieth-request SLA,
which remain Phase 4 work.

### 2.7 Phase 4.1 SQS queue-boundary progress

The AWS IoT rule `evacuva_sensor_batches_to_sqs` now selects only the accepted
scenario batch topic and forwards its JSON payload into the existing standard SQS
queue `evacuva-route-requests`. Base64 encoding is disabled, so a worker can read
the same human-readable batch JSON that Node-RED published.

AWS Academy's existing `LabRole` is used because its trust policy explicitly
allows `iot.amazonaws.com` and its attached lab policies permit the SQS action. No
IAM role or policy was created or modified. This Academy-managed role is broader
than a dedicated least-privilege role would be, so that limitation must remain
visible in the final security evaluation.

On 16 August 2026, five real Node-RED batches reached the queue. A non-destructive
receive returned message `55b9b27f-966e-4756-9c1b-d7afb50fa4f1` with batch
`automatic-batch-2026-08-16T04:18:35.689Z`, containing five validated readings.
The five-second visibility timeout allowed the message to become visible again;
Phase 4.1 did not delete or process queued work.

### 2.8 Phase 4.2 SQS route-worker progress

The new `route-worker` application uses the AWS SDK for JavaScript to request a
maximum of one SQS message at a time. The message body is parsed and validated by
the same shared `applySensorReadingBatch` operation used by the local state engine.
That operation updates the versioned state, calculates the safest route, and runs
the independent route validator.

The worker sends `DeleteMessage` with the message receipt handle only after the
complete operation succeeds. It commits its in-memory state only after AWS confirms
that deletion. Malformed JSON, invalid batches, stale readings, route failures that
throw, and deletion failures therefore leave the message undeleted and leave the
worker's state unchanged.

The worker is deliberately a single sequential local process for this baseline.
It does not yet persist state or results, retry with a dead-letter queue, detect
duplicate deliveries, run in ECS, autoscale, or measure queue waiting time. A
standard SQS queue can deliver messages more than once or out of order, so those
reliability controls must be added before a multi-worker experiment.

Four focused worker tests prove successful processing and deletion, an empty
receive, invalid JSON rejection without deletion, and state rollback when deletion
fails. The complete project now has 62 passing tests.

On 16 August 2026, the one-message command received real SQS message
`55b9b27f-966e-4756-9c1b-d7afb50fa4f1`. It advanced the building state to version
2, returned a successful independently validated route, recorded 37.39 ms of route
computation, and completed `DeleteMessage` before reporting success. This proves
the worker boundary and success-only deletion. The value is computation time only;
it does not include queue waiting or prove the five-second end-to-end SLA.

### 2.9 Phase 4.3.1 DynamoDB-foundation progress

The complete 100 by 100 state serialises to 496,137 bytes, which is too large for
one DynamoDB item. The approved compact record omits the deterministic 10,000-cell
floorplan and retains its generation configuration, occupant start, sensors,
latest readings, state version, and update time. It serialises to approximately 14
KB and can regenerate and validate the exact complete state.

The setup command created the on-demand `evacuva-routing-data` table with
`scenarioId` and `recordKey` keys. It conditionally seeded the `scenario-48291`
`STATE` record, so repeating setup cannot overwrite an existing state. It then
read the item consistently and reconstructed the full state.

The live AWS Academy output verified state version 1, all 42 sensors, and a 14,099
byte serialised record. At the end of Phase 4.3.1, the route worker did not yet load
or update this record and no result record existed.

### 2.10 Phase 4.3.2 durable-worker progress

The route worker now uses DynamoDB instead of owning an in-memory building state.
For one received SQS batch, it consistently loads the scenario's `STATE` record,
reconstructs and validates the complete 100 by 100 state, applies the shared route
operation, and prepares the next compact state plus a correlated
`RESULT#<batchId>` record.

One DynamoDB transaction writes both records. The state write requires the stored
version to match the version the worker loaded, and the result item must not
already exist. Only a successful transaction allows the worker to send
`DeleteMessage`. A malformed message, missing state, calculation error, or failed
transaction therefore leaves SQS work undeleted.

The implementation has 69 passing tests. On 16 August 2026, the live worker
received SQS message `eb1befc6-e4a0-46c0-af6a-c19df4c02714`. Its DynamoDB
transaction advanced the state from version 1 to version 2 and stored
`RESULT#automatic-batch-2026-08-16T04:18:20.654Z`. The independently validated
route succeeded with 42.18 ms of computation, and the message was deleted before
the success line was printed.

The 42.18 ms measurement is route computation only, not end-to-end latency. If
DynamoDB commits but SQS deletion fails, the durable update remains and the
message can be delivered again. Recognising that committed batch and finishing
deletion safely is explicitly Phase 4.3.3 rather than hidden by this milestone.

### 2.11 Phase 4.3.3 duplicate-and-conflict progress

The worker now checks for `RESULT#<batchId>` before loading state or calculating a
route. A valid existing result proves that the batch transaction committed during
an earlier delivery, so the repeated SQS message can be deleted without changing
state or creating another result.

When a DynamoDB transaction reports a conditional or transaction conflict, the
worker checks whether another worker committed the same batch. Otherwise it
reloads current state and retries, with a strict maximum of three state-write
attempts. Capacity, validation, and other DynamoDB failures are not misclassified
as conflicts. An unresolved conflict remains undeleted for SQS handling.

Seven focused tests cover stored-result loading, conflict classification,
duplicate deletion, same-batch races, fresh-state retry, and the three-attempt
boundary. All 76 project tests pass locally.

The live AWS test republished
`automatic-batch-2026-08-16T04:18:20.654Z` as message
`25cea65b-10ed-480b-9791-01ec162c4523`. Two legitimate messages were delivered
first and advanced the state to version 5. The repeated message was then matched
to its existing version-2 result and deleted without another state update or route
calculation. This completed the Phase 4.3.3 live verification.

### 2.12 Phase 4.3.4 retry-and-failure progress

The local implementation now contains one setup command for an SQS failure queue.
It creates or reuses `evacuva-route-request-failures`, assigns 14-day retention,
allows only `evacuva-route-requests` to use it, and applies a three-receive redrive
policy to the source queue. The command reads both policies back before it reports
success. It now tolerates AWS's documented propagation window by polling for no
more than 60 seconds and compares the returned receive limit numerically. The
first two live runs exposed attribute propagation and AWS's JSON number
normalisation, which are now covered by the setup verification.

The route worker now requests SQS's `ApproximateReceiveCount` attribute and prints
that count when rejecting a message. Rejected messages remain undeleted, so SQS—not
another application loop—owns their later delivery and eventual isolation. Two
new focused tests cover valid policy setup, invalid retry limits, and delayed
attribute visibility, while the existing invalid-message test now proves
receive-count reporting. All 79 project tests, linting, and formatting pass
locally.

The live setup then verified `evacuva-route-requests` with a receive limit of 3
and attached `evacuva-route-request-failures` as its failure queue. The command
also verified the restricted redrive allow policy and 14-day retention.

The controlled message `0e8e5e79-39b4-40b4-8904-5f6b08bd0e99` was rejected by
the worker at receive counts 1, 2, and 3. A fourth source receive returned no
message, and the failure queue returned the same ID and unchanged intentional-test
body. This proves the worker preserved the failed request and SQS moved it after
the configured limit. Phase 4.3.4 is complete.

### 2.13 Phase 4.4.1 container progress

The first ECS milestone begins with a local image rather than creating cloud
resources immediately. One Dockerfile packages the existing Node.js 24 worker,
contracts, and routing core. A root `.dockerignore` limits the build context to
those necessary manifests and source files and excludes tests, credentials,
Node-RED state, local dependencies, and unrelated applications.

The image installs locked production dependencies and runs as the non-root Node.js
user. It does not introduce another worker implementation, web server, health
endpoint, deployment framework, or dependency. Local image build and runtime
verification are complete.

The `evacuva-route-worker:local` image built from a 342.63 KB context and measured
85,423,868 bytes. Inspection verified Node.js 24.19.0, production mode, Linux
`amd64`, non-root UID 1000, the expected command, all required runtime modules,
and no test files. Starting it without a queue URL produced the existing clear
configuration error. Phase 4.4.1 is complete.

### 2.14 Phase 4.4.2 ECR progress

One private ECR repository named `evacuva-route-worker` was created in
`us-east-1`. It uses immutable image tags, AES-256 encryption, and scan-on-push.
No lifecycle policy, repository permission override, replication rule, or second
repository was added.

The verified local image was pushed with the descriptive tag `phase-4-4-1` to:

```text
620491751244.dkr.ecr.us-east-1.amazonaws.com/evacuva-route-worker:phase-4-4-1
```

The registry returned index digest
`sha256:585a198b601a47138514059e488632c9e243087a4dfdf7f85e9aebb848ec8d83`,
which exactly matches the digest reported by the local Docker image. ECR records
an 85.42 MB active image index containing the Linux `amd64` runnable image. This
completes Phase 4.4.2 and proves that the exact locally verified artifact is
available to ECS.

The scan of the runnable image completed successfully but reported 3 critical,
5 high, 11 medium, and 1 low package findings. These findings are not hidden or
described as resolved. They must be reviewed against updated base-image packages
before the image is used for the first ECS task, with any remaining university
prototype limitation documented explicitly.

### 2.15 Approved multi-occupant scaling redesign

The 20 August 2026 tutor discussion changed the planned workload. The final system
must place ten distinct simulated occupants on valid floor cells and create ten
independent route requests every five seconds. All ten requests use the same
building-state version produced by one accepted sensor batch.

The approved next architecture separates the current combined worker into three
responsibilities:

1. A state coordinator consumes a sensor batch, advances shared state once, stores
   an immutable compact state version, and makes it available for requests.
2. A load generator sends ten independent HTTP requests through an Application
   Load Balancer. A Node.js request-service task validates each request, sends one
   calculation job to SQS, returns its request ID, and provides result lookup.
3. A pool of read-only route workers loads the requested state version, calculates
   one route, and stores one idempotent result without changing shared state.

The existing `evacuva-route-requests` queue will become the actual occupant route
queue. The dedicated state-update queue now receives sensor batches. The ALB will
distribute HTTP traffic among request-service tasks, while SQS distributes stored
calculation jobs among competing ECS route-worker tasks. The route workers are not
ALB targets.

The occupants, state coordinator, immutable state, HTTP request boundary, ALB, two
request-service tasks, and two read-only route-worker tasks are implemented. The
older combined-worker image remains historical baseline evidence, while immutable
tag `phase-4-5-4` is the deployed multi-occupant worker. The experiment will now
measure periodic groups of 10 and bursts of 20, 50, and 100 without adding
artificial delays.

### 2.16 Phase 4.5.1 occupants, contracts, and versioned records

Phase 4.5.1 is complete. The scenario generator now creates ten occupants named
`occupant-01` through `occupant-10` on unique walkable non-exit coordinates. The
first generated occupant keeps the original seeded selection behaviour so existing
single-route experiments remain reproducible. A caller may still provide one
explicit baseline start or a complete list of ten distinct explicit starts.

The current building-state contract now validates all ten occupants, including
their IDs, scenario IDs, unique coordinates, placement, and whether each start was
generated or explicit. The existing `occupantStart` field deliberately remains as
the first occupant's start because the tested single-route algorithm still uses it.
This is compatibility for the measured baseline, not a second occupant model.

Every route request now requires an occupant ID together with its request ID,
scenario ID, immutable state version, start coordinate, priority, and submission
time. The existing single-route state operation identifies `occupant-01`, while
later request-service work will create one independent request per occupant.

The compact DynamoDB mapping can now create `STATE#<version>` records and reconstruct
the exact scenario state, including all occupants, without storing the generated
10,000-cell floorplan. The current `STATE` record remains supported.

### 2.17 Phase 4.5.2 state coordinator implementation

The Phase 4.5.2 code is complete and locally tested. State advancement now lives in
one shared core operation that validates a sensor batch, updates the five affected
readings, advances the state version once, and creates the state event. The existing
single-route baseline calls this operation before calculating its route, while the
new coordinator calls it without route calculation.

The compact state-record mapping was moved from the route-worker application into
the core package because both applications now require exactly the same mapping and
reconstruction rules. This relocation removed the old app-owned files; it did not
remove their behaviour or create a duplicate implementation.

The new state coordinator consumes one validated sensor batch from its dedicated
SQS boundary. One DynamoDB transaction conditionally writes:

1. the new current `STATE` record
2. the immutable `STATE#<version>` record
3. an idempotency marker named `BATCH#<batchId>`

The message is deleted only after that transaction succeeds. A repeated batch finds
the marker and is deleted without advancing state again. A real concurrent-state
conflict reloads current state and retries up to three times. Invalid messages and
unresolved failures remain in SQS for the queue retry policy.

The command `npm.cmd run aws:setup:state-update-queue` creates or verifies the
descriptively named `evacuva-state-updates` queue with a 30-second visibility
timeout and 10-second long polling. On 22 August 2026 it created and verified:

- URL: `https://sqs.us-east-1.amazonaws.com/620491751244/evacuva-state-updates`
- ARN: `arn:aws:sqs:us-east-1:620491751244:evacuva-state-updates`
- visibility timeout: 30 seconds
- receive-message long poll: 10 seconds

The active `evacuva_sensor_batches_to_sqs` rule now sends the unchanged accepted
batch topic to this queue through `LabRole`. Its SQL remains enabled and the role's
`sqs:SendMessage` decision for the new queue was verified as `allowed`.

The existing version 5 state was then migrated in place because it predated the
multi-occupant contract. The setup command added ten occupants without changing the
state version or existing readings. DynamoDB verification returned version 5 and
an occupant count of 10; the resulting compact item was 15,216 bytes.

Because a restarted simulator can begin from sequence 2 while durable DynamoDB
readings may already have that sequence, `npm.cmd run aws:test:state-update` builds
one valid five-reading batch from the current stored sequences and queues two
identical copies. This produces controlled live evidence for both the successful
transaction and duplicate protection without weakening stale-reading validation.

The controlled live test completed successfully on 22 August 2026:

- the first SQS message was applied on attempt 1
- current state advanced from version 5 to version 6
- DynamoDB contained `STATE`, `STATE#6`, and
  `BATCH#state-test-2026-08-22T10:20:34.883Z`, all at version 6
- the second SQS message contained the identical batch and was deleted as a
  duplicate
- a final consistent DynamoDB read confirmed that `STATE` remained at version 6

This proves the coordinator's required exactly-once logical state update under the
tested duplicate-delivery case. It does not claim that standard SQS delivers a
physical message only once.

### 2.18 Phase 4.5.3 local request service

The request-service code is complete and locally verified. It uses Node.js's
built-in HTTP server rather than adding a web framework. `POST /route-requests`
validates the shared route-request contract, consistently loads the exact
`STATE#<version>` record, and confirms that the occupant ID and start coordinate
belong to that immutable state before sending one calculation event to SQS. It
returns HTTP 202 without calculating a route.

`GET /route-results/{requestId}` consistently reads `RESULT#<requestId>` and
returns either pending or the validated stored result. `GET /health` reports only
HTTP process availability for future ALB health checks. A separate result-record
contract correlates the original request, state version, and result without
changing the older batch-result format used by the measured baseline worker.

The AWS SDK boundaries are kept in two focused files: one for DynamoDB reads and
one for SQS publishing. The HTTP file contains no AWS client construction or route
algorithm, and the entry point contains only environment configuration and process
lifecycle handling. No authentication, load generator, read-only route worker, or
deployment resource was added early.

Local evidence on 22 August 2026:

- ESLint and Prettier passed
- all 108 project tests passed
- the request-service image built from `node:24-bookworm-slim`
- the image contained 41 audited runtime packages and reported zero vulnerabilities
- the temporary container returned a healthy response from `/health`
- the container ran as UID 1000, contained zero test files, and loaded all runtime
  modules
- the local image size was 85,422,627 bytes

After fresh Academy credentials became available, the signed-in AWS environment
was inspected before any deployment resource was added. `LabRole` trusts
`ecs-tasks.amazonaws.com`, the default VPC has six public subnets in separate
availability zones, and no Evacuva ECS cluster or load balancer existed. The
private `evacuva-request-service` ECR repository was then created with immutable
tags, scan-on-push, and AES-256 encryption.

The verified local image was pushed as `phase-4-5-3`. Its ECR digest exactly
matched the local digest:
`sha256:cab277999a585082fcae1b1e9928db67eb098f123927f5a601648469c81c9d98`.
Task definition `evacuva-request-service:1` references that digest directly and
uses 0.25 vCPU, 512 MiB memory, port 3000, and `LabRole` for the required ECR,
SQS, and DynamoDB access.

The deployment created only the request-ingress resources required by this phase:

- active ECS cluster `evacuva-cluster`
- two public subnets in `us-east-1a` and `us-east-1b`
- one public ALB security group allowing HTTP port 80
- one task security group allowing port 3000 only from the ALB group
- target group `evacuva-request-service` with `/health` checks
- Application Load Balancer `evacuva-request-alb`
- HTTP listener on port 80
- ECS service `evacuva-request-service` with desired and running count 2

Both targets, `172.31.29.200:3000` and `172.31.38.36:3000`, became healthy. The
service rollout completed with zero pending tasks. Through the ALB DNS name,
`GET /health` returned HTTP 200 with the request-service health body, and a
read-only missing-result lookup returned HTTP 202 with a pending response. At the
end of Phase 4.5.3 no route request had been submitted because the worker conversion
was deliberately left for Phase 4.5.4.

The live ALB currently uses HTTP rather than HTTPS and the public listener has no
application authentication. This is an explicit university-prototype limitation;
the URL must not be presented as a production-safe emergency API. The task port is
not public. AWS basic ECR scanning could not scan the Docker Buildx OCI image index
and returned `UnsupportedImageTypeException`, so no request-service scan findings
are claimed.

### 2.19 Phase 4.5.4 read-only worker pool

The route worker now accepts the same `route-calculation-requested` event published
by the request service. It consistently loads only the requested immutable
`STATE#<version>` item, confirms the occupant ID and start position, reuses the one
shared route calculation and validation implementation, and conditionally stores
`RESULT#<requestId>`. It never writes `STATE` or a new state version.

The single conditional result write makes simultaneous deliveries safe. A worker
deletes a request only after a result exists durably. Existing results and
conditional-write conflicts are treated as duplicates and deleted. Invalid input,
missing state, DynamoDB errors, and SQS deletion errors remain visible and retain
the message for the existing three-receive SQS retry and failure-queue policy.

The obsolete batch-worker tests were replaced rather than retained beside the new
contract. The updated duplicate-delivery evidence command now uses a stored request
ID. No dependency or second routing implementation was added. Local verification
on 22 August 2026 produced:

- ESLint and Prettier passed
- all 108 project tests passed, including 15 focused route-store and worker tests
- the rebuilt image ran as the non-root `node` user
- the image contained zero test files and loaded both runtime modules
- local image size: 85,425,289 bytes

The image was pushed as immutable tag `phase-4-5-4`. The ECR digest exactly matched
the local digest:
`sha256:2535f3f1a9a6b8944920b2d9f786e41352b736fc6a1f0599ea04fcc3a84b5abb`.
ECR reported a compressed size of 85,421,489 bytes. AWS basic scanning returned
`UnsupportedImageTypeException` for the Docker Buildx OCI image index, so this tag
is not described as having a clean scan.

The AWS deployment added only the worker resources required by this phase:

- task definition `evacuva-route-worker:1`, pinned to the exact image digest
- ECS service `evacuva-route-worker` with desired and running count 2
- security group `sg-0df61145e0d55c530` with zero inbound rules
- 0.25 vCPU and 512 MiB memory per Fargate task
- public IP assignment for outbound ECR, SQS, and DynamoDB access in the default
  public subnets; no inbound worker port is exposed

The service reached steady state with two running tasks and zero pending tasks. A
live request named `phase-4-5-4-live-20260822T111413Z` was submitted through the
ALB for `occupant-01` and immutable state 6. The worker returned a successful,
independently validated 38-step route with 3,218 ms queue time, approximately
790.00 ms computation time, and 4,313.59 ms total measured latency. Current `STATE`
remained version 6.

Submitting the same request ID again returned HTTP 202 but did not change the
stored result timestamp (`2026-08-22T11:14:17.091Z`), proving idempotent duplicate
handling in the live path. The single request completed within five seconds, but it
was not the controlled multi-request SLA experiment.

### 2.21 Phase 4.6 load and autoscaling progress

The load generator now sends concurrent occupant requests through the public ALB,
polls each correlated result, validates the returned route contract, and records
client-observed latency. It can run one controlled burst or start overlapping
bursts at a configured interval. The periodic mode exists specifically for the
approved ten-request workload every five seconds; it does not insert route-worker
delays or wait for an earlier interval to finish before starting the next one.

The fixed baseline used one warm Fargate route worker, current state version 6,
and run `phase-4-6-20-20260822113208817`. All 20 requests returned validated
successful routes. Median latency was 15,993 ms, p95 was 24,527 ms, and maximum
latency was 25,427 ms. The twentieth request completed in 13,843 ms, so the
five-second SLA failed under one-worker capacity. This failure is retained as the
baseline result rather than removed from the evidence.

Five controlled one-worker 20-request trials produced the following baseline:

| Trial | Valid routes | Median    | p95       | Maximum   | Twentieth request  | SLA  |
| ----- | ------------ | --------- | --------- | --------- | ------------------ | ---- |
| 1     | 20/20        | 15,993 ms | 24,527 ms | 25,427 ms | 13,843 ms, success | Fail |
| 2     | 20/20        | 13,889 ms | 20,627 ms | 21,793 ms | 13,057 ms, success | Fail |
| 3     | 20/20        | 8,393 ms  | 14,946 ms | 15,949 ms | 11,431 ms, success | Fail |
| 4     | 20/20        | 8,679 ms  | 14,851 ms | 15,903 ms | 10,642 ms, success | Fail |
| 5     | 20/20        | 7,971 ms  | 14,714 ms | 15,589 ms | 5,126 ms, success  | Fail |

All 100 routes were valid, but the official twentieth request missed five seconds
in every trial. Its median across the five trials was 11,431 ms and its range was
5,126 to 13,843 ms. This gives the fixed configuration a zero-of-five SLA result.

The ECS cluster now publishes Container Insights task-count metrics. Application
Auto Scaling has a scalable target for `evacuva-route-worker` with a minimum of two
tasks and a maximum of ten. Target tracking uses
`ApproximateNumberOfMessagesVisible / RunningTaskCount` and uses 30-second
scale-out and 180-second scale-in cooldowns. AWS created the matching high and low
CloudWatch alarms, and the service returned to a steady two-running-task minimum.

Periodic run `phase-4-6-10-20260822114206297` sent ten requests every five seconds
for 48 intervals. All 480 requests returned valid routes with no failures. Early
interval maxima were 12,308 to 15,051 ms, while most later intervals completed in
approximately 4,200 to 5,300 ms. AWS scaling history confirmed that this
improvement came from the two-worker minimum rather than an automatic scale-out.
The minute-level visible backlog was 8, 5, 2, 4, and 4 messages, but the original
one-message-per-worker alarm did not receive three consecutive samples above its
target. Based on that measured result, the target was calibrated to 0.5 queued
requests per worker, representing one waiting request for every two active
workers. A second identical periodic run also returned 480 valid routes but
confirmed that three-period target tracking was too slow for the short queue
spikes. The design therefore retained the same backlog-per-worker metric and added
a one-period step scale-out alarm rather than inserting an artificial route delay.

Periodic run `phase-4-6-10-20260822115737586` verified the revised policy. All 480
requests returned valid routes with no failures. The backlog alarm automatically
changed desired worker capacity from two to six at 12:00:24 UTC, and the scaling
activity completed successfully at 12:00:56 UTC. Later interval maxima fell to
approximately 2,600 to 3,200 ms. The route queue returned to zero visible and zero
in-flight messages after the workload.

The first warm autoscaled 20-request SLA trial used run
`phase-4-6-20-20260822120253878`, state version 6, and six running workers. All 20
routes were successful and contract-valid. Median latency was 4,207 ms, p95 was
5,078 ms, and maximum latency was 5,106 ms. The twentieth request completed in
4,207 ms and therefore passed the specified five-second SLA. Compared with the
one-worker twentieth-request baseline of 13,843 ms, this is a 69.6 percent latency
reduction. Eighteen of the 20 requests finished within five seconds; the two slower
requests and p95 above five seconds remain recorded rather than being hidden.

Five warm autoscaled 20-request trials produced the following results:

| Trial | Valid routes | Median   | p95      | Maximum  | Twentieth request        | SLA  |
| ----- | ------------ | -------- | -------- | -------- | ------------------------ | ---- |
| 1     | 20/20        | 4,207 ms | 5,078 ms | 5,106 ms | 4,207 ms, success        | Pass |
| 2     | 20/20        | 4,637 ms | 5,199 ms | 5,751 ms | 4,635 ms, success        | Pass |
| 3     | 18/20        | 3,949 ms | 4,751 ms | 4,751 ms | Client error at 3,856 ms | Fail |
| 4     | 20/20        | 3,975 ms | 4,661 ms | 4,878 ms | 3,904 ms, success        | Pass |
| 5     | 19/20        | 4,047 ms | 4,607 ms | 4,607 ms | 4,050 ms, success        | Pass |

The defined twentieth-request SLA passed in four of five trials, giving an 80
percent trial pass rate. Across all 100 client requests, 97 returned validated
routes, 92 both succeeded and completed within five seconds, five succeeded after
five seconds, and three returned client errors. Successful-request latency had a
4,066 ms median, 5,066 ms p95, and 5,751 ms maximum.

Three supplementary six-worker trials were run after the main comparison. All 60
routes were valid and all three twentieth requests passed in 4,507 ms, 4,615 ms,
and 3,590 ms. Their run IDs were `phase-4-6-20-20260822123835752`,
`phase-4-6-20-20260822123846790`, and
`phase-4-6-20-20260822123858445`. These confirmation runs do not replace the
original five-trial set or remove its failed trial. Across all eight observed
six-worker trials, seven twentieth requests passed.

DynamoDB contains a successful validated result for each of the three client-error
request IDs. During the same minute, Application Load Balancer metrics recorded
exactly three ALB-generated 5xx responses, zero target-generated 5xx responses,
and zero target connection errors. The route calculations therefore completed,
but the client did not receive valid end-to-end responses, so the failures remain
counted. The request-service task definition did not have container logging
enabled, and the earlier load output did not print error details, so a more exact
HTTP status cannot be claimed. The runner now prints its error message on future
failures.

The matched five-trial comparison is therefore zero of five SLA passes for one
worker and four of five for six warm workers. The six-worker configuration improved
the twentieth-request median from 11,431 ms to 4,050 ms, but the 80 percent pass
rate means the prototype does not guarantee the SLA.

The higher-load comparison used the same scenario, state version, ALB, two
request-service tasks, request generator, and result validation. Only route-worker
capacity changed. Scale-in was temporarily suspended to keep each run at one or
six warm workers; automatic scale-out remained available for the six-worker runs.

| Burst | Workers | Valid routes | Median    | p95       | Maximum   | Twentieth request |
| ----- | ------- | ------------ | --------- | --------- | --------- | ----------------- |
| 50    | 1       | 50/50        | 18,911 ms | 34,953 ms | 36,509 ms | 11,076 ms         |
| 50    | 6       | 50/50        | 11,020 ms | 12,690 ms | 13,554 ms | 11,753 ms         |
| 100   | 1       | 97/100       | 37,112 ms | 68,106 ms | 70,924 ms | 9,255 ms          |
| 100   | 6       | 99/100       | 12,024 ms | 19,537 ms | 20,481 ms | 5,728 ms          |

At 50 requests, six workers reduced median latency by 41.7 percent and p95 by 63.7
percent. At 100 requests, they reduced median latency by 67.6 percent and p95 by
71.3 percent. The six-worker 50-request twentieth result happened to be slower
than the one-worker result, which shows why the comparison uses distributions and
not one selected request. Both larger bursts still exceeded five seconds.

During the six-worker 50/100 window, ALB metrics counted 334 HTTP submissions and
result polls, one ALB-generated 5xx, zero target-generated 5xx responses, and zero
target connection errors. The maximum minute-level visible route backlog was seven.
ECS recorded the six worker task identities, while each DynamoDB result recorded
its queue, compute, total timing, and validated outcome. The request service stayed
at two tasks because these measurements did not prove a target-capacity problem;
the unexplained ALB-generated HTTP 502 remains a reliability limitation.

The completion review found that the deployed worker timestamped `queueTimeMs`
after computation and then added compute time again when forming its stored total.
The client-observed end-to-end figures in both tables are independent of that field
and remain valid. The local worker now records queue time when processing starts and
total time directly from submission to completion, with a regression assertion.
This correction requires a future image deployment before new AWS result records
use the corrected internal timings.

After the experiment, the route queue was zero visible and zero in flight. The
service was returned to two running workers, its normal two-to-ten scalable target,
and active target-tracking and step scale-out policies. All temporary scaling
suspensions were removed.

## 3. What currently works

The implemented local workflow is:

```text
Seed and configuration
        |
Generate 100x100 floorplan
        |
Place occupant and 42 sensors
        |
Create validated building-state snapshot
        |
Convert readings into risks and hard blocks
        |
Calculate lowest-cost route with Dijkstra's algorithm
        |
Independently validate the returned route
```

### 3.1 Reproducible floorplan generation

The system generates a complete 100 by 100 grid containing 10,000 cells. The
default configuration contains:

- 24 non-overlapping rectangular rooms
- connected floor corridors
- permanent wall cells
- 6 exits on the building boundary
- one connected walkable network

Generation is controlled by a non-negative integer seed. The same seed and
configuration reproduce the same floorplan. Different seeds produce different
layouts while still following the structural rules.

The independent floorplan validator checks:

- grid dimensions and cell count
- coordinate boundaries and duplicate coordinates
- expected room count
- exit count and boundary placement
- matching exit cells
- connectivity of every walkable cell

The approved demonstration seed is `48291`. Its verified floorplan contains:

- 7,450 wall cells
- 2,544 floor cells
- 6 exit cells

Its exit coordinates are `(90, 0)`, `(99, 52)`, `(70, 99)`, `(0, 30)`, `(72, 0)`,
and `(99, 30)`.

### 3.2 Occupant starting position

The generator chooses one walkable, non-exit floor coordinate as the default start.
This selection is seeded and therefore reproducible.

A caller can also provide an explicit start. Wall coordinates, exit coordinates,
negative coordinates, and coordinates outside the floorplan are rejected.

For seed `48291`, the current default start is `(86, 77)`.

### 3.3 Sensor placement

The system places 42 virtual sensors:

| Sensor type | Quantity | Allowed location |
| ----------- | -------- | ---------------- |
| Smoke       | 12       | Floor cells      |
| Temperature | 12       | Floor cells      |
| Occupancy   | 12       | Floor cells      |
| Door        | 6        | Exit cells       |

Environmental sensors use unique floor coordinates. Each exit receives one door
sensor. Sensor positions stay fixed after a scenario is generated.

Every sensor definition records its sensor ID, type, and exact coordinate.

### 3.4 Initial sensor readings

Every generated scenario begins with one validated reading per sensor:

| Reading     | Initial value           |
| ----------- | ----------------------- |
| Smoke       | 0 ppm                   |
| Temperature | 22 degrees Celsius      |
| Occupancy   | 0.1 normalised density  |
| Door        | Open and not obstructed |
| Health      | Healthy                 |
| Sequence    | 1                       |

Every reading contains an event ID, scenario ID, sensor ID, sensor type,
coordinate, timestamp, sequence number, health status, and type-specific value.

Runtime schemas reject invalid values, including negative smoke, temperatures
outside -50 to 300 degrees Celsius, occupancy outside 0 to 1, incomplete door
values, duplicate sensor IDs, unknown sensors, and mismatched coordinates.

### 3.5 Current sensor and state-update behaviour

The Node.js simulator now emits five different automatic sensor readings every five
seconds. Its 12-batch cycle reaches all 42 sensors and then repeats. Readings can
also be overridden immediately through a validated local command. Manual mode
affects only the selected sensor; other selected nodes continue. A resume command
restores that node on the next automatic cycle without duplicating its event. The
local safety engine also reacts correctly when readings are changed directly in
tests.

Node-RED now consumes the automatic and manual MQTT events. Each five-reading
automatic interval creates one building-state version and one route calculation.
A manual override is applied immediately as a one-reading state update. Stale or
malformed readings are rejected before the state engine, and the dashboard exposes
forms for manual override and resume commands.

Sensor coordinates remain fixed. Only their readings change. Current state and
route-result history are held in memory during this local phase, so restarting the
state engine returns to the reproducible initial state.

### 3.6 Versioned building state

The current building state combines:

- scenario ID
- state version
- complete floorplan
- occupant start
- all sensor definitions
- one latest reading per sensor
- update timestamp

This ensures a route can be linked to the exact floorplan and sensor snapshot that
produced it. The initial state version is 1.

### 3.7 Safety-map calculation

The safety model converts healthy sensor readings into movement risk. It keeps
permanent walls separate from changing conditions.

Each walkable cell records:

- smoke risk
- temperature risk
- congestion risk
- total risk
- movement cost
- blocked status

Risk decreases with Manhattan distance from the sensor. Contributions from
multiple healthy sensors are added together. The current experimental parameters
are documented in `Design.md` and are not real emergency thresholds.

Current hard-block behaviour:

- smoke at or above 250 ppm blocks cells within distance 1
- temperature at or above 80 degrees Celsius blocks cells within distance 1
- a closed or obstructed door blocks its exit
- an unhealthy reading has no effect

### 3.8 Safest-route calculation

The route engine uses Dijkstra's algorithm because every movement cost is
non-negative. Movement is allowed only north, south, east, and west.

The algorithm searches from the requested start and stops when it reaches the
lowest-cost available exit. It uses safety cost rather than cell count alone. This
allows the system to choose a longer path when the shorter path passes through
greater simulated danger.

A successful result contains:

- request and scenario IDs
- state version
- ordered path coordinates
- selected exit
- route cost and path length
- visited-node count
- queue, compute, and total latency fields
- algorithm version
- successful validation status

The local queue time is currently zero because SQS is a Phase 4 feature.

The route engine returns a clear failure instead of an empty successful path:

| Failure reason      | Meaning                                |
| ------------------- | -------------------------------------- |
| `invalid_start`     | Start is not an allowed floor cell     |
| `blocked_start`     | Current hazards block the start        |
| `all_exits_blocked` | Every door or exit is unavailable      |
| `unreachable_exit`  | Safe exits exist but cannot be reached |

### 3.9 Independent route validation

The independent validator does not run the route-search algorithm. It checks the
returned result against the request, state, and safety map.

It verifies:

- matching request ID
- matching scenario ID and state version
- correct start coordinate
- adjacent path steps
- accessible and non-blocked cells
- an available final exit
- correct path length
- recalculated route cost

The validator rejects disconnected paths, incorrect costs, stale state versions,
blocked cells, and invalid exits.

## 4. Verified behaviour and tests

The project currently has 58 passing tests using Node.js's built-in test runner.

The tested behaviour includes:

- valid and invalid coordinate contracts
- fixed 100 by 100 configuration
- reproducible floorplans
- different layouts from different seeds
- room, corridor, exit, and connectivity rules
- 100 validated floorplan seeds
- random and explicit occupant starts
- correct sensor quantities and placement
- neutral initial readings
- invalid sensor values
- 100 validated complete scenario seeds
- smoke, temperature, and occupancy formulas
- critical smoke and temperature blocks
- closed and unhealthy door behaviour
- unhealthy environmental readings
- successful route calculation
- longer but lower-risk route selection
- hard-block avoidance
- all four defined route failures
- disconnected-path and incorrect-cost rejection
- stale state-version rejection
- valid routes across 20 generated scenarios
- independent sequence numbers across 42 logical sensor nodes
- five unique automatic readings in each normal interval
- all 42 sensors covered by one 60-event cycle
- automatic event scheduling without callback overlap
- immediate manual sensor events and per-sensor manual mode
- continued automatic events from non-overridden sensors
- next-cycle automatic resume with the latest scripted value
- invalid scenario, sensor, value, and resume commands
- five-reading delivery through a real local MQTT broker
- MQTT manual override, duplicate command, and resume behaviour
- malformed MQTT message recovery
- unavailable-broker and different-scenario rejection
- automatic and manual reading-batch contracts
- one state version and route result per accepted batch
- stale reading rejection before state replacement
- required Node-RED table and control nodes
- five-reading aggregation in the actual Node-RED Function node
- a real four-process MQTT-to-state-to-route run
- an HTTP 200 response from the live dashboard page

The latest verified quality checks are:

```text
58 tests passed
0 tests failed
ESLint passed
Prettier passed
```

No TypeScript, Docker, deployment YAML, CI/CD workflow, infrastructure-as-code,
cloud resource, or speculative application layer has been added.

The current npm audit reports 11 transitive advisories inside Node-RED's bundled
`jsonata` and package-management dependencies. npm's proposed automatic fix is a
major downgrade from Node-RED 5 to 3, so it was not applied without compatibility
evidence. The current dashboard binds only to `127.0.0.1`, contains no credentials,
and does not use JSONata expressions. This is recorded as a local dependency
limitation, not presented as zero vulnerability risk.

## 5. Demonstrated route change

A controlled test uses seed `48291` and adds smoke at coordinate `(86, 74)`.

Under that smoky state:

- the original 38-step shortcut would cost `90.5888`
- the selected safer route uses 42 steps
- the selected safer route costs `65.904`

This proves the implementation is not simply returning the geometrically shortest
path. At the critical smoke value, the returned alternative also avoids every
hard-blocked cell.

## 6. Local performance evidence

One local diagnostic submitted 20 route calculations sequentially using the
unchanged seed `48291` state.

| Measurement             | Result                        |
| ----------------------- | ----------------------------- |
| Environment             | Node.js 24.16.0, Windows x64  |
| Processor               | 12th Gen Intel Core i5-12450H |
| Completed and valid     | 20 of 20                      |
| Median total latency    | 32.2587 ms                    |
| 95th-percentile latency | 43.1570 ms                    |
| Maximum latency         | 56.0137 ms                    |
| Twentieth request       | Valid in 32.2806 ms           |

This result measures the local route engine only. It is not the official
five-second SLA result. It excludes MQTT, AWS IoT Core, SQS queue waiting, ECS,
DynamoDB, result storage, and network delivery. The official SLA must be measured
in Phase 4 using repeated end-to-end 20-request bursts.

## 7. Tutor requirements progress

| Requirement | Current progress                                                  |
| ----------- | ----------------------------------------------------------------- |
| TF-01       | Seeded random floorplans implemented and validated                |
| TF-02       | Random and explicit occupant starts implemented                   |
| TF-03       | Multiple mapped sensors and local reading changes implemented     |
| TF-04       | Floorplan, readings, hazards, walls, and doors combined locally   |
| TF-05       | Safest valid local route implemented and independently validated  |
| TF-06       | SQS buffering, competing workers, and backlog scaling verified    |
| TF-07       | Repeated end-to-end SLA measured; 4/5 scaled and 0/5 fixed passes |

The 20 August tutor update adds these planned requirements:

| Requirement | Current progress                                                     |
| ----------- | -------------------------------------------------------------------- |
| TU-01       | Ten distinct occupant starts and IDs are implemented and tested      |
| TU-02       | State coordinator and ALB HTTP intake are verified live              |
| TU-03       | Matched one-worker and six-worker 20, 50, and 100 bursts compared    |
| TU-04       | ALB intake and queue-driven two-to-ten worker autoscaling verified   |
| TU-05       | HTTP submission-to-result SLA measured over five trials per capacity |

## 8. Main project files

### Documentation

- `Rules.md`: mandatory implementation and quality rules
- `Design.md`: complete requirements, architecture, formulas, and evidence record
- `Progress.md`: plain-language record of completed and remaining work

### Shared contracts

- `packages/contracts/src/index.js`: runtime schemas, event envelopes, topic
  patterns, occupant/request contracts, versioned-state records, and defaults
- `packages/contracts/src/index.test.js`: contract behaviour tests

### Floorplan

- `packages/core/src/floorplan/generateFloorplan.js`: seeded floorplan generation
- `packages/core/src/floorplan/seededRandom.js`: deterministic random source
- `packages/core/src/floorplan/validateFloorplan.js`: structural connectivity checks
- `packages/core/src/floorplan/generateFloorplan.test.js`: floorplan tests

### Scenario and sensors

- `packages/core/src/scenario/generateScenario.js`: ten occupants, sensors, and
  initial readings
- `packages/core/src/scenario/generateScenario.test.js`: scenario-state tests

### Safety and routing

- `packages/core/src/safety/buildSafetyMap.js`: readings to risk and blocks
- `packages/core/src/safety/buildSafetyMap.test.js`: safety-model tests
- `packages/core/src/routing/calculateSafestRoute.js`: Dijkstra route search
- `packages/core/src/routing/validateRoute.js`: independent route validation
- `packages/core/src/routing/calculateSafestRoute.test.js`: routing and failure tests
- `packages/core/src/index.js`: public core-package exports

### Project configuration

- `package.json`: Node.js workspace and verified commands
- `package-lock.json`: exact installed dependency versions
- `eslint.config.mjs`: static code checks
- `.prettierrc.json`: formatting rules
- `.prettierignore`: formatting exclusions
- `.gitignore`: local dependency and generated-file exclusions

### Sensor simulator application

- `apps/simulator/src/sensorNode.js`: logical sensor state, modes, and reading events
- `apps/simulator/src/sensorNode.test.js`: sequence, validation, and mode behaviour
- `apps/simulator/src/sensorSimulator.js`: script, commands, and non-blocking timer
- `apps/simulator/src/sensorSimulator.test.js`: simulator, command, and timer tests
- `apps/simulator/src/runSimulator.js`: single MQTT-enabled simulator entry point
- `apps/simulator/src/localMqttBroker.js`: testable in-memory local MQTT broker
- `apps/simulator/src/runLocalMqttBroker.js`: local broker entry point
- `apps/simulator/src/mqttSensorConnection.js`: publish and control-topic boundary
- `apps/simulator/src/mqttSensorConnection.test.js`: real broker integration tests
- `apps/simulator/package.json`: simulator workspace dependencies

### State engine application

- `apps/state-engine/src/mqttStateEngine.js`: MQTT batch subscription and result
  publishing
- `apps/state-engine/src/runStateEngine.js`: runnable local state-engine entry point

### Shared state operation

- `packages/core/src/state/advanceBuildingState.js`: state-only validated sensor
  update used by both the baseline and coordinator
- `packages/core/src/state/applySensorReadingBatch.js`: applies one accepted batch
  and creates one correlated route result for the local sequential baseline
- `packages/core/src/state/applySensorReadingBatch.test.js`: state, route, manual,
  and stale-reading tests
- `packages/core/src/state/scenarioStateRecord.js`: compact current and immutable
  state mapping with deterministic reconstruction
- `packages/core/src/state/scenarioStateRecord.test.js`: item-size, round-trip, and
  version-key tests

### State coordinator application

- `apps/state-coordinator/src/sqsStateCoordinator.js`: one-message SQS processing,
  duplicate recognition, conflict retry, and safe deletion
- `apps/state-coordinator/src/dynamoStateStore.js`: atomic current, versioned, and
  applied-batch DynamoDB writes
- `apps/state-coordinator/src/stateUpdateQueue.js`: repeatable dedicated queue setup
- `apps/state-coordinator/src/runStateCoordinator.js`: coordinator runtime command
- `apps/state-coordinator/src/runStateUpdateQueueSetup.js`: AWS queue setup command
- `apps/state-coordinator/src/runStateUpdateLiveTest.js`: repeatable current-state
  batch and duplicate-delivery evidence command
- matching focused tests for the SQS, DynamoDB, and queue-setup boundaries

### SQS route-worker application

- `apps/route-worker/src/sqsRouteWorker.js`: independent request processing,
  duplicate recognition, measured timing, and deletion after durable storage
- `apps/route-worker/src/sqsRouteWorker.test.js`: exact-state, read-only, retry,
  duplicate, invalid-input, storage-failure, and deletion-failure tests
- `apps/route-worker/src/runRouteWorker.js`: competing-consumer worker command and
  concise terminal results
- `apps/route-worker/src/dynamoRouteStore.js`: exact immutable-state reads and one
  conditional idempotent result write
- `apps/route-worker/src/dynamoRouteStore.test.js`: versioned reads, conditional
  writes, duplicate races, storage errors, and missing-state tests
- `apps/route-worker/src/runRoutingTableSetup.js`: repeatable table creation,
  conditional initial-state seeding, and live read-back verification
- `apps/route-worker/src/runDuplicateDeliveryTest.js`: controlled replay of a
  stored route request for live idempotency evidence
- `apps/route-worker/package.json`: direct SQS SDK and shared-package dependencies

### HTTP request-service application

- `apps/request-service/src/requestService.js`: HTTP validation, submission,
  result lookup, and health boundaries
- `apps/request-service/src/dynamoRequestStore.js`: immutable state and result
  reads from DynamoDB
- `apps/request-service/src/sqsRouteRequestQueue.js`: validated SQS route-job
  publishing
- `apps/request-service/src/runRequestService.js`: environment configuration and
  HTTP process lifecycle
- focused tests for each boundary and a minimal non-root Dockerfile

### Node-RED dashboard application

- `apps/node-red/flows.json`: MQTT validation, batching, AWS IoT output, controls,
  debug-sidebar output, three existing tables, and the latest application snapshot
- `apps/node-red/flows.test.cjs`: checks the actual flow, batching logic, secure AWS
  output, retained presentation topics, and read-only snapshot endpoint
- `apps/node-red/settings.cjs`: loopback-only runtime settings and the `/app/`
  static application path
- `apps/node-red/public/index.html`: concise visual dashboard structure
- `apps/node-red/public/styles.css`: responsive application layout and readable
  state styles
- `apps/node-red/public/dashboard.js`: snapshot polling and canvas rendering
- `apps/node-red/public/dashboardModel.js`: validated display mapping for map,
  sensor, route, direction, and experiment values
- `apps/node-red/public/dashboardModel.test.js`: focused application-model tests
- `apps/node-red/package.json`: Node-RED and FlowFuse Dashboard dependencies

### Phase 5 presentation events

- `apps/state-engine/src/dashboardEvents.js`: compact floorplan and first-direction
  event creation
- `apps/state-engine/src/dashboardEvents.test.js`: layout and guidance behaviour
- `apps/state-engine/src/mqttStateEngine.js`: retained layout and directional
  guidance publishing alongside existing live state and route events
- `packages/contracts/src/index.js`: validated floorplan-layout and
  directional-guidance contracts and MQTT topics

## 9. Verified commands

Install the exact dependencies:

```text
npm.cmd install
```

Run all tests:

```text
npm.cmd test
```

Run formatting, static checks, and tests together:

```text
npm.cmd run check
```

Run the complete local dashboard workflow in four terminals:

```text
npm.cmd run mqtt:broker
npm.cmd run state-engine
npm.cmd run node-red
npm.cmd run simulate:sensors
```

Then open `http://127.0.0.1:1880/app/`. The original Node-RED controls and tables
remain available at `http://127.0.0.1:1880/dashboard/overview`.

There is no build command because the project uses plain JavaScript and does not
require TypeScript compilation.

## 10. What is not implemented yet

The following items remain and must not be described as working:

- persistent Timestream sensor history or S3 experiment evidence
- final written sustainability evaluation and submission report
- final demonstration rehearsal and assessment packaging

## 11. Next milestone

The implementation milestone is complete. The next milestone is final submission
preparation: write the evaluation, decide whether persistent AWS history is an
explicit assessment requirement, capture reproducible evidence, and rehearse the
demonstration.

## 12. Latest `Rules.md` review

**Review date:** 27 August 2026  
**Result:** The Phase 5 application passes its implementation and local evidence
checks. The measured SLA remains an honest limitation: six workers passed four of
five trials rather than guaranteeing every trial.

The source tree, dependency direction, worker boundary, timing fields, AWS scaling
state, tests, and documentation were reviewed after the controlled experiment.

Changes made during the review:

- reused the existing Node-RED process as the validated browser-data boundary
  instead of adding another web service or dependency
- kept the full floorplan as compact retained MQTT data and kept browser snapshot
  access read-only
- made occupant selection a visual highlight because the local state engine still
  calculates the demonstrated route for `occupant-01`
- kept the recorded AWS measurements visible while distinguishing observed results
  from a guaranteed service level
- verified the live local workflow with 100 rows, ten occupants, 42 sensors, 42
  current readings, a successful route, and cardinal guidance
- passed ESLint, Prettier, and all 124 tests
- retained one focused load generator for burst and periodic modes rather than
  adding separate scripts for each experiment size
- kept the ALB on request-service ingress and used SQS backlog per active task to
  scale only the route workers
- did not add request-service autoscaling because the recorded target metrics did
  not establish it as the capacity bottleneck
- corrected the worker timing boundary so future queue time stops when processing
  begins and total time is not double-counted
- added one regression assertion to the existing worker test instead of creating a
  separate timing test file
- extracted one shared state-only operation instead of copying state mutation into
  the coordinator
- moved compact state mapping into the core package because two applications now
  use it
- stored current state, immutable state, and the applied-batch marker in one
  DynamoDB transaction
- kept failed SQS messages available for retries and deleted only committed or
  already-applied messages
- added ten deterministic distinct occupants without changing the original seeded
  baseline start
- added the occupant ID to the existing route-request boundary
- added one versioned-record schema and mapping beside the existing current-state
  mapping instead of duplicating floorplan or state reconstruction logic
- revised the planned workload to ten occupants per five-second state version
- separated the planned state coordinator from read-only route workers before ECS
  deployment
- assigned the Application Load Balancer to HTTP request ingress and result lookup
  while retaining SQS competing consumers for route-job distribution
- kept route workers outside the ALB target group so each component has one clear
  responsibility
- retained the older combined-worker image as historical baseline evidence and
  deployed the revised worker under a new immutable tag
- replaced state mutation with exact immutable-state reads and one conditional
  result write instead of keeping both worker implementations active
- kept route workers outside the ALB target group with zero inbound security rules
- moved `applySensorReadingBatch` from the state-engine application into the core
  package because both the local engine and SQS worker now require it
- kept one implementation of state application, routing, and route validation
- added only the DynamoDB document operations required for consistent reads and
  atomic state-plus-result writes
- replaced the worker's temporary in-memory state with the compact durable state
  record created in Phase 4.3.1
- stored the source batch and validated result under one correlated descriptive key
- required durable transaction success before SQS deletion
- added duplicate recovery and bounded conflict retries without duplicating the
  state or route domain logic
- added one focused SQS policy module and one setup entry point; no second queue
  consumer or local retry mechanism was added
- requested the AWS-owned receive count only to make rejection evidence visible
- kept failed messages available for inspection instead of adding an automatic
  failure-queue consumer or unsafe automatic redrive
- ignored local AWS certificate and key files so they cannot be added to source
  control while keeping the submitted proposal PDF available
- added one Dockerfile only after Fargate became the approved milestone and kept
  the build context limited to the worker's actual runtime dependencies
- created separate private route-worker and request-service ECR repositories with
  immutable tags, AES-256 encryption, and scan-on-push

Quality review results:

- every source file has a current, explainable responsibility
- no known unused imports, unresolved `TODO` or `FIXME` markers, commented-out
  implementation, or circular application dependency was found
- dependency direction remains applications to core to contracts; core and
  contracts do not import application code
- all installed workspace packages resolve without invalid or extraneous direct
  dependencies
- all 124 tests pass, including HTTP, periodic load, queue publishing,
  immutable-state lookup, retry-policy, duplicate, conflict, durable-store, and
  ordering failure tests
- ESLint and Prettier pass
- one real SQS message produced a validated successful route and was deleted only
  after successful processing
- the full 496,137-byte state was not forced into one DynamoDB item; its compact
  validated record is approximately 14 KB
- one on-demand table and one necessary state item were added, with no secondary
  index, unused attribute, or speculative result structure
- the live setup created, seeded, consistently read, reconstructed, and validated
  the initial AWS record
- one real transaction advanced state version 1 to 2 and stored the correlated
  route result before its SQS message was deleted
- two later legitimate batches advanced the current state to version 5, after
  which a replay of the version-2 batch was deleted as a duplicate without another
  state update or route calculation
- one controlled malformed message was rejected three times and then verified
  unchanged in the dedicated failure queue
- the two approved Dockerfiles contain only their required runtime workspaces; no
  CI/CD, deployment YAML, or Terraform configuration was introduced
- both local images run as UID 1000, load their required runtime modules, and
  contain no test files
- both pushed ECR digests exactly match their verified local image digests
- the route-worker image scan findings are recorded; the request-service OCI index
  scan limitation is also recorded rather than presented as a clean scan
- the ECS service has two running tasks, two healthy ALB targets, and a completed
  rollout
- automatic scaling from two to six route workers was observed during the periodic
  workload, and the normal two-to-ten target was restored after controlled testing
- five one-worker and five six-worker 20-request trials retained every failure;
  their SLA pass rates were zero and 80 percent respectively
- matching 50- and 100-request bursts recorded lower median and p95 latency with
  six workers, while preserving the remaining ALB 502 and over-five-second results
- no secret, certificate, private key, or temporary AWS credential was added to
  source control

The refreshed npm audit reports 14 transitive advisories: 11 high and 3 moderate,
with no critical advisory. Some are under Node-RED or its bundled npm dependency,
and the complete automatic resolution proposes a breaking Node-RED downgrade.
They remain an explicitly documented local-only limitation rather than an untested
dependency change. Node-RED continues to bind to `127.0.0.1` and the flow does not
use JSONata expressions.

The intentionally ignored Node-RED flow remains the main reproducibility
limitation. It must be demonstrated from this computer or exported separately if
the assessor requires an importable copy.

## 13. Phase 5 application verification

The application milestone was verified on 27 August 2026 using the complete local
workflow. The local broker, state engine, Node-RED, and simulator were started from
the documented npm commands. Node-RED served the application at `/app/` and the
read-only snapshot at `/api/dashboard-snapshot`.

The live snapshot contained:

- scenario `scenario-48291`
- a complete 100-row floorplan with 100 cells per row
- ten distinct occupants
- all 42 configured sensors and all 42 current readings
- one independently validated successful route for `occupant-01`
- one cardinal first-step guidance result

The simulator continued changing five readings every five seconds while the
snapshot state advanced. The map, sensor table, route summary, direction card, and
recorded experiment evidence use this single validated snapshot rather than
maintaining separate browser-side copies of the building state.

The occupant picker deliberately changes only the map highlight. It does not claim
to submit a new cloud route request; the displayed local route remains clearly
labelled as the current `occupant-01` result. This keeps the interface consistent
with the implemented backend boundary.

Automated verification finished with ESLint passed, Prettier passed, and 124 tests
passed with zero failures. HTTP responses, live snapshot contents, JavaScript
syntax, model tests, flow tests, and the complete project suite were verified. A
final manual browser walkthrough remains part of the assessment rehearsal.
