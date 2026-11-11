import { expect, it } from "vitest";
import {
  initialize,
  runTicks,
  step,
  type Config,
  type Policy,
} from "../src/sim/engine";
import { createWorld, type Scenario } from "../src/sim/graph";
import { serializeState, stateHash } from "../src/sim/state-hash";
import { efrPolicy } from "../src/sim/efr";
import { emptyEfr } from "../src/sim/reservations";
import type { Announcement, Message } from "../src/sim/comms";
import type { AgentView, Action } from "../src/sim/agent";

const radio = {
  range: 5,
  delay: 1,
  loss: 0,
  maxBytes: 512,
  maxQueue: 32,
  maxOutbound: 4,
};
const fork = createWorld([[1, 3, 4], [0, 2], [1], [0], [0]]);
const single = createWorld([[1, 3], [0, 2], [1], [0]]);
function config(nodeCount: number): Config {
  return {
    seed: 3,
    scenario: "branching",
    nodeCount,
    agentCount: 2,
    communication: radio,
    efr: { ttl: 6 },
  };
}
function claim(target: number, issuedTick = 1, ttl = 4) {
  return {
    kind: "claim",
    target,
    issuedTick,
    expiresTick: issuedTick + ttl,
  } as const;
}
function packet(
  payload: Announcement,
  seq: number,
  dueTick: number,
  from = 0,
  sentTick = payload.issuedTick,
): Message {
  return { from, to: 1, seq, sentTick, dueTick, payload };
}
function decide(
  tick: number,
  inbox: Message[],
  memory = emptyEfr(3),
  adjacency: AgentView["adjacency"] = { 0: [2], 2: [0] },
) {
  const action = efrPolicy.decide(
    {
      id: 1,
      position: 0,
      visited: [0],
      adjacency,
      tick,
      inbox,
      efr: { ttl: 4, rosterSize: 3, outboundLimit: 2, memory },
    },
    123,
  );
  if (!action.efr) throw new Error("Missing EFR transition");
  return { action, memory: action.efr };
}

it("selects a different reachable frontier only after delivery resolves a tie", () => {
  const start = initialize(config(5), efrPolicy, fork).state;
  const before = runTicks(start, 3, efrPolicy);
  expect(before.state.agents.map((agent) => agent.efr?.own?.target)).toEqual([
    3, 3,
  ]);
  expect(
    before.events.filter(
      (e) =>
        e.kind === "message-sent" &&
        e.message.payload.kind === "claim" &&
        e.message.payload.target === 3,
    ),
  ).toHaveLength(2);
  const after = step(before.state, efrPolicy);
  expect(after.state.agents.map((agent) => agent.efr?.own?.target)).toEqual([
    3, 4,
  ]);
  expect(
    step(after.state, efrPolicy).state.agents.map((agent) => agent.position),
  ).toEqual([3, 4]);
});
it("retains the earlier issuer, then uses smaller address on a tie", () => {
  for (const [ownTick, from, expected] of [
    [1, 0, "move"],
    [2, 0, "wait"],
    [2, 2, "move"],
  ] as const) {
    const memory = { ...emptyEfr(3), own: claim(2, ownTick) };
    expect(
      decide(3, [packet(claim(2, 2), 0, 3, from)], memory).action.kind,
    ).toBe(expected);
  }
});
it("waits one tick before expiry and reacquires at the exclusive boundary", () => {
  const blocked = decide(2, [packet(claim(2), 0, 2)]);
  expect(blocked.action.kind).toBe("wait");
  expect(decide(4, [], blocked.memory).action.kind).toBe("wait");
  const eligible = decide(5, [], blocked.memory);
  expect(eligible.action).toMatchObject({ kind: "move", to: 2 });
  expect(eligible.memory.own).toEqual(claim(2, 5));
  expect(decide(6, [packet(claim(2), 1, 6)]).action.kind).toBe("move");
});
it("matches release identity and retains sequence and issuance watermarks", () => {
  const held = decide(2, [packet(claim(2), 0, 2)]);
  const wrong = decide(
    3,
    [packet({ kind: "release", target: 3, issuedTick: 1 }, 1, 3)],
    held.memory,
  );
  expect(wrong.action.kind).toBe("wait");
  const released = decide(
    4,
    [
      packet({ kind: "release", target: 2, issuedTick: 1 }, 2, 4, 0, 3),
      packet(claim(2), 1, 4),
      packet(claim(2), 2, 4),
      packet(claim(2), 3, 4),
    ],
    wrong.memory,
  );
  expect(released.memory.received[0]).toEqual({
    seq: 3,
    latestIssue: 1,
    claim: null,
  });
  expect(released.action.kind).toBe("move");
});
it("ignores an unknown target even if an old claim is repeated after sensing", () => {
  const ignored = decide(2, [packet(claim(2), 1, 2)], emptyEfr(3), { 0: [] });
  expect(ignored.memory.received[0]).toEqual({
    seq: 1,
    latestIssue: 1,
    claim: null,
  });
  expect(ignored.action.kind).toBe("wait");
  expect(decide(3, [packet(claim(2), 2, 3)], ignored.memory).action.kind).toBe(
    "move",
  );
});
it("ignores visited goals and waits on disconnected local frontiers", () => {
  expect(
    decide(2, [packet(claim(0), 0, 2)], emptyEfr(3), { 0: [], 2: [] }).memory
      .received[0]?.claim,
  ).toBeNull();
  expect(decide(2, [], emptyEfr(3), { 0: [], 2: [] }).action.kind).toBe("wait");
});
it.each([0, 1.5, 10001, Infinity])("rejects invalid TTL %i", (ttl) => {
  expect(() => initialize({ ...config(5), efr: { ttl } }, efrPolicy)).toThrow(
    RangeError,
  );
});
it("normalizes default TTL and counts per-peer sends against the budget", () => {
  const { efr: settings, ...cfg } = config(5);
  expect(settings?.ttl).toBe(6);
  const start = initialize(
    { ...cfg, agentCount: 4, communication: { ...radio, maxOutbound: 1 } },
    efrPolicy,
    fork,
  ).state;
  expect(start.config.efr?.ttl).toBe(16);
  let state = start;
  const recipients: number[] = [];
  for (let i = 0; i < 3; i++) {
    const result = step(state, efrPolicy);
    state = result.state;
    const sends = result.events.filter(
      (e) => e.kind === "message-sent" && e.agentId === 0,
    );
    expect(sends).toHaveLength(1);
    for (const event of sends)
      if (event.kind === "message-sent") recipients.push(event.message.to);
    expect(state.agents[0]!.efr!.pending.every((row) => row.length <= 2)).toBe(
      true,
    );
  }
  expect(recipients).toEqual([1, 2, 3]);
  expect(state.agents[0]!.efr!.nextSeq).toBe(3);
});

