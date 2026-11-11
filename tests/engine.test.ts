import { expect, it } from "vitest";
import { firstNeighbor, type AgentView, type Action } from "../src/sim/agent";
import { createWorld, generateWorld, type Scenario } from "../src/sim/graph";
import {
  initialize,
  step,
  runTicks,
  type Config,
  type Policy,
  type SimEvent,
} from "../src/sim/engine";
import { serializeState, stateHash } from "../src/sim/state-hash";

const seeds = Array.from({ length: 200 }, (_, i) => i);
const families: Scenario[] = ["branching", "loop-heavy", "bottleneck-heavy"];
function config(seed: number): Config {
  return {
    seed,
    scenario: families[seed % 3]!,
    nodeCount: 1 + (seed % 18),
    agentCount: 1 + (seed % 3),
  };
}
// Exercise private random inputs at the caller boundary, including moves beyond the first edge.
const probe: Policy = {
  version: "test-probe.1",
  decide(view, sample) {
    const options = view.adjacency[view.position]!;
    return options.length
      ? { kind: "move", to: options[sample % options.length]! }
      : { kind: "wait" };
  },
};

it.each(seeds)("I2/I3/I8 independent traces, seed=%i", (seed) => {
  const cfg = config(seed);
  const start = initialize(cfg, probe);
  const fresh = initialize({ ...cfg }, probe);
  expect(fresh.events).toEqual(start.events);
  const initialBytes = serializeState(start.state);
  const topology = JSON.stringify(start.state.world);
  const histories = start.state.agents.map(() => new Set<number>([0]));
  const positions = start.state.agents.map(() => 0);
  let single = start.state;
  const events: SimEvent[] = [];
  for (let tick = 1; tick <= 12; tick++) {
    const before = single;
    const snapshot = serializeState(before);
    const next = step(before, probe);
    const context = `seed=${seed} tick=${tick}`;
    expect(serializeState(before), context).toBe(snapshot);
    expect(next.state.tick, context).toBe(tick);
    for (const e of next.events) {
      expect(e.tick, context).toBe(tick);
      const previous = before.agents[e.agentId]!;
      if (e.kind === "moved") {
        expect(e.from, context).toBe(positions[e.agentId]);
        positions[e.agentId] = e.to;
        histories[e.agentId]!.add(e.to);
        expect(e.from, context).toBe(previous.position);
        expect(previous.knowledge.adjacency[e.from], context).toContain(e.to);
        expect(before.world.adjacency[e.from], context).toContain(e.to);
        expect(next.state.agents[e.agentId]!.position, context).toBe(e.to);
      }
    }
    // Derive the complete allowed map from the independent visited-position history.
    for (const agent of next.state.agents) {
      expect(agent.position, context).toBe(positions[agent.id]);
      const history = histories[agent.id]!;
      const allowed: Record<number, Set<number>> = {};
      for (const visited of history) {
        allowed[visited] ??= new Set();
        for (const neighbor of before.world.adjacency[visited]!) {
          allowed[visited]!.add(neighbor);
          (allowed[neighbor] ??= new Set()).add(visited);
        }
      }
      expect(agent.knowledge.visited, context).toEqual(
        [...history].sort((a, b) => a - b),
      );
      const adjacency = Object.fromEntries(
        Object.entries(allowed).map(([id, row]) => [
          id,
          [...row].sort((a, b) => a - b),
        ]),
      );
      expect(agent.knowledge.adjacency, context).toEqual(adjacency);
    }
    events.push(...next.events);
    single = next.state;
  }
  const batch = runTicks(fresh.state, 12, probe);
  const empty = runTicks(start.state, 0, probe);
  expect(empty).toEqual({ state: start.state, events: [] });
  let chunked = empty.state;
  const chunkEvents: SimEvent[] = [];
  for (const count of [3, 0, 1, 8]) {
    const next = runTicks(chunked, count, probe);
    chunkEvents.push(...next.events);
    chunked = next.state;
  }
  // Locate the first mismatching tick as well as checking the full wire bytes.
  for (let tick = 1; tick <= 12; tick++) {
    const expected = events.filter((e) => e.tick === tick);
    expect(
      batch.events.filter((e) => e.tick === tick),
      `seed=${seed} tick=${tick}`,
    ).toEqual(expected);
    expect(
      chunkEvents.filter((e) => e.tick === tick),
      `seed=${seed} tick=${tick}`,
    ).toEqual(expected);
  }
  for (const [state, log] of [
    [batch.state, batch.events],
    [chunked, chunkEvents],
  ] as const) {
    expect(JSON.stringify(log)).toBe(JSON.stringify(events));
    expect(serializeState(state)).toBe(serializeState(single));
    expect(stateHash(state)).toBe(stateHash(single));
  }
  expect(serializeState(start.state)).toBe(initialBytes);
  expect(JSON.stringify(single.world)).toBe(topology);
});

