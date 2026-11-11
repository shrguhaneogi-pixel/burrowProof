import { expect, it } from "vitest";
import { efrPolicy } from "../src/sim/efr";
import {
  initialize,
  runTicks,
  step,
  type SimEvent,
  type SimState,
} from "../src/sim/engine";
import { serializeState, stateHash } from "../src/sim/state-hash";

function checkpoint() {
  const initial = initialize(
    {
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
    },
    efrPolicy,
  );
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
