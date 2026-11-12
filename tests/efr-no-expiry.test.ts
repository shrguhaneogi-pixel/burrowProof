import { expect, it } from "vitest";
import type { AgentView } from "../src/sim/agent";
import { efrPolicy, efrNoExpiryPolicy } from "../src/sim/efr";
import {
  initialize,
  step,
  runTicks,
  type Config,
  type Policy,
} from "../src/sim/engine";
import { createWorld } from "../src/sim/graph";
import { emptyEfr, type EfrState } from "../src/sim/reservations";
import {
  validAnnouncement,
  type Announcement,
  type Message,
} from "../src/sim/comms";

const radio = {
  range: 10,
  delay: 1,
  loss: 0,
  maxBytes: 512,
  maxQueue: 32,
  maxOutbound: 3,
};
const config: Config = {
  seed: 3,
  scenario: "branching",
  nodeCount: 7,
  agentCount: 2,
  efr: { ttl: 4 },
  communication: radio,
  failures: [{ agentId: 0, tick: 7 }],
};
const corridor = createWorld([
  [1, 6],
  [0, 2],
  [1, 3],
  [2, 4],
  [3, 5],
  [4],
  [0],
]);
const lease = {
  kind: "claim",
  target: 1,
  issuedTick: 1,
  expiresTick: 5,
} as const;
function packet(
  payload: Announcement,
  tick: number,
  seq = 0,
  from = 0,
): Message {
  return {
    from,
    to: 2,
    seq,
    sentTick: payload.issuedTick,
    dueTick: tick,
    payload,
  };
}
function choose(
  policy: Policy,
  tick: number,
  memory: EfrState,
  inbox: Message[] = [],
  visited = [0],
) {
  const view: AgentView = {
    id: 2,
    position: 0,
    visited,
    adjacency: { 0: [1, 3], 1: [0], 3: [0] },
    tick,
    inbox,
    efr: { ttl: 4, rosterSize: 3, outboundLimit: 2, memory },
  };
  const action = policy.decide(view, 123);
  if (!action.efr) throw Error("Missing local policy state");
  return { action, memory: action.efr };
}
function held() {
  return {
    ...emptyEfr(3),
    received: [{ seq: 0, latestIssue: 1, claim: lease }, null, null],
  };
}

it("changes the selected target at the exact lease boundary with identical local inputs", () => {
  for (const tick of [4, 5]) {
    const normal = choose(efrPolicy, tick, held()),
      permanent = choose(efrNoExpiryPolicy, tick, held());
    if (tick === 4) expect(normal).toEqual(permanent);
    else {
      expect(normal.action).toMatchObject({
        kind: "move",
        to: 1,
        efr: { own: { target: 1 } },
      });
      expect(permanent.action).toMatchObject({
        kind: "move",
        to: 3,
        efr: { own: { target: 3 } },
      });
      expect(permanent.memory.received[0]?.claim).toEqual(lease);
    }
  }
});

it("matches the engine before expiry and recovers differently after owner failure", () => {
  function run(base: Policy) {
    const calls: AgentView[] = [];
    const policy = {
      ...base,
      decide(view: AgentView, draw: number) {
        calls.push(view);
        return base.decide(view, draw);
      },
    };
    const start = initialize(config, policy, corridor).state;
    return { calls, start, result: runTicks(start, 16, policy) };
  }
  const standard = run(efrPolicy),
    ablation = run(efrNoExpiryPolicy);
  expect(standard.calls.filter((v) => v.tick! < 10)).toEqual(
    ablation.calls.filter((v) => v.tick! < 10),
  );
  expect(standard.result.events.filter((e) => e.tick < 10)).toEqual(
    ablation.result.events.filter((e) => e.tick < 10),
  );
  const beforeA = runTicks(standard.start, 9, efrPolicy).state;
  const beforeB = runTicks(ablation.start, 9, efrNoExpiryPolicy).state;
  expect({ ...beforeA, algorithmVersion: beforeB.algorithmVersion }).toEqual(
    beforeB,
  );
  expect(step(beforeA, efrPolicy).events).toContainEqual(
    expect.objectContaining({ kind: "moved", agentId: 1, tick: 10 }),
  );
  for (const tick of [10, 11, 16])
    expect(ablation.result.events).toContainEqual(
      expect.objectContaining({ kind: "waited", agentId: 1, tick }),
    );
  expect(
    ablation.result.state.agents[1]!.efr?.received[0]?.claim,
  ).toMatchObject({ target: 6, expiresTick: 10 });
  expect(standard.result.state.agents[1]!.knowledge.visited).toContain(6);
  expect(ablation.result.state.agents[1]!.knowledge.visited).not.toContain(6);
  expect(
    standard.calls.every((v) => !("lifecycle" in v) && !("failures" in v)),
  ).toBe(true);
  expect(
    ablation.calls.every((v) => !("lifecycle" in v) && !("failures" in v)),
  ).toBe(true);
  expect(() => step(ablation.start, efrPolicy)).toThrow(
    "Policy version mismatch",
  );
  expect(() => step(standard.start, efrNoExpiryPolicy)).toThrow(
    "Policy version mismatch",
  );
});

it.each([4, 5, 6])(
  "handles a claim delivered at tick %i using the original timestamp",
  (tick) => {
    const normal = choose(efrPolicy, tick, emptyEfr(3), [packet(lease, tick)]);
    const permanent = choose(efrNoExpiryPolicy, tick, emptyEfr(3), [
      packet(lease, tick),
    ]);
    expect(normal.memory.own?.target).toBe(tick < 5 ? 3 : 1);
    expect(permanent.memory.own?.target).toBe(3);
    expect(permanent.memory.received[0]?.claim).toEqual(lease);
  },
);

