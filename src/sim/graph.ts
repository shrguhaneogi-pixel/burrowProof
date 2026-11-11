import { draw, streamSeed } from "./rng";

export type Scenario = "branching" | "loop-heavy" | "bottleneck-heavy";
export interface World {
  readonly entrance: 0;
  readonly adjacency: readonly (readonly number[])[];
}

const maxNodes = 4096;
function checkCount(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > maxNodes) {
    throw new RangeError("Node count must be an integer from 1 to 4096");
  }
}

// Node IDs are row indices. Copy before freezing so callers retain their inputs.
export function createWorld(rows: readonly (readonly number[])[]): World {
  checkCount(rows.length);
  const edges = Array.from(rows, (row, id) => {
    if (!Array.isArray(row)) throw new TypeError("Missing adjacency row");
    const neighbors = new Set<number>();
    for (const next of row) {
      if (
        !Number.isInteger(next) ||
        next < 0 ||
        next >= rows.length ||
        next === id ||
        neighbors.has(next)
      ) {
        throw new RangeError("Invalid or duplicate edge");
      }
      neighbors.add(next);
    }
    return neighbors;
  });
  for (const [id, neighbors] of edges.entries()) {
    for (const next of neighbors) {
      if (!edges[next]!.has(id)) throw new RangeError("Asymmetric edge");
    }
  }
  const reached = new Set([0]);
  const queue = [0];
  for (let i = 0; i < queue.length; i++) {
    for (const next of edges[queue[i]!]!) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  if (reached.size !== rows.length) throw new RangeError("Disconnected world");
  const adjacency = edges.map((row) =>
    Object.freeze([...row].sort((a, b) => a - b)),
  );
  return Object.freeze({ entrance: 0, adjacency: Object.freeze(adjacency) });
}

export function generateWorld(
  seed: number,
  scenario: Scenario,
  count: number,
): World {
  checkCount(count);
  let rng = streamSeed(seed, "world");
  function pick(limit: number) {
    const sample = draw(rng);
    rng = sample.state;
    return Math.floor((sample.value / 0x100000000) * limit);
  }
  // Permute construction order so a chamber or parent isn't encoded in the ID.
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = pick(i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const rows = order.map(() => new Set<number>());
  function link(i: number, j: number) {
    const a = order[i]!,
      b = order[j]!;
    rows[a]!.add(b);
    rows[b]!.add(a);
  }
  switch (scenario) {
    case "branching":
      for (let i = 1; i < count; i++) link(i, pick(i));
      break;
    case "loop-heavy":
      for (let i = 1; i < count; i++) link(i - 1, i);
      if (count > 2) link(0, count - 1);
      if (count > 3) {
        for (let i = 0; i < count; i++)
          link(i, (i + 2 + pick(count - 3)) % count);
      }
      break;
    case "bottleneck-heavy":
      // Consecutive triangles share one bridge; the final chamber may be smaller.
      for (let i = 1; i < count; i++) {
        link(i - 1, i);
        if (i % 3 === 2) link(i - 2, i);
      }
      break;
    default:
      throw new RangeError("Unknown scenario");
  }
  return createWorld(rows.map((row) => [...row]));
}
