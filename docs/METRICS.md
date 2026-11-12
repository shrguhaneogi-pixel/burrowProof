# Event-derived metrics

The evaluator calls initialMetrics on the tick-zero state returned by initialize. That projection includes each robot's actual visited set and effective tick-zero failures. Failed-at-zero robots have empty visited sets under the engine contract. Initialization events are already represented by this projection and must be excluded from subsequent reduction.

Call reduceMetrics(previous, events, throughTick) with complete, ordered ticks exactly once. throughTick is the engine tick through which the history is complete, including silent ticks after all robots fail. It introduces no simulation clock. A zero-length batch uses the same boundary and an empty event array. Tick regressions and events from previously processed ticks are rejected. The reducer accepts trusted engine histories, rather than validating replay imports.

## Event audit

| Existing event | Metric meaning |
| --- | --- |
| tick-zero sensed | Represented by the initial evaluator projection |
| moved | One edge traversal and an arrival visit |
| sensed after movement | No additional visit or movement count |
| waited | No movement |
| rejected | One rejected movement |
| message-attempted | One validated, size-eligible transmission attempt |
| message-sent | One transmission after range/capacity checks, including subsequent loss |
| message-delivered | One delivery |
| message-dropped | One drop, including range, queue, loss and failed recipient |
| message-rejected | Its count field counts rejected requests, including outbound-limit excess |
| agent-failed | Insert robot ID into the distinct failed set |

The engine emits no tick-end or termination event. Callers supply complete tick boundaries and evaluate missionOutcome with their run budget. The engine continues to step after completion or failure. Metrics report the observed status without stopping it.

## Definitions and units

Coverage is the number of distinct visited nodes divided by reachableNodes. The evaluator takes the denominator from the connected world validated by graph construction. Sensing neighbors alone contributes no visitation. An active entrance start contributes one visit per agent and one unique global visit. Shared starts contribute no revisits.

Each moved event is one successful traversal. A global revisit is an arrival whose destination was previously visited by any robot. An agent revisit is an arrival previously visited by that robot. Canonical agent ordering resolves simultaneous arrivals, so two robots first entering one node produce one new global visit and one global revisit. Revisit counts describe navigation and do not assign waste.

All times use integer global simulation ticks. progress stores tick zero and only ticks where unique visitation increases, with one final count per such tick. There are at most reachableNodes + 1 points. Coverage between points is constant. The current tick supplies the final endpoint. This lossless representation includes no interpolation.

threshold defaults to 0.9 and accepts (0, 1]. thresholdTick is the first tick with at least ceil(threshold * reachableNodes) distinct visits. completionTick is the first tick reaching every node. Unreached times are null.

communication.generated is null. The existing invalid-requests rejection can represent an opaque malformed request container, so a general count of generated messages cannot be reconstructed. attempted, transmitted, delivered, rejected and dropped count their respective lifecycle stages independently. Drops may refer to a prior batch's in-flight transmission.

transmittedBytes sums only the bytes field of message-sent. That field comes from the existing canonical ASCII envelope encoding, including headers and payload. Attempt, delivery and drop events never add transmitted bytes again.

failed contains distinct IDs that transitioned, including failures from the initial projection. Repeated failure records cannot inflate this count. Internal visited sets are stored as sorted JSON arrays, bounded by world size and roster size. Counters reject negative or unsafe increments. Threshold and count fields use ordinary JSON values.

missionOutcome returns complete when full visitation has occurred, otherwise no-active-agents when all robots failed, otherwise tick-cap if the supplied budget is reached, otherwise running. This priority treats previously completed exploration as complete even if all robots later fail. A zero-tick run can be complete, no-active-agents or tick-cap. The engine currently has no additional stopping conditions.

## Ownership and replay

The reducer imports only engine types and uses no browser APIs or policy identifiers. It copies its working collections and never modifies the engine or previous metrics state. Future live telemetry and experiment callers should use this same path.

Store the tick-zero projection and full ordered events together with their complete tick boundary to reconstruct metrics. A mid-mission simulation snapshot alone cannot recover traversal or byte history. Resume incremental metrics from its JSON snapshot together with the corresponding engine snapshot. Engine state serialization, policy behavior and versioned checksum fixtures are unaffected.

Verification runs use npm.cmd test -- tests/metrics.test.ts. Independent fixture expectations cover shared initialization, visitation, revisits, thresholds, failures, transport accounting and outcomes. The four-policy regression uses seeds 0–7 across three graph families, 12 nodes, three agents and 24 ticks with loss, delays and scheduled failures. No efficacy claim follows from these correctness runs.
