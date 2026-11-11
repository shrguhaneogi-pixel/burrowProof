import { expect, it } from "vitest";
import { encodeMessage, messageBytes, type Message } from "../src/sim/comms";
import { initialize, step, runTicks, type Policy } from "../src/sim/engine";
import { createWorld, type Scenario } from "../src/sim/graph";
import type { AgentView } from "../src/sim/agent";
import { randomWalkPolicy, nearestFrontierPolicy } from "../src/sim/policies";
import { serializeState, stateHash } from "../src/sim/state-hash";
import type { MessageRequest } from "../src/sim/comms";

const settings = {
  range: 1,
  delay: 1,
  loss: 0,
  maxBytes: 256,
  maxQueue: 4,
  maxOutbound: 2,
};
const config = {
  seed: 2,
  scenario: "branching" as const,
  nodeCount: 3,
  agentCount: 2,
  communication: settings,
};
const sender: Policy = {
  version: "transport-test.1",
  decide(view) {
    return {
      kind: "wait",
      outbound:
        view.id === 0 && view.tick === 1
          ? [
              {
                to: 1,
                seq: 0,
                payload: {
                  kind: "observation",
                  node: view.position,
                  neighbors: view.adjacency[view.position]!,
                },
              },
            ]
          : [],
    };
  },
};

it("delivers only in a subsequent tick and bounds inbox lifetime", () => {
  const initial = initialize(config, sender).state;
  const sent = step(initial, sender);
  expect(
    sent.events.filter((e) => e.kind === "message-delivered"),
  ).toHaveLength(0);
  expect(sent.state.transport!.queue).toHaveLength(1);
  const received = step(sent.state, sender);
  expect(
    received.events.filter((e) => e.kind === "message-delivered"),
  ).toHaveLength(1);
  expect(received.state.transport!.inboxes[1]).toHaveLength(1);
  expect(received.state.agents[1]!.knowledge).toEqual(
    initial.agents[1]!.knowledge,
  );
  expect(step(received.state, sender).state.transport!.inboxes[1]).toEqual([]);
});

it("drops all transmissions at loss one and reproduces the queued state", () => {
  const start = initialize(
    { ...config, communication: { ...settings, loss: 1 } },
    sender,
  ).state;
  const result = runTicks(start, 3, sender);
  expect(
    result.events.filter((e) => e.kind === "message-delivered"),
  ).toHaveLength(0);
  expect(
    result.events.filter((e) => e.kind === "message-dropped"),
  ).toHaveLength(1);
  expect(result.state.transport!.queue).toEqual([]);
  expect(runTicks(start, 3, sender)).toEqual(result);
});

it("counts the complete canonical envelope as ASCII bytes", () => {
  const message: Message = {
    from: 0,
    to: 1,
    seq: 0,
    sentTick: 1,
    dueTick: 3,
    payload: { kind: "observation", node: 0, neighbors: [1, 2] },
  };
  const expected = '[0,1,0,1,3,"observation",0,[1,2]]';
  expect(encodeMessage(message)).toBe(expected);
  expect(messageBytes(message)).toBe(Buffer.byteLength(expected, "utf8"));
});

it("enforces the byte boundary including headers", () => {
  const message = step(initialize(config, sender).state, sender).state
    .transport!.queue[0]!;
  const bytes = messageBytes(message);
  const accepted = step(
    initialize(
      { ...config, communication: { ...settings, maxBytes: bytes } },
      sender,
    ).state,
    sender,
  );
  const rejected = step(
    initialize(
      { ...config, communication: { ...settings, maxBytes: bytes - 1 } },
      sender,
    ).state,
    sender,
  );
  expect(accepted.state.transport!.queue).toHaveLength(1);
  expect(rejected.state.transport!.queue).toHaveLength(0);
  expect(rejected.events).toContainEqual(
    expect.objectContaining({ kind: "message-rejected", reason: "size-limit" }),
  );
});

function request(view: AgentView, to: number, seq: number): MessageRequest {
  return {
    to,
    seq,
    payload: {
      kind: "observation",
      node: view.position,
      neighbors: view.adjacency[view.position]!,
    },
  };
}