it.each([
  [{ ...radio, loss: 1 }, "loss"],
  [{ ...radio, maxQueue: 0 }, "queue-full"],
  [{ ...radio, maxBytes: 1 }, "size-limit"],
] as const)(
  "failed announcements cannot coordinate other planners",
  (communication, reason) => {
    const start = initialize(
      { ...config(5), communication },
      efrPolicy,
      fork,
    ).state;
    const result = runTicks(start, 4, efrPolicy);
    expect(result.events).toContainEqual(expect.objectContaining({ reason }));
    expect(result.events.filter((e) => e.kind === "message-delivered")).toEqual(
      [],
    );
    expect(result.state.agents.map((agent) => agent.efr?.own?.target)).toEqual([
      3, 3,
    ]);
    expect(result.state.agents[0]!.efr!.nextSeq).toBeGreaterThan(0);
  },
);
it("rejects unauthorized frontier IDs and malformed release bodies in real transport", () => {
  const policy: Policy = {
    ...efrPolicy,
    decide(view, draw) {
      const action = efrPolicy.decide(view, draw);
      return {
        ...action,
        outbound:
          view.id === 0
            ? [
                { to: 1, seq: 0, payload: claim(99, 1, 6) },
                { to: 1, seq: 1, payload: claim(0, 1, 6) },
                { to: 1, seq: 2, payload: claim(1, 1, 3) },
                {
                  to: 1,
                  seq: 3,
                  payload: Object.assign(
                    { kind: "release" as const, target: 1, issuedTick: 1 },
                    { issuer: 2 },
                  ),
                },
              ]
            : [],
      };
    },
  };
  const first = step(initialize(config(5), policy, fork).state, policy);
  expect(
    first.events.filter(
      (e) =>
        e.kind === "message-rejected" && e.reason === "unauthorized-payload",
    ),
  ).toHaveLength(4);
  expect(first.state.transport!.queue).toHaveLength(0);
});
it("sends completion releases, and waits longer if the release is lost to range", () => {
  function run(range: number) {
    const start = initialize(
      { ...config(4), communication: { ...radio, range } },
      efrPolicy,
      single,
    ).state;
    return runTicks(start, 9, efrPolicy).events;
  }
  const early = run(4),
    late = run(0);
  expect(early).toContainEqual(
    expect.objectContaining({
      tick: 7,
      kind: "message-delivered",
      message: expect.objectContaining({
        from: 0,
        payload: { kind: "release", target: 3, issuedTick: 3 },
      }),
    }),
  );
  expect(late).toContainEqual(
    expect.objectContaining({
      tick: 6,
      kind: "message-dropped",
      reason: "range",
      message: expect.objectContaining({
        from: 0,
        payload: { kind: "release", target: 3, issuedTick: 3 },
      }),
    }),
  );
  expect(early).toContainEqual(
    expect.objectContaining({ tick: 7, agentId: 1, kind: "moved" }),
  );
  expect(late).toContainEqual(
    expect.objectContaining({ tick: 8, agentId: 1, kind: "waited" }),
  );
  expect(late).toContainEqual(
    expect.objectContaining({ tick: 9, agentId: 1, kind: "moved" }),
  );
});
it("keeps an in-flight owner's claim until expiry without disclosing its failure", () => {
  function trace(fail: boolean) {
    const calls: { view: AgentView; draw: number; action: Action }[] = [];
    const policy: Policy = {
      ...efrPolicy,
      decide(view, draw) {
        const action = efrPolicy.decide(view, draw);
        if (view.id === 1) calls.push({ view, draw, action });
        return action;
      },
    };
    const start = initialize(
      {
        ...config(4),
        communication: { ...radio, range: 0 },
        failures: fail ? [{ agentId: 0, tick: 4 }] : [],
      },
      policy,
      single,
    );
    const before = runTicks(start.state, 3, policy);
    const after = runTicks(before.state, 6, policy);
    return { before, after, calls };
  }
  const healthy = trace(false),
    failed = trace(true);
  expect(failed.calls).toEqual(healthy.calls);
  expect(failed.after.state.agents[0]!.efr).toEqual(
    failed.before.state.agents[0]!.efr,
  );
  expect(
    failed.after.events.filter(
      (e) => e.agentId === 0 && e.kind === "message-sent",
    ),
  ).toEqual([]);
  for (const tick of [4, 5, 6, 7, 8]) {
    const call = failed.calls[tick - 1]!;
    expect(call.action.kind).toBe("wait");
    expect(call.action.efr?.received[0]?.claim).toEqual(claim(3, 3, 6));
  }
  expect(failed.calls[8]!.action).toMatchObject({
    kind: "move",
    to: 0,
    efr: { own: claim(3, 9, 6) },
  });
  expect(failed.after.events[0]).toEqual({
    kind: "agent-failed",
    tick: 4,
    agentId: 0,
  });
  expect(failed.after.events).toContainEqual(
    expect.objectContaining({
      kind: "message-delivered",
      tick: 4,
      message: expect.objectContaining({ from: 0, payload: claim(3, 3, 6) }),
    }),
  );
});

