import { expect, it } from "vitest";
import {
  initialMetrics,
  reduceMetrics,
  missionOutcome,
} from "../src/sim/metrics";
import {
  initialize,
  step,
  runTicks,
  type SimEvent,
  type Policy,
} from "../src/sim/engine";
import { createWorld } from "../src/sim/graph";
import { randomWalkPolicy, nearestFrontierPolicy } from "../src/sim/policies";
import { efrPolicy, efrNoExpiryPolicy } from "../src/sim/efr";
import { messageBytes, type Message } from "../src/sim/comms";

const config = {
  seed: 3,
  scenario: "branching" as const,
  nodeCount: 3,
  agentCount: 2,
};

it.each([
  ["queue", 512, false, 0, 2, 1, 2, 2],
  ["size", 1, false, 0, 0, 0, 4, 0],
  ["duplicate", 512, true, 0, 1, 1, 3, 1],
  ["loss", 512, false, 1, 2, 2, 2, 2],
] as const)(
  "counts real %s transport outcomes",
  (_, maxBytes, duplicate, loss, attempted, transmitted, rejected, dropped) => {
    const policy: Policy = {
      version: "metrics-transport",
      decide(view) {
        return {
          kind: "wait",
          outbound:
            view.id === 0 && view.tick === 1
              ? [0, 1, 2, 3].map((seq) => ({
                  to: 1,
                  seq: duplicate ? 0 : seq,
                  payload: {
                    kind: "observation" as const,
                    node: 0,
                    neighbors: view.adjacency[0]!,
                  },
                }))
              : [],
        };
      },
    };
    const start = initialize(
      {
        ...config,
        communication: {
          range: 3,
          delay: 2,
          loss,
          maxBytes,
          maxQueue: 1,
          maxOutbound: 2,
        },
        failures: [{ agentId: 1, tick: 3 }],
      },
      policy,
    ).state;
    const result = runTicks(start, 4, policy);
    const metrics = reduceMetrics(initialMetrics(start), result.events, 4);
    expect(metrics.communication).toMatchObject({
      attempted,
      transmitted,
      rejected,
      dropped,
      delivered: 0,
    });
    expect(metrics.failed).toEqual([1]);
    expect(metrics.communication.transmittedBytes).toBe(
      transmitted *
        messageBytes({
          from: 0,
          to: 1,
          seq: 0,
          sentTick: 1,
          dueTick: 3,
          payload: {
            kind: "observation",
            node: 0,
            neighbors: start.agents[0]!.knowledge.adjacency[0]!,
          },
        }),
    );
  },
);
it("counts initial visits once and keeps discoveries out of coverage", () => {
  const start = initialize(config).state;
  const m = initialMetrics(start);
  expect(m.visited).toEqual([0]);
  expect(m.agentVisited).toEqual([[0], [0]]);
  expect(m.progress).toEqual([{ tick: 0, visited: 1 }]);
  expect(m.thresholdTick).toBeNull();
  expect(missionOutcome(m, 0)).toBe("tick-cap");
  expect(missionOutcome(m, 1)).toBe("running");
  const single = initialMetrics(initialize({ ...config, nodeCount: 1 }).state);
  expect(single.completionTick).toBe(0);
  expect(missionOutcome(single, 0)).toBe("complete");
  const failed = initialMetrics(
    initialize({
      ...config,
      failures: [
        { agentId: 0, tick: 0 },
        { agentId: 1, tick: 0 },
      ],
    }).state,
  );
  expect(failed.visited).toEqual([]);
  expect(failed.failed).toEqual([0, 1]);
  expect(missionOutcome(reduceMetrics(failed, [], 8), 8)).toBe(
    "no-active-agents",
  );
});

it("hand-counts simultaneous arrivals, backtracking, rejections and distinct failures", () => {
  const initial = initialMetrics(initialize(config).state, 2 / 3);
  const events: SimEvent[] = [
    { kind: "moved", tick: 1, agentId: 0, from: 0, to: 1 },
    { kind: "moved", tick: 1, agentId: 1, from: 0, to: 1 },
    { kind: "sensed", tick: 1, agentId: 0, at: 1, neighbors: [0, 2] },
    { kind: "moved", tick: 2, agentId: 0, from: 1, to: 0 },
    {
      kind: "rejected",
      tick: 2,
      agentId: 1,
      at: 1,
      to: 99,
      reason: "unknown-edge",
    },
    { kind: "agent-failed", tick: 3, agentId: 0 },
    { kind: "agent-failed", tick: 3, agentId: 0 },
    { kind: "moved", tick: 3, agentId: 1, from: 1, to: 2 },
  ];
  const bytes = JSON.stringify(initial);
  const result = reduceMetrics(initial, events, 3);
  expect(JSON.stringify(initial)).toBe(bytes);
  expect(result.movement).toEqual({
    traversals: 4,
    globalRevisits: 2,
    agentRevisits: 1,
    rejected: 1,
  });
  expect(result.progress).toEqual([
    { tick: 0, visited: 1 },
    { tick: 1, visited: 2 },
    { tick: 3, visited: 3 },
  ]);
  expect(result.thresholdTick).toBe(1);
  expect(result.completionTick).toBe(3);
  expect(result.failed).toEqual([0]);
  expect(missionOutcome(result, 3)).toBe("complete");
  expect(
    reduceMetrics(
      reduceMetrics(initial, events.slice(0, 3), 1),
      events.slice(3),
      3,
    ),
  ).toEqual(result);
  expect(() => reduceMetrics(result, events, 3)).toThrow();
});