it.each([0, 1, 2])("bounds pending queue at capacity %i", (maxQueue) => {
  const policy: Policy = {
    version: "queue-test.1",
    decide: (view) => ({
      kind: "wait",
      outbound: view.id === 0 ? [request(view, 1, 0), request(view, 2, 1)] : [],
    }),
  };
  const result = step(
    initialize(
      { ...config, agentCount: 3, communication: { ...settings, maxQueue } },
      policy,
    ).state,
    policy,
  );
  expect(result.state.transport!.queue).toHaveLength(maxQueue);
  expect(
    result.events.filter(
      (e) => e.kind === "message-dropped" && e.reason === "queue-full",
    ),
  ).toHaveLength(2 - maxQueue);
});

it("rejects duplicates, invalid recipients, unauthorized facts and excess outbound work", () => {
  const bad = (view: AgentView): MessageRequest[] => [
    request(view, 1, 0),
    request(view, 1, 0),
    request(view, 99, 1),
    request(view, 0, 2),
    {
      to: 1,
      seq: 3,
      payload: { kind: "observation", node: 2, neighbors: [0] },
    },
    {
      ...request(view, 1, 4),
      payload: { ...request(view, 1, 4).payload, hidden: 88 },
    } as MessageRequest,
    request(view, 1, -1),
    request(view, 1, 5),
  ];
  const policy: Policy = {
    version: "invalid-test.1",
    decide: (view) => ({
      kind: "wait",
      outbound: view.id === 0 ? bad(view) : [],
    }),
  };
  const initial = initialize(
    { ...config, communication: { ...settings, maxOutbound: 7 } },
    policy,
  ).state;
  const first = step(initial, policy);
  expect(first.state.transport!.queue).toHaveLength(1);
  expect(
    first.events
      .filter((e) => e.kind === "message-rejected")
      .map((e) => e.reason),
  ).toEqual([
    "duplicate-sequence",
    "invalid-recipient",
    "invalid-recipient",
    "unauthorized-payload",
    "unauthorized-payload",
    "invalid-sequence",
    "outbound-limit",
  ]);
  expect(first.events).toContainEqual(
    expect.objectContaining({ reason: "outbound-limit", count: 1 }),
  );
  expect(step(first.state, policy).events).toContainEqual(
    expect.objectContaining({ reason: "duplicate-sequence", seq: 0 }),
  );
});

it.each([0, 1])(
  "checks post-move send range at the %i-hop boundary",
  (range) => {
    const policy: Policy = {
      version: "range-test.1",
      decide(view) {
        return view.id === 0
          ? { kind: "wait", outbound: [request(view, 1, view.tick!)] }
          : { kind: "move", to: 1 };
      },
    };
    const world = createWorld([[1], [0, 2], [1]]);
    const result = step(
      initialize(
        { ...config, communication: { ...settings, range } },
        policy,
        world,
      ).state,
      policy,
    );
    expect(result.state.transport!.queue).toHaveLength(range);
    if (range === 0)
      expect(result.events).toContainEqual(
        expect.objectContaining({ kind: "message-dropped", reason: "range" }),
      );
  },
);

it("delays delivery exactly and keeps send eligibility after endpoints move out of range", () => {
  const policy: Policy = {
    version: "delay-test.1",
    decide(view) {
      if (view.id === 0)
        return {
          kind: "wait",
          outbound: view.tick === 1 ? [request(view, 1, 0)] : [],
        };
      return view.position < 3
        ? { kind: "move", to: view.position + 1 }
        : { kind: "wait" };
    },
  };
  const world = createWorld([[1], [0, 2], [1, 3], [2]]);
  const initial = initialize(
    { ...config, nodeCount: 4, communication: { ...settings, delay: 3 } },
    policy,
    world,
  ).state;
  const result = runTicks(initial, 4, policy);
  expect(
    result.events
      .filter((e) => e.kind === "message-delivered")
      .map((e) => e.tick),
  ).toEqual([4]);
  expect(result.state.agents[1]!.position).toBe(3);
});

