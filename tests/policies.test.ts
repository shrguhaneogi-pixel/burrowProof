import { describe, expect, it } from "vitest";
import type { Action, AgentView } from "../src/sim/agent";
import {
  initialize,
  runTicks,
  step,
  type Policy,
  type SimEvent,
} from "../src/sim/engine";
import { createWorld, type Scenario } from "../src/sim/graph";
import { randomWalkPolicy, nearestFrontierPolicy } from "../src/sim/policies";
import { serializeState, stateHash } from "../src/sim/state-hash";

const policies = [randomWalkPolicy, nearestFrontierPolicy];
const families: Scenario[] = ["branching", "loop-heavy", "bottleneck-heavy"];
const seeds = Array.from({ length: 200 }, (_, seed) => seed);
const cases = families.flatMap((scenario) =>
  seeds.map((seed) => ({ scenario, seed })),
);

it.each([
  [0, 2],
  [0x80000000, 4],
  [0xffffffff, 8],
])("random walk maps draw %i to sorted neighbor %i", (draw, to) => {
  const view: AgentView = {
    id: 0,
    position: 0,
    visited: [0, 2, 4, 8],
    adjacency: { 0: [8, 2, 4] },
  };
  const snapshot = JSON.stringify(view);
  expect(randomWalkPolicy.decide(view, draw)).toEqual({ kind: "move", to });
  expect(JSON.stringify(view)).toBe(snapshot);
});

it("random walk waits without neighbors and uses its sole available edge", () => {
  expect(
    randomWalkPolicy.decide(
      { id: 0, position: 0, visited: [0], adjacency: {} },
      0,
    ),
  ).toEqual({ kind: "wait" });
  expect(
    randomWalkPolicy.decide(
      { id: 0, position: 0, visited: [0, 1], adjacency: { 0: [1], 1: [0] } },
      0xffffffff,
    ),
  ).toEqual({ kind: "move", to: 1 });
});

it.each([
  {
    name: "distance takes precedence over target ID",
    position: 0,
    visited: [0, 1],
    adjacency: { 0: [1, 9], 1: [0, 2], 2: [1], 9: [0] },
    action: { kind: "move", to: 9 },
  },
  {
    name: "lowest frontier ID wins within the same distance",
    position: 0,
    visited: [0, 1, 2],
    adjacency: { 0: [2, 1], 1: [0, 8], 2: [0, 3], 3: [2], 8: [1] },
    action: { kind: "move", to: 2 },
  },
  {
    name: "ordered BFS resolves equal routes to the same frontier",
    position: 0,
    visited: [0, 1, 2],
    adjacency: { 0: [2, 1], 1: [0, 7], 2: [0, 7], 7: [2, 1] },
    action: { kind: "move", to: 1 },
  },
  {
    name: "backtrack along a visited corridor",
    position: 3,
    visited: [0, 1, 3],
    adjacency: { 0: [1, 2], 1: [0, 3], 2: [0], 3: [1] },
    action: { kind: "move", to: 1 },
  },
  {
    name: "wait when the only frontier is disconnected",
    position: 0,
    visited: [0],
    adjacency: { 0: [], 4: [] },
    action: { kind: "wait" },
  },
  {
    name: "wait on an exhausted local map",
    position: 0,
    visited: [0, 1],
    adjacency: { 0: [1], 1: [0] },
    action: { kind: "wait" },
  },
  {
    name: "wait with missing local adjacency",
    position: 0,
    visited: [0],
    adjacency: {},
    action: { kind: "wait" },
  },
])(
  "nearest frontier will $name",
  ({ position, visited, adjacency, action }) => {
    const view: AgentView = { id: 0, position, visited, adjacency };
    const snapshot = JSON.stringify(view);
    expect(nearestFrontierPolicy.decide(view, 0)).toEqual(action);
    expect(nearestFrontierPolicy.decide(view, 0xffffffff)).toEqual(action);
    expect(JSON.stringify(view)).toBe(snapshot);
  },
);

