import { expect, it } from "vitest";
import { efrPolicy } from "../src/sim/efr";
import type { Payload } from "../src/sim/comms";
import {
  initialize,
  runTicks,
  step,
  type Config,
  type Policy,
  type SimEvent,
  type SimState,
} from "../src/sim/engine";
import { serializeState, stateHash } from "../src/sim/state-hash";

const config: Config = {
  seed: 3,
  scenario: "branching",
  nodeCount: 14,
  agentCount: 3,
  communication: {
    range: 5,
    delay: 2,
    loss: 0,
    maxBytes: 512,
    maxQueue: 32,
    maxOutbound: 3,
  },
  failures: [{ agentId: 0, tick: 4 }],
};

function checkpoint() {
  const initial = initialize(config, efrPolicy);
  return step(initial.state, efrPolicy).state;
}

function continueInBatches(initial: SimState) {
  let state = initial;
  const events: SimEvent[] = [];
  for (const count of [2, 0, 3, 5]) {
    const next = runTicks(state, count, efrPolicy);
    events.push(...next.events);
    state = next.state;
  }
  return { events, state };
}

// A trusted JSON round trip that varies only the order of object members.
function reverseMembers<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).reverse())
      : item,
  );
}

it("keeps the 1b.4 checksum when a JSON checkpoint reorders radio settings", () => {
  const initial = checkpoint();
  const restored: SimState = JSON.parse(
    JSON.stringify(initial),
    (key, value) =>
      key === "communication"
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
  );
  expect(initial.transport?.queue).toHaveLength(6);
  expect(stateHash(initial)).toBe("0873984e");
  expect(serializeState(restored)).toBe(serializeState(initial));
  expect(stateHash(restored)).toBe("0873984e");

  const reference = runTicks(initial, 10, efrPolicy);
  const resumed = continueInBatches(restored);
  expect(JSON.stringify(resumed.events)).toBe(JSON.stringify(reference.events));
  expect(serializeState(resumed.state)).toBe(serializeState(reference.state));
  expect(stateHash(resumed.state)).toBe("b99ee82f");
});

it("resumes in-flight claims with byte-identical delivery events", () => {
  const initial = checkpoint();
  const reference = runTicks(initial, 10, efrPolicy);
  const firstDelivery = reference.events.find(
    (e) => e.kind === "message-delivered",
  );
  expect(JSON.stringify(firstDelivery)).toBe(
    '{"kind":"message-delivered","tick":3,"agentId":1,"message":{"from":0,"to":1,"seq":0,"sentTick":1,"dueTick":3,"payload":{"kind":"claim","target":1,"issuedTick":1,"expiresTick":17}},"bytes":26}',
  );
  const resumed = continueInBatches(reverseMembers(initial));
  expect(JSON.stringify(resumed.events)).toBe(JSON.stringify(reference.events));
  expect(serializeState(resumed.state)).toBe(serializeState(reference.state));
  expect(stateHash(resumed.state)).toBe("b99ee82f");
});

it.each([false, true])(
  "preserves event bytes for all payloads (recipient failed: %s)",
  (failed) => {
    function run(reordered: boolean) {
      const policy: Policy = {
        version: "transport-replay-fixture",
        decide(view) {
          if (view.tick !== 1 || view.id !== 0) return { kind: "wait" };
          const neighbors = view.adjacency[view.position]!;
          const target = neighbors[0]!;
          const payloads: Payload[] = [
            { kind: "observation", node: view.position, neighbors },
            { kind: "claim", target, issuedTick: 1, expiresTick: 17 },
            { kind: "release", target, issuedTick: 1 },
          ];
          return {
            kind: "wait",
            outbound: payloads.map((payload, seq) => ({
              to: 1,
              seq,
              payload: reordered ? reverseMembers(payload) : payload,
            })),
          };
        },
      };
      const failures = failed ? [{ agentId: 1, tick: 3 }] : [];
      const sent = step(
        initialize({ ...config, failures }, policy).state,
        policy,
      );
      const due = runTicks(
        reordered ? reverseMembers(sent.state) : sent.state,
        2,
        policy,
      );
      return [...sent.events, ...due.events];
    }
    const events = run(false);
    const outcomes = events.flatMap((e) =>
      (e.kind === "message-delivered" && !failed) ||
      (e.kind === "message-dropped" &&
        failed &&
        e.reason === "recipient-failed")
        ? [e.message.payload.kind]
        : [],
    );
    expect(outcomes).toEqual(["observation", "claim", "release"]);
    expect(JSON.stringify(run(true))).toBe(JSON.stringify(events));
  },
);