it("orders simultaneous senders stably and exposes deliveries before any decisions", () => {
  const seen: number[][] = [];
  const policy: Policy = {
    version: "order-test.1",
    decide(view) {
      seen.push([view.tick!, view.id, view.inbox!.length]);
      return {
        kind: "wait",
        outbound: view.tick === 1 ? [request(view, (view.id + 1) % 3, 0)] : [],
      };
    },
  };
  const state = initialize({ ...config, agentCount: 3 }, policy).state;
  const first = step({ ...state, agents: [...state.agents].reverse() }, policy);
  expect(
    first.events.filter((e) => e.kind === "message-sent").map((e) => e.agentId),
  ).toEqual([0, 1, 2]);
  const second = step(first.state, policy);
  expect(second.events.slice(0, 3).map((e) => e.kind)).toEqual(
    Array(3).fill("message-delivered"),
  );
  expect(seen).toEqual([
    [1, 0, 0],
    [1, 1, 0],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 1],
    [2, 2, 1],
  ]);
});

it("detaches and freezes inboxes and validates payloads against pre-move sensing", () => {
  const seen: AgentView[] = [];
  const policy: Policy = {
    version: sender.version,
    decide(view, draw) {
      seen.push(view);
      return sender.decide(view, draw);
    },
  };
  const first = step(initialize(config, policy).state, policy);
  const before = serializeState(first.state);
  const second = step(first.state, policy);
  const view = seen.find((v) => v.id === 1 && v.tick === 2)!;
  const delivered = second.state.transport!.inboxes[1]![0]!;
  expect(view.inbox![0]).not.toBe(delivered);
  expect(view.inbox![0]!.payload.neighbors).not.toBe(
    delivered.payload.neighbors,
  );
  expect(() =>
    Object.assign(view.inbox![0]!.payload.neighbors, { 0: 99 }),
  ).toThrow();
  expect(serializeState(first.state)).toBe(before);
  expect(Object.keys(view).sort()).toEqual([
    "adjacency",
    "id",
    "inbox",
    "position",
    "tick",
    "visited",
  ]);
  const guessed: Policy = {
    version: "guess-test.1",
    decide: (view) => ({
      kind: "move",
      to: 1,
      outbound:
        view.id === 0
          ? [
              {
                to: 1,
                seq: 0,
                payload: { kind: "observation", node: 1, neighbors: [0, 2] },
              },
            ]
          : [],
    }),
  };
  const world = createWorld([[1], [0, 2], [1]]);
  expect(
    step(initialize(config, guessed, world).state, guessed).events,
  ).toContainEqual(expect.objectContaining({ reason: "unauthorized-payload" }));
});

it.each([
  { delay: 0 },
  { delay: 10001 },
  { range: -1 },
  { range: 1.5 },
  { loss: NaN },
  { loss: -1 },
  { loss: 1.1 },
  { maxQueue: -1 },
  { maxQueue: 4097 },
  { maxBytes: 0 },
  { maxBytes: 65537 },
  { maxOutbound: 0 },
  { maxOutbound: 17 },
])("rejects invalid transport configuration %j", (patch) => {
  expect(() =>
    initialize({ ...config, communication: { ...settings, ...patch } }, sender),
  ).toThrow(RangeError);
});

const scenarios: Scenario[] = ["branching", "loop-heavy", "bottleneck-heavy"];
it.each(
  scenarios.flatMap((scenario) =>
    Array.from({ length: 12 }, (_, seed) => ({ scenario, seed })),
  ),
)(
  "reproduces communication events, hashes and batches for $scenario seed=$seed",
  ({ scenario, seed }) => {
    const talk: Policy = {
      version: "talk-test.1",
      decide(view, draw) {
        return {
          ...randomWalkPolicy.decide(view, draw),
          outbound: [request(view, (view.id + 1) % 3, view.tick!)],
        };
      },
    };
    const cfg = {
      ...config,
      seed,
      scenario,
      agentCount: 3,
      nodeCount: 8,
      communication: {
        ...settings,
        delay: 2,
        loss: 0.4,
        maxQueue: 8,
        range: 3,
      },
    };
    const initial = initialize(cfg, talk).state;
    const original = serializeState(initial);
    const batch = runTicks(initial, 12, talk);
    let singles = initialize(cfg, talk).state;
    const singleEvents = [];
    for (let tick = 0; tick < 12; tick++) {
      const result = step(singles, talk);
      singleEvents.push(...result.events);
      singles = result.state;
    }
    expect(JSON.stringify(singleEvents)).toBe(JSON.stringify(batch.events));
    expect(serializeState(singles)).toBe(serializeState(batch.state));
    let state = initialize(cfg, talk).state;
    const events = [];
    for (const size of [1, 0, 3, 8]) {
      const result = runTicks(state, size, talk);
      events.push(...result.events);
      state = result.state;
    }
    expect(JSON.stringify(events)).toBe(JSON.stringify(batch.events));
    expect(serializeState(state)).toBe(serializeState(batch.state));
    expect(stateHash(state)).toBe(stateHash(batch.state));
    expect(serializeState(initial)).toBe(original);
    const sends = batch.events.filter((e) => e.kind === "message-sent");
    for (const delivered of batch.events) {
      if (delivered.kind !== "message-delivered") continue;
      expect(sends).toContainEqual(
        expect.objectContaining({ message: delivered.message }),
      );
      expect(delivered.tick).toBe(delivered.message.dueTick);
    }
  },
);

