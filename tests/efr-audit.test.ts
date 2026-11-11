import { expect, it } from "vitest";
import type { Action, AgentView, Planner } from "../src/sim/agent";
import { efrPolicy } from "../src/sim/efr";
import {
  initialize,
  runTicks,
  type Config,
  type SimEvent,
} from "../src/sim/engine";
import { createWorld, type World } from "../src/sim/graph";

const radio = {
  range: 10,
  delay: 1,
  loss: 0,
  maxBytes: 512,
  maxQueue: 32,
  maxOutbound: 1,
};
const fork = createWorld([
  [1, 6, 7],
  [0, 2],
  [1, 3],
  [2, 4],
  [3, 5],
  [4],
  [0],
  [0],
]);
const config: Config = {
  seed: 3,
  scenario: "branching",
  nodeCount: 8,
  agentCount: 3,
  communication: radio,
};

function record(world: World, cfg: Config, decide: Planner = efrPolicy.decide) {
  const calls: { view: AgentView; draw: number; action: Action }[] = [];
  const events: SimEvent[] = [];
  const policy = {
    ...efrPolicy,
    decide(view: AgentView, draw: number) {
      const action = decide(view, draw);
      calls.push({ view, draw, action });
      return action;
    },
  };
  let state = initialize(cfg, policy, world).state;
  return {
    calls,
    events,
    at(id: number, tick: number) {
      const call = calls.find((c) => c.view.id === id && c.view.tick === tick);
      if (!call)
        throw Error(`Missing planner call for agent ${id} at tick ${tick}`);
      return call;
    },
    advance(n: number) {
      const next = runTicks(state, n, policy);
      state = next.state;
      events.push(...next.events);
      return state;
    },
  };
}

it("traces staggered unicast claims from private frontiers to each peer's decision", () => {
  // Only the far sides of the two unexplored branches differ.
  const joined = createWorld([...fork.adjacency.slice(0, 6), [0, 7], [0, 6]]);
  const a = record(fork, config),
    b = record(joined, config);
  for (let tick = 1; tick <= 14; tick++) {
    a.advance(1);
    b.advance(1);
  }
  expect(a.calls.filter((c) => c.view.tick! <= 11)).toEqual(
    b.calls.filter((c) => c.view.tick! <= 11),
  );
  expect(a.at(0, 12).view.adjacency[6]).toEqual([0]);
  expect(b.at(0, 12).view.adjacency[6]).toEqual([0, 7]);

  for (const [trace, world] of [
    [a, fork],
    [b, joined],
  ] as const) {
    const reference = runTicks(
      initialize(config, efrPolicy, world).state,
      14,
      efrPolicy,
    );
    expect(trace.events).toEqual(reference.events);
    expect(trace.advance(0)).toEqual(reference.state);
    const deliveries = trace.events.flatMap((e) =>
      e.kind === "message-delivered" ? [e] : [],
    );
    const sends = trace.events.flatMap((e) =>
      e.kind === "message-sent" ? [e] : [],
    );
    expect(deliveries.map((e) => [e.tick, e.agentId, e.message])).toEqual(
      sends
        .filter((e) => e.message.dueTick <= 14)
        .map(({ message }) => [message.dueTick, message.to, message]),
    );
    for (const { agentId, tick, message } of sends) {
      const { from, to, seq, payload } = message;
      if (payload.kind !== "claim") continue;
      const { view, action } = trace.at(agentId, tick);
      expect(from).toBe(agentId);
      expect(view.visited).not.toContain(payload.target);
      expect(view.adjacency[payload.target]).toBeDefined();
      const issuance = trace.at(from, payload.issuedTick);
      expect(issuance.view.visited).not.toContain(payload.target);
      expect(issuance.view.adjacency[payload.target]).toBeDefined();
      expect(issuance.action.efr?.own).toEqual(payload);
      expect(action.outbound).toEqual([{ to, seq, payload }]);
      expect(message.sentTick).toBe(tick);
      expect(message.dueTick).toBe(tick + 1);
    }
    for (const { view, action } of trace.calls) {
      const inbox = deliveries
        .filter((e) => e.tick === view.tick && e.agentId === view.id)
        .map((e) => e.message);
      expect(view.inbox).toEqual(inbox);
      for (const [issuer, entry] of action.efr!.received.entries()) {
        if (
          entry?.claim &&
          entry.seq !== view.efr!.memory.received[issuer]?.seq
        ) {
          expect(inbox).toContainEqual(
            expect.objectContaining({
              from: issuer,
              to: view.id,
              seq: entry.seq,
              payload: entry.claim,
            }),
          );
        }
      }
    }
    // Owner 0's lease for 6 reaches robot 2 at tick 9 and robot 1 at tick 10.
    for (const [id, tick] of [
      [2, 9],
      [1, 10],
    ] as const) {
      const before = trace.at(id, tick - 1).action.efr!;
      expect(before.received[0]?.claim).toBeNull();
      expect(before.own?.target).toBe(6);
      const after = trace.at(id, tick).action.efr!;
      expect(after.received[0]?.claim).toMatchObject({
        target: 6,
        issuedTick: 6,
      });
      expect(after.own?.target).toBe(7);
    }
  }
});