it("retains finite timestamp validation when sending an old lease", () => {
  expect(validAnnouncement(lease, 5, 4)).toBe(false);
  expect(validAnnouncement(lease, 5, 4, "disabled")).toBe(true);
  for (const expiry of ["enforced", "disabled"] as const) {
    expect(validAnnouncement({ ...lease, expiresTick: 6 }, 5, 4, expiry)).toBe(
      false,
    );
    expect(validAnnouncement({ ...lease, issuedTick: 7 }, 5, 4, expiry)).toBe(
      false,
    );
    expect(
      validAnnouncement({ ...lease, expiresTick: Infinity }, 5, 4, expiry),
    ).toBe(false);
  }
});

it("still applies ownership, releases, supersession, visited targets and sequence watermarks", () => {
  for (const policy of [efrPolicy, efrNoExpiryPolicy]) {
    const wrong = choose(policy, 4, held(), [
      packet({ kind: "release", target: 1, issuedTick: 1 }, 4, 1, 1),
    ]);
    expect(wrong.memory.received[0]?.claim).toEqual(lease);
    const released = choose(policy, 4, held(), [
      packet({ kind: "release", target: 1, issuedTick: 1 }, 4, 1),
    ]);
    expect(released.memory.received[0]?.claim).toBeNull();
    const replay = choose(policy, 4, released.memory, [packet(lease, 4, 0)]);
    expect(replay.memory.received[0]?.claim).toBeNull();
    const newer = { ...lease, target: 3, issuedTick: 2, expiresTick: 6 };
    expect(
      choose(policy, 4, held(), [packet(newer, 4, 1)]).memory.received[0]
        ?.claim,
    ).toEqual(newer);
    expect(
      choose(policy, 4, held(), [], [0, 1]).memory.received[0]?.claim,
    ).toBeNull();
  }
  const late = choose(efrNoExpiryPolicy, 6, held(), [
    packet({ kind: "release", target: 1, issuedTick: 1 }, 6, 1),
  ]);
  expect(late.memory.received[0]?.claim).toBeNull();
});

it("sends pending claims and completion releases beyond their nominal deadline", () => {
  const cfg = {
    ...config,
    agentCount: 3,
    efr: { ttl: 1 },
    failures: [],
    communication: { ...radio, maxOutbound: 1 },
  };
  const result = runTicks(
    initialize(cfg, efrNoExpiryPolicy, corridor).state,
    16,
    efrNoExpiryPolicy,
  );
  const lateClaims = result.events.filter(
    (e) =>
      e.kind === "message-sent" &&
      e.message.from === 0 &&
      e.message.payload.kind === "claim" &&
      e.message.payload.target === 6 &&
      e.tick >= e.message.payload.expiresTick,
  );
  expect(lateClaims.length).toBeGreaterThan(0);
  expect(result.events).toContainEqual(
    expect.objectContaining({
      kind: "message-delivered",
      message: expect.objectContaining({
        from: 0,
        payload: { kind: "claim", target: 6, issuedTick: 6, expiresTick: 7 },
      }),
    }),
  );
  expect(result.events).toContainEqual(
    expect.objectContaining({
      kind: "message-sent",
      tick: 12,
      message: expect.objectContaining({
        from: 0,
        payload: { kind: "release", target: 6, issuedTick: 6 },
      }),
    }),
  );
  expect(result.events.filter((e) => e.kind === "message-rejected")).toEqual(
    [],
  );
  for (const agent of result.state.agents)
    expect(agent.efr!.pending.every((row) => row.length <= 2)).toBe(true);
});

it.each([efrPolicy, efrNoExpiryPolicy])(
  "preserves failure suppression, loss and exhaustion for $version",
  (policy) => {
    const allFailed = initialize(
      {
        ...config,
        failures: [
          { agentId: 0, tick: 0 },
          { agentId: 1, tick: 0 },
        ],
      },
      policy,
      corridor,
    );
    const after = runTicks(allFailed.state, 8, policy);
    expect(after.state.tick).toBe(8);
    expect(after.events).toEqual([]);
    expect(after.state.agents).toEqual(allFailed.state.agents);
    const lost = runTicks(
      initialize(
        { ...config, failures: [], communication: { ...radio, loss: 1 } },
        policy,
        corridor,
      ).state,
      16,
      policy,
    );
    expect(lost.events.some((e) => e.kind === "message-delivered")).toBe(false);
    expect(
      lost.events.some(
        (e) => e.kind === "message-dropped" && e.reason === "loss",
      ),
    ).toBe(true);
    const idle = runTicks(
      initialize({ ...config, nodeCount: 1, failures: [] }, policy).state,
      3,
      policy,
    );
    expect(idle.events).toHaveLength(6);
    expect(idle.events.every((e) => e.kind === "waited")).toBe(true);
  },
);

it("retains conflict priority and bounded waiting for overlapping permanent claims", () => {
  const claims = {
    ...held(),
    received: [
      held().received[0]!,
      {
        seq: 0,
        latestIssue: 2,
        claim: { ...lease, issuedTick: 2, expiresTick: 6 },
      },
      null,
    ],
  };
  const result = choose(efrNoExpiryPolicy, 10, claims, [], [0, 3]);
  expect(result.action.kind).toBe("wait");
  expect(result.memory.received.filter((e) => e?.claim)).toHaveLength(2);
  const own = {
    ...emptyEfr(3),
    own: { ...lease, issuedTick: 2, expiresTick: 6 },
  };
  const earlier = choose(efrNoExpiryPolicy, 10, own, [packet(lease, 10)]);
  expect(earlier.memory.own?.target).toBe(3);
  const tied = choose(efrNoExpiryPolicy, 10, { ...own, own: lease }, [
    packet(lease, 10),
  ]);
  expect(tied.memory.own?.target).toBe(3);
});