it("failure before planning prevents the outgoing claim", () => {
  const start = initialize(
    { ...config(4), failures: [{ agentId: 0, tick: 3 }] },
    efrPolicy,
    single,
  ).state;
  const result = runTicks(start, 6, efrPolicy);
  expect(
    result.events.some(
      (e) => e.kind === "message-sent" && e.agentId === 0 && e.tick >= 3,
    ),
  ).toBe(false);
  expect(result.state.agents[1]!.knowledge.visited).toContain(3);
});

it("ignores older leases after replacement and a release sent by another issuer", () => {
  const adjacency = { 0: [2, 3], 2: [0], 3: [0] };
  const newer = decide(3, [packet(claim(3, 2), 4, 3)], emptyEfr(3), adjacency);
  const replay = decide(
    4,
    [
      packet(claim(2), 3, 4),
      packet(claim(2), 5, 4),
      packet({ kind: "release", target: 3, issuedTick: 2 }, 1, 4, 2, 3),
    ],
    newer.memory,
    adjacency,
  );
  expect(replay.memory.received[0]).toEqual({
    seq: 5,
    latestIssue: 2,
    claim: claim(3, 2),
  });
});

it("preserves the exact claim size boundary and expires queued claims in transit", () => {
  const cfg = config(5);
  const start = initialize(cfg, efrPolicy, fork).state;
  const sent = step(start, efrPolicy).events.find(
    (e) => e.kind === "message-sent",
  );
  if (!sent || sent.kind !== "message-sent")
    throw new Error("Expected an actual claim");
  for (const delta of [0, -1]) {
    const limit = {
      ...cfg,
      communication: { ...radio, maxBytes: sent.bytes + delta },
    };
    const result = step(initialize(limit, efrPolicy, fork).state, efrPolicy);
    expect(result.state.transport!.queue).toHaveLength(delta === 0 ? 2 : 0);
  }
  const slow = {
    ...cfg,
    efr: { ttl: 1 },
    communication: { ...radio, delay: 2 },
  };
  const result = runTicks(
    initialize(slow, efrPolicy, fork).state,
    5,
    efrPolicy,
  );
  expect(
    result.events.some(
      (e) =>
        e.kind === "message-delivered" && e.message.payload.kind === "claim",
    ),
  ).toBe(true);
  for (const agent of result.state.agents)
    expect(agent.efr!.received.every((entry) => !entry?.claim)).toBe(true);
});