for (const policy of policies) {
  describe(policy.version, () => {
    it("exports a frozen policy", () =>
      expect(Object.isFrozen(policy)).toBe(true));

    it("keeps agent zero's route independent of the presence of other agents", () => {
      const config = {
        seed: 42,
        scenario: "loop-heavy" as const,
        nodeCount: 10,
        agentCount: 1,
      };
      const alone = initialize(config, policy).state;
      const together = initialize({ ...config, agentCount: 3 }, policy).state;
      const soloRun = runTicks(alone, 25, policy);
      const swarmRun = runTicks(together, 25, policy);
      expect(swarmRun.events.filter((event) => event.agentId === 0)).toEqual(
        soloRun.events,
      );
      expect(swarmRun.state.agents[0]).toEqual(soloRun.state.agents[0]);
    });

    it.each(cases)(
      "preserves I2/I3/I8 for $scenario seed=$seed",
      ({ scenario, seed }) => {
        const nodeCount = 1 + (seed % 8);
        const config = {
          seed,
          scenario,
          nodeCount,
          agentCount: 1 + (seed % 3),
        };
        const cap =
          policy.version === "nearest-frontier.1"
            ? nodeCount * (nodeCount - 1)
            : 64;
        const initial = initialize(config, policy);
        const snapshot = serializeState(initial.state);
        let single = initial.state;
        const events: SimEvent[] = [];
        for (let tick = 1; tick <= cap; tick++) {
          const before = single;
          const result = step(before, policy);
          const context = `${policy.version} ${scenario} seed=${seed} tick=${tick}`;
          for (const event of result.events) {
            expect(event.kind, context).not.toBe("rejected");
            if (event.kind === "moved") {
              expect(
                before.agents[event.agentId]!.knowledge.adjacency[event.from],
                context,
              ).toContain(event.to);
              expect(before.world.adjacency[event.from], context).toContain(
                event.to,
              );
            }
          }
          single = result.state;
          events.push(...result.events);
        }
        const fresh = initialize(config, policy);
        expect(fresh.events).toEqual(initial.events);
        const batch = runTicks(fresh.state, cap, policy);
        let chunked = initialize(config, policy).state;
        const chunkEvents: SimEvent[] = [];
        const half = Math.floor(cap / 2);
        for (const count of [half, 0, cap - half]) {
          const next = runTicks(chunked, count, policy);
          chunked = next.state;
          chunkEvents.push(...next.events);
        }
        for (const [state, log] of [
          [batch.state, batch.events],
          [chunked, chunkEvents],
        ] as const) {
          expect(JSON.stringify(log)).toBe(JSON.stringify(events));
          expect(serializeState(state)).toBe(serializeState(single));
          expect(stateHash(state)).toBe(stateHash(single));
        }
        expect(serializeState(initial.state)).toBe(snapshot);
        if (policy.version === "nearest-frontier.1") {
          for (const agent of single.agents)
            expect(agent.knowledge.visited).toHaveLength(nodeCount);
          expect(
            step(single, policy).events.every(
              (event) => event.kind === "waited",
            ),
          ).toBe(true);
        }
      },
    );

    it.each(seeds)(
      "preserves I1 through real planner calls, seed=%i",
      (seed) => {
        const worlds = [
          createWorld([[1], [0, 2], [1, 3], [2, 4], [3]]),
          createWorld([[1], [0, 2], [1, 3, 4], [2, 4], [2, 3]]),
        ];
        const traces = worlds.map((world) => {
          const trace: { view: AgentView; draw: number; action: Action }[] = [];
          const recording: Policy = {
            version: policy.version,
            decide(view, draw) {
              const action: Action =
                view.id === 0 ? policy.decide(view, draw) : { kind: "wait" };
              trace.push({ view, draw, action });
              return action;
            },
          };
          const start = initialize(
            { seed, scenario: "branching", nodeCount: 5, agentCount: 2 },
            recording,
            world,
          );
          runTicks(start.state, 64, recording);
          return trace;
        });
        let firstDifference: number | undefined;
        for (let i = 0; i < traces[0]!.length; i += 2) {
          const left = traces[0]![i]!,
            right = traces[1]![i]!;
          const context = `${policy.version} seed=${seed} tick=${i / 2 + 1}`;
          if (firstDifference === undefined) {
            expect(left.draw, context).toBe(right.draw);
            if (JSON.stringify(left.view) === JSON.stringify(right.view)) {
              expect(left.action, context).toEqual(right.action);
            } else {
              firstDifference = i;
              expect(left.view.position, context).toBe(2);
              expect(left.view.adjacency[2], context).not.toEqual(
                right.view.adjacency[2],
              );
            }
          }
          expect(traces[0]![i + 1], context).toEqual(traces[1]![i + 1]);
          expect(traces[0]![i + 1]!.view.adjacency, context).toEqual({
            0: [1],
            1: [0],
          });
        }
        // The frontier policy reaches the changed incident edge within this cap.
        if (policy.version === "nearest-frontier.1")
          expect(firstDifference).toBeDefined();
      },
    );
  });
}
