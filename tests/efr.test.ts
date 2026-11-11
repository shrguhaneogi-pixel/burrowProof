import { expect, it } from "vitest";
import {
  initialize,
  runTicks,
  step,
  type Config,
  type Policy,
} from "../src/sim/engine";
import { createWorld } from "../src/sim/graph";
import { efrPolicy } from "../src/sim/efr";
import { emptyEfr } from "../src/sim/reservations";
import type { Announcement, Message } from "../src/sim/comms";
import type { AgentView } from "../src/sim/agent";

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
