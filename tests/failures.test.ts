import { expect, it } from "vitest";
import {
  initialize,
  step,
  runTicks,
  type Failure,
  type Policy,
} from "../src/sim/engine";
import { randomWalkPolicy } from "../src/sim/policies";
import { serializeState, stateHash } from "../src/sim/state-hash";

const communication = {
  range: 4,
  delay: 2,
  loss: 0,
  maxBytes: 256,
  maxQueue: 4,
  maxOutbound: 1,
};
const config = {
  seed: 3,
  scenario: "branching" as const,
  nodeCount: 5,
  agentCount: 2,
  communication,
};
const talk: Policy = {
  version: "failure-talk.1",
  decide(view, draw) {
    return {
      ...randomWalkPolicy.decide(view, draw),
      outbound: [
        {
          to: 1 - view.id,
          seq: view.tick!,
          payload: {
            kind: "observation",
            node: view.position,
            neighbors: view.adjacency[view.position]!,
          },
        },
      ],
    };
  },
};

it.each([0, 1, 10])(
  "failure at tick %i precedes planning, sensing and transmission",
  (failureTick) => {
    const calls: number[][] = [];
    const policy: Policy = {
      version: talk.version,
      decide(view, draw) {
        calls.push([view.id, view.tick!]);
        return talk.decide(view, draw);
      },
    };
    const start = initialize(
      { ...config, failures: [{ tick: failureTick, agentId: 0 }] },
      policy,
    );
    const before =
      failureTick === 0
        ? start.state
        : runTicks(start.state, failureTick - 1, policy).state;
    const original = before.agents[0]!;
    const snapshot = serializeState(before);
    const result =
      failureTick === 0
        ? runTicks(before, 4, policy)
        : runTicks(before, 5, policy);
    expect(serializeState(before)).toBe(snapshot);
    const failed = result.state.agents[0]!;
    expect(failed.lifecycle).toEqual({ status: "failed", tick: failureTick });
    expect(failed.position).toBe(original.position);
    expect(failed.knowledge).toEqual(original.knowledge);
    expect(failed.policyRng).toBe(original.policyRng);
    expect(
      calls.filter(([id, tick]) => id === 0 && tick! >= failureTick),
    ).toEqual([]);
    const forbidden = new Set([
      "moved",
      "waited",
      "sensed",
      "rejected",
      "message-attempted",
      "message-sent",
    ]);
    expect(
      result.events.filter((e) => e.agentId === 0 && forbidden.has(e.kind)),
    ).toEqual([]);
    expect(
      result.events.some((e) => e.agentId === 1 && e.kind === "moved"),
    ).toBe(true);
    const failures = [...start.events, ...result.events].filter(
      (e) => e.kind === "agent-failed",
    );
    expect(failures).toEqual([
      { kind: "agent-failed", tick: failureTick, agentId: 0 },
    ]);
    if (failureTick === 0)
      expect(original.knowledge).toEqual({ visited: [], adjacency: {} });
  },
);

it("normalizes schedule order and repeated requests to one earliest failure", () => {
  const schedule: Failure[] = [
    { tick: 3, agentId: 0 },
    { tick: 1, agentId: 1 },
    { tick: 2, agentId: 0 },
    { tick: 2, agentId: 0 },
  ];
  const initial = initialize({ ...config, failures: schedule });
  const canonical = initialize({
    ...config,
    failures: [
      { tick: 1, agentId: 1 },
      { tick: 2, agentId: 0 },
    ],
  });
  expect(serializeState(initial.state)).toBe(serializeState(canonical.state));
  expect(stateHash(initial.state)).toBe(stateHash(canonical.state));
  schedule[0] = { tick: 0, agentId: 0 };
  expect(initial.state.config.failures).toEqual([
    { tick: 1, agentId: 1 },
    { tick: 2, agentId: 0 },
  ]);
  expect(
    runTicks(initial.state, 6).events.filter((e) => e.kind === "agent-failed"),
  ).toEqual([
    { kind: "agent-failed", tick: 1, agentId: 1 },
    { kind: "agent-failed", tick: 2, agentId: 0 },
  ]);
});

