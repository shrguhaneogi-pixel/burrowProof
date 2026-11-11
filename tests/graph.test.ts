import { expect, it } from "vitest";
import { createWorld, generateWorld, type Scenario } from "../src/sim/graph";
import { draw, streamSeed } from "../src/sim/rng";
const families: Scenario[] = ["branching", "loop-heavy", "bottleneck-heavy"];
function reachable(
  rows: readonly (readonly number[])[],
  skipA = -1,
  skipB = -1,
) {
  const seen = new Set([0]),
    pending = [0];
  while (pending.length) {
    const id = pending.pop()!;
    for (const n of rows[id]!) {
      if (
        (id === skipA && n === skipB) ||
        (id === skipB && n === skipA) ||
        seen.has(n)
      )
        continue;
      seen.add(n);
      pending.push(n);
    }
  }
  return seen.size;
}
const cases = families.flatMap((family) =>
  Array.from({ length: 200 }, (_, seed) => ({ family, seed })),
);
it.each(cases)("validates $family seed=$seed", ({ family, seed }) => {
  const count = 1 + (seed % 23);
  const { adjacency: rows, entrance } = generateWorld(seed, family, count);
  const context = `${family} seed=${seed}`;
  draw(streamSeed(seed, "policy/0"));
  expect(generateWorld(seed, family, count).adjacency, context).toEqual(rows);
  expect(entrance).toBe(0);
  expect(rows.length, context).toBe(count);
  expect(reachable(rows), context).toBe(count);
  let edgeCount = 0;
  let bridges = 0;
  for (const [a, row] of rows.entries()) {
    expect(row, context).toEqual([...new Set(row)].sort((x, y) => x - y));
    for (const b of row) {
      expect(b, context).not.toBe(a);
      expect(rows[b], context).toContain(a);
      if (a < b) {
        edgeCount++;
        if (family === "bottleneck-heavy" && reachable(rows, a, b) < count)
          bridges++;
      }
    }
  }
  if (family === "branching") expect(edgeCount, context).toBe(count - 1);
  if (family === "loop-heavy" && count >= 4)
    expect(edgeCount, context).toBeGreaterThan(count);
  if (family === "bottleneck-heavy")
    expect(bridges, context).toBe(
      Math.floor((count - 1) / 3) + Number(count % 3 === 2),
    );
});
it("rejects invalid topologies and generator inputs", () => {
  for (const rows of [[], [[0]], [[1]], [[1], []], [[1, 1], [0]], [[], []]])
    expect(() => createWorld(rows)).toThrow();
  for (const count of [0, -1, 1.5, 4097, NaN])
    expect(() => generateWorld(0, "branching", count)).toThrow();
  expect(() => generateWorld(1, "unknown" as Scenario, 2)).toThrow();
});
it("detaches validated topology from its input", () => {
  const rows = [[1], [0]];
  const world = createWorld(rows);
  rows[0]!.pop();
  expect(world.adjacency[0]).toEqual([1]);
  expect(Object.isFrozen(world.adjacency[0])).toBe(true);
});
