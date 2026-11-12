# Phase 1B.5 ablation observations

Observed on 2026-11-12 using engine 1b.4, standard policy efr.1 and ablation efr-no-expiry.1.

The shared policy factory selects one expiry mode. Disabled expiry applies to received and owned leases, in-flight and pending announcements, and release generation. Both variants retain finite timestamps, exact TTL arithmetic, sender-local provenance checks, stable priority, sequence watermarks, release identity, routing and transport budgets. Non-expiring claims still yield to applicable releases, supersession and local visitation. All-reserved fallback waits.

## Reproduction

Run `npm.cmd test -- tests/efr-no-expiry-regression.test.ts --silent=false --reporter=verbose`. The test prints every paired observation and asserts correctness, determinism and bounded storage. There is no required winner.

The sample was fixed before execution. Seeds 0–11 cover branching, loop-heavy and bottleneck-heavy graphs with 14 nodes and three entrance starts. TTL is 4 ticks. Graph-hop range is 3, delay is 2 ticks, loss is 0.35, maxBytes is 512, maxQueue is 12 and maxOutbound is 1. Robot 0 fails at tick 12. Every run executes 64 ticks.

These previously exercised seeds are exploratory correctness and smoke seeds. This sample establishes no held-out performance result. Parameters were retained after observing the outcomes.

## Measurements

Visited counts distinct nodes in the union of all robots' visited sets, including failed robots' prior visits. Moves counts moved events. Transmissions counts message-sent events, including packets later lost. Incomplete means fewer than 14 distinct nodes visited by tick 64. These are fixture observations.

First event difference compares the complete event arrays at each tick. A difference can be a message or lease-related event without a different movement. A dash means identical event bytes through tick 64. Algorithm version metadata is outside those arrays.

| Scenario | Seed | Visited EFR / no-expiry | Moves EFR / no-expiry | Transmissions EFR / no-expiry | Incomplete EFR / no-expiry | First event difference |
| --- | --- | --- | --- | --- | --- | --- |
| branching | 0 | 14 / 14 | 57 / 57 | 55 / 61 | false / false | 21 |
| branching | 1 | 14 / 14 | 61 / 62 | 57 / 60 | false / false | 22 |
| branching | 2 | 14 / 14 | 62 / 61 | 58 / 57 | false / false | 14 |
| branching | 3 | 14 / 14 | 53 / 53 | 57 / 57 | false / false | 19 |
| branching | 4 | 14 / 14 | 55 / 55 | 49 / 49 | false / false | 15 |
| branching | 5 | 14 / 14 | 57 / 57 | 52 / 51 | false / false | 16 |
| branching | 6 | 14 / 14 | 61 / 61 | 53 / 53 | false / false | 13 |
| branching | 7 | 14 / 14 | 57 / 57 | 57 / 57 | false / false | 10 |
| branching | 8 | 14 / 14 | 49 / 49 | 47 / 47 | false / false | 15 |
| branching | 9 | 14 / 14 | 59 / 59 | 57 / 59 | false / false | 15 |
| branching | 10 | 14 / 14 | 53 / 53 | 57 / 57 | false / false | 12 |
| branching | 11 | 14 / 14 | 55 / 55 | 59 / 57 | false / false | 22 |
| loop-heavy | 0 | 14 / 14 | 43 / 43 | 47 / 47 | false / false | — |
| loop-heavy | 1 | 14 / 14 | 41 / 41 | 45 / 45 | false / false | — |
| loop-heavy | 2 | 14 / 14 | 43 / 43 | 45 / 47 | false / false | 18 |
| loop-heavy | 3 | 14 / 14 | 41 / 41 | 45 / 45 | false / false | — |
| loop-heavy | 4 | 14 / 14 | 41 / 41 | 45 / 45 | false / false | — |
| loop-heavy | 5 | 14 / 14 | 43 / 43 | 47 / 47 | false / false | 15 |
| loop-heavy | 6 | 14 / 14 | 41 / 41 | 45 / 45 | false / false | — |
| loop-heavy | 7 | 14 / 14 | 39 / 39 | 43 / 43 | false / false | — |
| loop-heavy | 8 | 14 / 14 | 39 / 39 | 43 / 43 | false / false | — |
| loop-heavy | 9 | 14 / 14 | 41 / 41 | 45 / 45 | false / false | — |
| loop-heavy | 10 | 14 / 14 | 39 / 39 | 43 / 43 | false / false | — |
| loop-heavy | 11 | 14 / 14 | 43 / 43 | 45 / 47 | false / false | 18 |
| bottleneck-heavy | 0 | 14 / 14 | 51 / 42 | 49 / 40 | false / false | 12 |
| bottleneck-heavy | 1 | 14 / 14 | 45 / 45 | 45 / 42 | false / false | 11 |
| bottleneck-heavy | 2 | 14 / 14 | 41 / 41 | 45 / 45 | false / false | — |
| bottleneck-heavy | 3 | 14 / 14 | 51 / 51 | 51 / 53 | false / false | 11 |
| bottleneck-heavy | 4 | 14 / 14 | 51 / 44 | 47 / 39 | false / false | 13 |
| bottleneck-heavy | 5 | 14 / 14 | 53 / 50 | 46 / 44 | false / false | 14 |
| bottleneck-heavy | 6 | 14 / 14 | 47 / 47 | 47 / 47 | false / false | 8 |
| bottleneck-heavy | 7 | 14 / 14 | 45 / 44 | 45 / 42 | false / false | 11 |
| bottleneck-heavy | 8 | 14 / 14 | 53 / 53 | 57 / 55 | false / false | 9 |
| bottleneck-heavy | 9 | 14 / 14 | 43 / 43 | 47 / 47 | false / false | 9 |
| bottleneck-heavy | 10 | 14 / 14 | 47 / 40 | 47 / 37 | false / false | 12 |
| bottleneck-heavy | 11 | 14 / 14 | 53 / 55 | 47 / 47 | false / false | 16 |

Both variants visited all 14 nodes in all 36 pairs. 10 pairs had identical event logs. No-expiry used fewer moves in 6 pairs and more moves in 2 pairs. Repeated visits may support navigation. These totals establish no general performance advantage.

Packet-loss draws use seed, tick, sender, recipient and sequence. Identical opportunities receive identical draws. Expiry-related changes in traffic can create different opportunities and loss outcomes. Policy draws remain independent from transport randomness.

## Causal and compatibility evidence

The local planner fixture first chooses different targets at tick 5, the claim's exclusive expiry boundary. In the corridor failure fixture the owner fails at tick 7 after issuing a lease expiring at tick 10. The variants match through tick 9. Standard EFR moves at tick 10 and eventually visits the abandoned frontier. No-expiry waits through the fixture's tick-16 cap with the foreign claim retained. Neither variant receives global robot health.

Additional fixtures cover arrival before/at/after expiry, late pending sends, releases after nominal expiry, conflicting issuers, lost messages, visited targets, exhaustion, zero survivors, isolated local state and hidden-world canaries. Single steps, interleaved uneven batches and reordered JSON checkpoints match for all 72 smoke runs.

An independent in-memory comparison loaded the committed TypeScript at `1f1a422` via `git show`. Standard EFR, nearest frontier and random walk matched the revised implementation's states, serialized state, hashes and event bytes in 108 runs using the same sample configuration.

The existing serialized state layout, engine version and standard checksum fixtures are preserved. The algorithm version identifies the ablation, and step rejects continuation using the other variant. Replay checks cover trusted current-version snapshots.

Cross-browser replay, maximum-scale resource performance, held-out efficacy and event-derived mission metrics remain unverified.