it("keeps zero-radio agents independent and handles an exhausted singleton", () => {
  const start = initialize(
    { ...config(5), communication: undefined },
    efrPolicy,
    fork,
  ).state;
  const result = runTicks(start, 4, efrPolicy);
  expect(result.events.filter((e) => e.kind === "message-sent")).toEqual([]);
  expect(result.state.agents.map((a) => a.efr?.own?.target)).toEqual([3, 3]);
  const idle = step(
    initialize({ ...config(1), agentCount: 1 }, efrPolicy).state,
    efrPolicy,
  );
  expect(idle.events).toEqual([{ tick: 1, kind: "waited", agentId: 0, at: 0 }]);
  expect(idle.state.agents[0]!.efr?.own).toBeNull();
});

it("detaches planner memory on input, output, between agents and between runs", () => {
  const views: AgentView[] = [],
    outputs: Action[] = [];
  const policy: Policy = {
    ...efrPolicy,
    decide(view, draw) {
      views.push(view);
      const action = efrPolicy.decide(view, draw);
      outputs.push(action);
      return action;
    },
  };
  const start = initialize(config(5), policy, fork).state;
  const secondRun = initialize(config(5), policy, fork).state;
  const after = step(start, policy).state;
  const memory = views[0]!.efr!.memory;
  expect(memory).not.toBe(start.agents[0]!.efr);
  expect(memory.pending[1]).not.toBe(start.agents[0]!.efr!.pending[1]);
  expect(() => Object.assign(memory.received, { 1: { seq: 99 } })).toThrow();
  const stored = after.agents[0]!.efr!;
  expect(stored.own).not.toBe(outputs[0]!.efr!.own);
  expect(stored.received).not.toBe(after.agents[1]!.efr!.received);
  expect(stored.pending).not.toBe(secondRun.agents[0]!.efr!.pending);
  Object.assign(outputs[0]!.efr!, { cursor: 999 });
  expect(serializeState(after)).toBe(
    serializeState(step(secondRun, efrPolicy).state),
  );
});

it("keeps real EFR inputs and decisions identical until a changed edge is sensed", () => {
  const changed = createWorld([[1, 3, 4], [0, 2], [1], [0, 4], [0, 3]]);
  const traces = [fork, changed].map((world) => {
    const calls: { view: AgentView; draw: number; action: Action }[] = [];
    const policy: Policy = {
      ...efrPolicy,
      decide(view, draw) {
        const action = efrPolicy.decide(view, draw);
        calls.push({ view, draw, action });
        return action;
      },
    };
    runTicks(initialize(config(5), policy, world).state, 6, policy);
    return calls;
  });
  expect(traces[0]!.slice(0, 10)).toEqual(traces[1]!.slice(0, 10));
  expect(traces[0]![10]!.view.adjacency[3]).toEqual([0]);
  expect(traces[1]![10]!.view.adjacency[3]).toEqual([0, 4]);
});

const families: Scenario[] = ["branching", "bottleneck-heavy", "loop-heavy"];
it("delivers a sender-known frontier without adding it to a parked recipient's map or claims", () => {
  const chain = createWorld([[1], [0, 2], [1]]);
  const policy: Policy = {
    ...efrPolicy,
    decide(view, draw) {
      const decision = efrPolicy.decide(view, draw);
      if (view.id === 0) return decision;
      // Hold the receiver at the entrance so only the sender has sensed node 1.
      return { kind: "wait", outbound: decision.outbound, efr: decision.efr };
    },
  };
  const result = runTicks(
    initialize(config(3), policy, chain).state,
    3,
    policy,
  );
  const delivery = result.events.find(
    (event) =>
      event.kind === "message-delivered" &&
      event.agentId === 1 &&
      event.message.payload.kind === "claim" &&
      event.message.payload.target === 2,
  );
  if (!delivery || delivery.kind !== "message-delivered")
    throw new Error("Missing unknown-target delivery");
  const receiver = result.state.agents[1]!;
  expect(receiver.knowledge.adjacency).toEqual({ 0: [1], 1: [0] });
  expect(receiver.efr?.received[0]).toEqual({
    seq: delivery.message.seq,
    latestIssue: 2,
    claim: null,
  });
});
it("retains its lease without renewal until the boundary, then issues a fresh claim", () => {
  const first = decide(1, []);
  const retained = decide(4, [], first.memory);
  expect(retained.memory.own).toEqual(first.memory.own);
  expect(retained.action.outbound).toEqual([]);
  const renewed = decide(5, [], retained.memory);
  expect(renewed.memory.own).toEqual(claim(2, 5));
  expect(renewed.action.outbound).toHaveLength(2);
});