it.each([randomWalkPolicy, nearestFrontierPolicy])(
  "preserves $version movement with idle transport",
  (policy) => {
    const plain = initialize(
      { seed: 9, scenario: "bottleneck-heavy", nodeCount: 12, agentCount: 3 },
      policy,
    ).state;
    const enabled = initialize(
      { ...plain.config, communication: settings },
      policy,
    ).state;
    expect(runTicks(enabled, 64, policy).state.agents).toEqual(
      runTicks(plain, 64, policy).state.agents,
    );
  },
);

it("keys loss by message identity independently of other senders", () => {
  const talk = (extra: boolean): Policy => ({
    version: "loss-test.1",
    decide(view) {
      return {
        kind: "wait",
        outbound:
          view.id === 1 || extra
            ? [request(view, (view.id + 1) % 3, view.tick!)]
            : [],
      };
    },
  });
  const traces = [false, true].map((extra) => {
    const policy = talk(extra);
    const cfg = {
      ...config,
      agentCount: 3,
      communication: { ...settings, maxQueue: 100, loss: 0.5 },
    };
    return runTicks(initialize(cfg, policy).state, 20, policy).events.filter(
      (e) =>
        e.agentId === 1 &&
        (e.kind === "message-sent" || e.kind === "message-dropped"),
    );
  });
  expect(traces[0]).toEqual(traces[1]);
  expect(traces[0]!.some((e) => e.kind === "message-dropped")).toBe(true);
  expect(traces[0]!.some((e) => e.kind === "message-sent")).toBe(true);
});

it("serializes all authoritative transport state and resumes a JSON snapshot", () => {
  const state = step(initialize(config, sender).state, sender).state;
  const copy = JSON.parse(JSON.stringify(state)) as typeof state;
  expect(step(copy, sender)).toEqual(step(state, sender));
  const transport = state.transport!;
  for (const changed of [
    { ...transport, queue: [] },
    { ...transport, lastSeq: [-1, -1] },
    { ...transport, inboxes: [[], transport.queue] },
  ])
    expect(stateHash({ ...state, transport: changed })).not.toBe(
      stateHash(state),
    );
  expect(
    stateHash({
      ...state,
      config: { ...state.config, communication: { ...settings, loss: 1 } },
    }),
  ).not.toBe(stateHash(state));
});

it("keeps matching delivered observations and decisions identical across changed hidden topology", () => {
  const worlds = [
    createWorld([[1], [0, 2], [1, 3], [2, 4], [3]]),
    createWorld([[1], [0, 2], [1, 3, 4], [2, 4], [2, 3]]),
  ];
  const traces = worlds.map((world) => {
    const views: AgentView[] = [];
    const policy: Policy = {
      version: "canary-transport.1",
      decide(view) {
        views.push(view);
        return {
          kind: "wait",
          outbound: [request(view, 1 - view.id, view.tick!)],
        };
      },
    };
    runTicks(
      initialize({ ...config, nodeCount: 5 }, policy, world).state,
      5,
      policy,
    );
    return views;
  });
  expect(traces[0]).toEqual(traces[1]);
  expect(traces[0]![2]!.inbox).toHaveLength(1);
  for (const view of traces[0]!) {
    expect(view.adjacency).toEqual({ 0: [1], 1: [0] });
    for (const message of view.inbox!)
      expect(message.payload).toEqual({
        kind: "observation",
        node: 0,
        neighbors: [1],
      });
  }
});