it.each(seeds)("I1 hidden-world canary on actual step, seed=%i", (seed) => {
  const tail = generateWorld(
    seed,
    families[seed % 3]!,
    4 + (seed % 9),
  ).adjacency;
  const rows = [
    [1],
    [0, 2],
    [1, 3],
    ...tail.map((row) => row.map((n) => n + 3)),
  ];
  rows[3]!.push(2);
  const worlds = [createWorld(rows)];
  const hidden = 4 + (seed % (tail.length - 1));
  rows[2]!.push(hidden);
  rows[hidden]!.push(2);
  worlds.push(createWorld(rows));
  const traces = worlds.map((world) => {
    const trace: {
      tick: number;
      view: AgentView;
      draw: number;
      action: Action;
    }[] = [];
    let tick = 0;
    const policy: Policy = {
      version: "test-canary.1",
      decide(view, draw) {
        const options = view.adjacency[view.position]!;
        const action: Action =
          view.id === 1
            ? { kind: "wait" }
            : { kind: "move", to: options[options.length - 1]! };
        trace.push({ tick, view, draw, action });
        return action;
      },
    };
    let state = initialize(
      { ...config(seed), nodeCount: rows.length, agentCount: 2 },
      policy,
      world,
    ).state;
    for (tick = 1; tick <= 3; tick++) state = step(state, policy).state;
    return trace;
  });
  const [a, b] = traces;
  for (let i = 0; i < 4; i++)
    expect(a![i], `seed=${seed} tick=${a![i]!.tick}`).toEqual(b![i]);
  // At tick 3 agent 0 has arrived at the changed edge. Agent 1 stayed at the entrance.
  expect(a![4]!.view.adjacency[2]).not.toEqual(b![4]!.view.adjacency[2]);
  expect(a![4]!.action).not.toEqual(b![4]!.action);
  expect(a![5]).toEqual(b![5]);
  expect(a![5]!.view.adjacency).toEqual({ 0: [1], 1: [0] });
});

it("orders decisions before arrivals, permits co-location and rejects unseen or nonincident moves", () => {
  const world = createWorld([[1], [0, 2], [1]]);
  const cfg = { ...config(0), nodeCount: 3, agentCount: 2 };
  const initial = initialize(cfg, undefined, world).state;
  const moved = step({ ...initial, agents: [...initial.agents].reverse() });
  expect(moved.events.map((e) => [e.kind, e.agentId])).toEqual([
    ["moved", 0],
    ["moved", 1],
    ["sensed", 0],
    ["sensed", 1],
  ]);
  expect(moved.state.agents.map((a) => a.position)).toEqual([1, 1]);
  const policy: Policy = {
    version: "test-invalid.1",
    decide: (view) =>
      view.position === 1 ? { kind: "move", to: 0 } : { kind: "move", to: 2 },
  };
  const unseen = initialize(cfg, policy, world).state;
  const rejected = step(unseen, policy);
  expect(rejected.events[0]).toMatchObject({
    kind: "rejected",
    to: 2,
    reason: "unknown-edge",
  });
  expect(rejected.state.agents[0]!.knowledge).toEqual(
    unseen.agents[0]!.knowledge,
  );
  // Visit 1 then return to 0. Node 2 is known, but there is no 0--2 edge.
  const travel: Policy = {
    version: "test-travel.1",
    decide(view, draw) {
      return view.visited.length === 2 && view.position === 0
        ? { kind: "move", to: 2 }
        : firstNeighbor(view, draw);
    },
  };
  const previous = runTicks(
    initialize(cfg, travel, world).state,
    2,
    travel,
  ).state;
  expect(previous.agents[0]!.knowledge.adjacency[2]).toEqual([1]);
  const result = step(previous, travel);
  expect(result.events[0]).toMatchObject({ kind: "rejected", at: 0, to: 2 });
  expect(result.state.agents[0]!.position).toBe(0);
});

it("validates the environment even if local knowledge is inconsistent", () => {
  const state = initialize(
    { ...config(1), nodeCount: 3, agentCount: 1 },
    probe,
    createWorld([[1], [0, 2], [1]]),
  ).state;
  const agent = state.agents[0]!;
  const inconsistent = {
    ...state,
    agents: [
      { ...agent, knowledge: { visited: [0], adjacency: { 0: [2], 2: [0] } } },
    ],
  };
  expect(step(inconsistent, probe).events[0]).toMatchObject({
    kind: "rejected",
    reason: "missing-edge",
  });
});

it("waits on singleton worlds and rejects invalid configuration and transition arguments", () => {
  const state = initialize(config(0)).state;
  expect(step(state).events).toEqual([
    { tick: 1, agentId: 0, kind: "waited", at: 0 },
  ]);
  expect(() => step(state, probe)).toThrow(/version/);
  for (const count of [-1, 1.5, NaN])
    expect(() => runTicks(state, count)).toThrow();
  for (const agentCount of [0, 257, 1.5])
    expect(() => initialize({ ...config(0), agentCount })).toThrow();
  expect(() =>
    initialize(config(0), undefined, createWorld([[1], [0]])),
  ).toThrow();
});
it("pins the versioned singleton serialization and checksum", () => {
  const { state, events } = initialize(config(0));
  expect(events).toEqual([
    { tick: 0, agentId: 0, kind: "sensed", at: 0, neighbors: [] },
  ]);
  expect(serializeState(state)).toBe(
    '["1b.3","first-neighbor.1",[0,"branching",1,1,[]],0,0,[[]],[[0,0,1762688832,[0],[[0,[]]],"active",null]]]',
  );
  expect(stateHash(state)).toBe("0cdd905f");
  expect(stateHash(step(state).state)).not.toBe(stateHash(state));
});
it("records a malformed move without contaminating the next state", () => {
  const invalid: Policy = {
    version: "test-nan.1",
    decide: () => ({ kind: "move", to: NaN }),
  };
  const initial = initialize(config(0), invalid).state;
  const next = step(initial, invalid);
  expect(next.events).toEqual([
    {
      tick: 1,
      agentId: 0,
      kind: "rejected",
      at: 0,
      to: null,
      reason: "invalid-action",
    },
  ]);
  expect(next.state.agents[0]!.knowledge).toEqual(initial.agents[0]!.knowledge);
});