it("includes TTL and each independent EFR state component in the checksum", () => {
  const initial = initialize(
    {
      ...config(5),
      agentCount: 3,
      communication: { ...radio, maxOutbound: 1 },
    },
    efrPolicy,
    fork,
  ).state;
  const state = step(initial, efrPolicy).state;
  const memory = state.agents[0]!.efr!;
  const receipt = { seq: 1, latestIssue: 1, claim: null };
  const changes = [
    { ...memory, own: null },
    { ...memory, nextSeq: memory.nextSeq + 1 },
    { ...memory, cursor: (memory.cursor + 1) % 3 },
    { ...memory, pending: memory.pending.map(() => []) },
    { ...memory, received: [null, receipt, null] },
  ];
  for (const efr of changes) {
    const other = {
      ...state,
      agents: state.agents.map((agent) =>
        agent.id === 0 ? { ...agent, efr } : agent,
      ),
    };
    expect(serializeState(other)).not.toBe(serializeState(state));
    expect(stateHash(other)).not.toBe(stateHash(state));
  }
  expect(
    stateHash({ ...state, config: { ...state.config, efr: { ttl: 2 } } }),
  ).not.toBe(stateHash(state));
});
it.each(
  families.flatMap((scenario) =>
    Array.from({ length: 12 }, (_, seed) => ({ scenario, seed })),
  ),
)(
  "replays EFR state and event bytes for $scenario seed=$seed",
  ({ scenario, seed }) => {
    const cfg: Config = {
      ...config(8),
      seed,
      scenario,
      agentCount: 3,
      efr: { ttl: 3 + (seed % 4) },
      communication: {
        ...radio,
        range: 2,
        delay: 1 + (seed % 3),
        loss: 0.35,
        maxOutbound: 1 + (seed % 2),
        maxQueue: 6,
      },
      failures: [
        { agentId: 0, tick: 4 + (seed % 3) },
        { agentId: 2, tick: 9 },
      ],
    };
    const initial = initialize(cfg, efrPolicy);
    const original = serializeState(initial.state);
    const batch = runTicks(initial.state, 16, efrPolicy);
    const fresh = initialize(cfg, efrPolicy);
    expect(fresh.events).toEqual(initial.events);
    let state = fresh.state;
    const log = [];
    for (let tick = 1; tick <= 16; tick++) {
      const before = state;
      const next = step(before, efrPolicy);
      const context = `seed=${seed} tick=${tick}`;
      expect(
        next.events.filter((e) => e.kind === "rejected"),
        context,
      ).toEqual([]);
      expect(
        next.events.filter((e) => e.kind === "message-rejected"),
        context,
      ).toEqual([]);
      for (const event of next.events)
        if (event.kind === "moved") {
          expect(
            before.agents[event.agentId]!.knowledge.adjacency[event.from],
            context,
          ).toContain(event.to);
          expect(before.world.adjacency[event.from], context).toContain(
            event.to,
          );
        }
      state = next.state;
      log.push(...next.events);
    }
    let chunked = initialize(cfg, efrPolicy).state;
    const chunkLog = [];
    for (const count of [2, 0, 1, 4, 9]) {
      const next = runTicks(chunked, count, efrPolicy);
      chunked = JSON.parse(JSON.stringify(next.state));
      chunkLog.push(...next.events);
    }
    for (const [result, events] of [
      [state, log],
      [chunked, chunkLog],
    ] as const) {
      expect(JSON.stringify(events)).toBe(JSON.stringify(batch.events));
      expect(serializeState(result)).toBe(serializeState(batch.state));
      expect(stateHash(result)).toBe(stateHash(batch.state));
    }
    expect(serializeState(initial.state)).toBe(original);
  },
);