it.each([
  { tick: -1, agentId: 0 },
  { tick: 0.5, agentId: 0 },
  { tick: NaN, agentId: 0 },
  { tick: Infinity, agentId: 0 },
  { tick: Number.MAX_SAFE_INTEGER + 1, agentId: 0 },
  { tick: 1, agentId: -1 },
  { tick: 1, agentId: 2 },
  { tick: 1, agentId: 0.5 },
])("rejects invalid failure %j", (failure) => {
  expect(() => initialize({ ...config, failures: [failure] })).toThrow(
    RangeError,
  );
});

it.each([0, 2])(
  "orders simultaneous failures at tick %i and advances with zero survivors",
  (tick) => {
    const start = initialize(
      {
        ...config,
        failures: [
          { tick, agentId: 1 },
          { tick, agentId: 0 },
        ],
      },
      talk,
    );
    const result = runTicks(start.state, 7, talk);
    const events = [...start.events, ...result.events];
    expect(events.filter((e) => e.kind === "agent-failed")).toEqual([
      { kind: "agent-failed", tick, agentId: 0 },
      { kind: "agent-failed", tick, agentId: 1 },
    ]);
    expect(result.state.tick).toBe(7);
    expect(result.state.transport!.queue).toEqual([]);
    expect(result.state.transport!.inboxes).toEqual([[], []]);
    expect(
      events.filter((e) => e.kind === "message-delivered" && e.tick >= tick),
    ).toEqual([]);
  },
);

it("keeps accepted packets in flight after the sender fails", () => {
  const start = initialize(
    { ...config, failures: [{ tick: 2, agentId: 0 }] },
    talk,
  );
  const result = runTicks(start.state, 3, talk);
  const delivery = result.events.find(
    (e) => e.kind === "message-delivered" && e.agentId === 1,
  );
  expect(delivery).toMatchObject({
    tick: 3,
    message: { from: 0, to: 1, sentTick: 1, dueTick: 3 },
  });
  expect(
    result.events
      .filter((e) => e.kind === "message-sent" && e.agentId === 0)
      .map((e) => e.tick),
  ).toEqual([1]);
});

it.each([2, 3])(
  "drops due packets when the recipient failed at tick %i",
  (tick) => {
    const start = initialize(
      { ...config, failures: [{ tick, agentId: 1 }] },
      talk,
    );
    const first = step(start.state, talk);
    const second = step(first.state, talk);
    expect(
      second.state.transport!.queue.some(
        (message) => message.to === 1 && message.sentTick === 1,
      ),
    ).toBe(true);
    const third = step(second.state, talk);
    expect(third.events).toContainEqual(
      expect.objectContaining({
        kind: "message-dropped",
        tick: 3,
        agentId: 0,
        reason: "recipient-failed",
        message: expect.objectContaining({ to: 1, sentTick: 1 }),
      }),
    );
    expect(third.state.transport!.inboxes[1]).toEqual([]);
    expect(
      third.events.some(
        (e) => e.kind === "message-delivered" && e.agentId === 1,
      ),
    ).toBe(false);
    if (tick === 3)
      expect(third.events[0]).toEqual({
        kind: "agent-failed",
        tick: 3,
        agentId: 1,
      });
  },
);

it("reclaims dropped packets before scheduling and preserves full recipient indexing", () => {
  const start = initialize(
    {
      ...config,
      communication: { ...communication, delay: 1, maxQueue: 1 },
      failures: [{ tick: 2, agentId: 0 }],
    },
    talk,
  );
  // First packet is from agent 0. Agent 1's initial attempt encounters the full queue.
  const first = step(start.state, talk);
  const second = step(first.state, talk);
  expect(second.state.transport!.queue).toHaveLength(1);
  expect(second.state.transport!.queue[0]).toMatchObject({
    from: 1,
    to: 0,
    sentTick: 2,
  });
  const third = step(second.state, talk);
  expect(third.events).toContainEqual(
    expect.objectContaining({
      kind: "message-dropped",
      reason: "recipient-failed",
    }),
  );
  expect(third.state.transport!.queue).toHaveLength(1);
  expect(third.state.transport!.queue[0]).toMatchObject({
    from: 1,
    to: 0,
    sentTick: 3,
  });
});