it.each([3, 4])(
  "applies the original expiry when a failed owner's claim arrives after %i ticks",
  (delay) => {
    const world = createWorld([
      [1, 6],
      [0, 2],
      [1, 3],
      [2, 4],
      [3, 5],
      [4],
      [0],
    ]);
    const trace = record(world, {
      ...config,
      nodeCount: 7,
      agentCount: 2,
      efr: { ttl: 4 },
      communication: { ...radio, delay, maxOutbound: 3 },
      failures: [{ agentId: 0, tick: 7 }],
    });
    trace.advance(10);
    const sent = trace.events.find(
      (e) =>
        e.kind === "message-sent" &&
        e.message.from === 0 &&
        e.message.payload.kind === "claim" &&
        e.message.payload.target === 6,
    );
    if (sent?.kind !== "message-sent")
      throw Error("Expected owner to transmit before failure");
    expect(sent.message).toMatchObject({
      to: 1,
      sentTick: 6,
      dueTick: 6 + delay,
      payload: { issuedTick: 6, expiresTick: 10 },
    });
    expect(trace.events).toContainEqual({
      kind: "agent-failed",
      tick: 7,
      agentId: 0,
    });
    expect(trace.calls.some((c) => c.view.id === 0 && c.view.tick! >= 7)).toBe(
      false,
    );
    expect(trace.at(1, 6 + delay).view.inbox).toContainEqual(sent.message);
    const before = trace.at(1, 9).action;
    expect(before.kind).toBe(delay === 3 ? "wait" : "move");
    expect(before.efr?.received[0]?.claim).toEqual(
      delay === 3 ? sent.message.payload : null,
    );
    const boundary = trace.at(1, 10).action;
    expect(boundary).toMatchObject({
      kind: "move",
      efr: { own: { target: 6, issuedTick: 10 } },
    });
    expect(boundary.efr?.received[0]).toMatchObject({
      seq: sent.message.seq,
      claim: null,
    });
  },
);

it("waits for the last of two leases after a lost release and a wrong-issuer release", () => {
  const world = createWorld([[1], [0]]);
  const cfg = {
    ...config,
    nodeCount: 2,
    efr: { ttl: 4 },
    communication: { ...radio, range: 0 },
    failures: [
      { agentId: 1, tick: 3 },
      { agentId: 0, tick: 5 },
    ],
  };
  // Two scripted peers exercise the real send-time range check and envelope identity.
  // Robot 2 starts exploring on tick 2 and runs the unmodified EFR decision thereafter.
  const peers: Planner = (view, draw) => {
    const tick = view.tick!;
    if (view.id === 2 && tick >= 2) return efrPolicy.decide(view, draw);
    if ((view.id === 0 && tick === 1) || (view.id === 1 && tick === 2))
      return {
        kind: "wait",
        outbound: [
          {
            to: 2,
            seq: 0,
            payload: {
              kind: "claim",
              target: 1,
              issuedTick: tick,
              expiresTick: tick + 4,
            },
          },
        ],
      };
    if (view.id === 0 && tick === 2) return { kind: "move", to: 1 };
    if (view.id === 0 && tick === 3)
      return {
        kind: "wait",
        outbound: [
          {
            to: 2,
            seq: 1,
            payload: { kind: "release", target: 1, issuedTick: 1 },
          },
        ],
      };
    if (view.id === 0 && tick === 4)
      return {
        kind: "move",
        to: 0,
        outbound: [
          {
            to: 2,
            seq: 2,
            payload: { kind: "release", target: 1, issuedTick: 2 },
          },
        ],
      };
    return { kind: "wait" };
  };
  const trace = record(world, cfg, peers);
  trace.advance(6);
  const drops = trace.events.filter(
    (e) => e.kind === "message-dropped" && e.reason === "range",
  );
  expect(drops).toContainEqual(
    expect.objectContaining({
      tick: 3,
      message: expect.objectContaining({ from: 0, to: 2, seq: 1 }),
    }),
  );
  expect(trace.at(2, 5).view.inbox).toContainEqual(
    expect.objectContaining({
      from: 0,
      to: 2,
      seq: 2,
      payload: { kind: "release", target: 1, issuedTick: 2 },
    }),
  );
  for (const tick of [2, 3, 4, 5])
    expect(trace.at(2, tick).action.kind).toBe("wait");
  const received = trace.at(2, 5).action.efr!.received;
  expect(received[0]?.claim).toBeNull();
  expect(received[1]?.claim).toMatchObject({ issuedTick: 2, expiresTick: 6 });
  expect(trace.at(2, 6).action).toMatchObject({ kind: "move", to: 1 });
});
