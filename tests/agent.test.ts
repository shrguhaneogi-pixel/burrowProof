import { expect, it } from "vitest";
import { arrive, observe, spawnAgent, firstNeighbor } from "../src/sim/agent";
import { createWorld } from "../src/sim/graph";
it("senses incident edges once and keeps agent histories separate", () => {
  const left = spawnAgent(0, 0, [1, 2]),
    right = spawnAgent(1, 0, [1, 2]);
  const moved = arrive(left, 1, [0, 3]);
  expect(moved.knowledge).toEqual({
    visited: [0, 1],
    adjacency: { 0: [1, 2], 1: [0, 3], 2: [0], 3: [1] },
  });
  expect(arrive(moved, 1, [0, 3])).toEqual(moved);
  expect(left.knowledge).toEqual(right.knowledge);
  expect(observe(right).adjacency[3]).toBeUndefined();
});
it("uses detached planner values with no unexplored graph references", () => {
  const world = createWorld([[1], [0, 2], [1]]);
  const agent = spawnAgent(0, 0, world.adjacency[0]!);
  const view = observe(agent);
  expect(view).toEqual({
    id: 0,
    position: 0,
    visited: [0],
    adjacency: { 0: [1], 1: [0] },
  });
  expect(view.visited).not.toBe(agent.knowledge.visited);
  expect(view.adjacency).not.toBe(agent.knowledge.adjacency);
  for (const id of [0, 1]) {
    expect(view.adjacency[id]).not.toBe(agent.knowledge.adjacency[id]);
    expect(view.adjacency[id]).not.toBe(world.adjacency[id]);
  }
  expect(() => Object.assign(view.adjacency[0]!, { 0: 99 })).toThrow();
});
it("makes the same real decision across a hidden edge mutation", () => {
  const a = createWorld([[1], [0, 2], [1, 3], [2]]);
  const b = createWorld([[1], [0, 2, 3], [1], [1]]);
  const views = [a, b].map((w) => observe(spawnAgent(0, 0, w.adjacency[0]!)));
  expect(views[0]).toEqual(views[1]);
  expect(firstNeighbor(views[0]!, 42)).toEqual(firstNeighbor(views[1]!, 42));
  expect(firstNeighbor(observe(spawnAgent(0, 0, [])), 42)).toEqual({
    kind: "wait",
  });
});