it("accounts for transport stages without charging delivery or drop bytes again", () => {
  const message: Message = {
    from: 0,
    to: 1,
    seq: 0,
    sentTick: 1,
    dueTick: 2,
    payload: { kind: "observation", node: 0, neighbors: [1] },
  };
  const bytes = messageBytes(message);
  const events: SimEvent[] = [
    { kind: "message-attempted", tick: 1, agentId: 0, message, bytes },
    { kind: "message-sent", tick: 1, agentId: 0, message, bytes },
    { kind: "message-delivered", tick: 2, agentId: 1, message, bytes },
    {
      kind: "message-dropped",
      tick: 2,
      agentId: 0,
      message: { ...message, seq: 1 },
      bytes,
      reason: "queue-full",
    },
    {
      kind: "message-dropped",
      tick: 2,
      agentId: 0,
      message: { ...message, seq: 2 },
      bytes,
      reason: "recipient-failed",
    },
    {
      kind: "message-rejected",
      tick: 2,
      agentId: 0,
      seq: 3,
      reason: "size-limit",
      count: 1,
    },
    {
      kind: "message-rejected",
      tick: 2,
      agentId: 0,
      seq: 3,
      reason: "duplicate-sequence",
      count: 1,
    },
    {
      kind: "message-rejected",
      tick: 2,
      agentId: 0,
      seq: null,
      reason: "outbound-limit",
      count: 4,
    },
  ];
  const result = reduceMetrics(
    initialMetrics(initialize(config).state),
    events,
    2,
  );
  expect(result.communication).toEqual({
    generated: null,
    attempted: 1,
    transmitted: 1,
    delivered: 1,
    dropped: 2,
    rejected: 6,
    transmittedBytes: bytes,
  });
  expect(() =>
    reduceMetrics(
      result,
      [{ ...events[0]!, tick: 3, kind: "message-sent", bytes: -1, message }],
      3,
    ),
  ).toThrow();
});

it.each([
  randomWalkPolicy,
  nearestFrontierPolicy,
  efrPolicy,
  efrNoExpiryPolicy,
])(
  "reconstructs independent evaluator counts across policies and batches for $version",
  (policy) => {
    for (const scenario of [
      "branching",
      "loop-heavy",
      "bottleneck-heavy",
    ] as const)
      for (let seed = 0; seed < 8; seed++) {
        const cfg = {
          ...config,
          scenario,
          seed,
          nodeCount: 12,
          agentCount: 3,
          failures: [
            { agentId: 0, tick: 6 },
            { agentId: 2, tick: 10 },
          ],
          communication: {
            range: 3,
            delay: 2,
            loss: 0.35,
            maxBytes: 512,
            maxQueue: 8,
            maxOutbound: 1,
          },
        };
        const initial = initialize(cfg, policy).state;
        const before = JSON.stringify(initial);
        const full = runTicks(initial, 24, policy);
        const expected = reduceMetrics(
          initialMetrics(initial),
          full.events,
          24,
        );
        let state = initial,
          metrics = initialMetrics(initial);
        for (const n of [1, 0, 3, 7, 13]) {
          const next = runTicks(state, n, policy);
          metrics = reduceMetrics(metrics, next.events, next.state.tick);
          state = JSON.parse(JSON.stringify(next.state), (_, v) =>
            v && typeof v === "object" && !Array.isArray(v)
              ? Object.fromEntries(Object.entries(v).reverse())
              : v,
          );
        }
        expect(metrics).toEqual(expected);
        expect(JSON.stringify(initial)).toBe(before);
        expect(expected.visited).toEqual(
          [
            ...new Set(full.state.agents.flatMap((a) => a.knowledge.visited)),
          ].sort((a, b) => a - b),
        );
        expect(expected.movement.traversals).toBe(
          full.events.filter((e) => e.kind === "moved").length,
        );
        expect(expected.failed).toEqual([0, 2]);
        expect(expected.communication.transmittedBytes).toBe(
          full.events.reduce(
            (sum, e) => sum + (e.kind === "message-sent" ? e.bytes : 0),
            0,
          ),
        );
        expect(expected.visited.length).toBeLessThanOrEqual(12);
      }
  },
);

it("measures an actual invalid move and stationary failed agents without altering the engine", () => {
  const policy: Policy = {
    version: "metric-fixture",
    decide: () => ({ kind: "move", to: 99 }),
  };
  const initial = initialize(
    { ...config, failures: [{ agentId: 0, tick: 1 }] },
    policy,
    createWorld([[1], [0, 2], [1]]),
  ).state;
  const result = step(initial, policy);
  const m = reduceMetrics(initialMetrics(initial), result.events, 1);
  expect(m.movement).toEqual({
    traversals: 0,
    globalRevisits: 0,
    agentRevisits: 0,
    rejected: 1,
  });
  expect(m.visited).toEqual([0]);
});
