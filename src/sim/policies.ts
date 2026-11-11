import type { Policy } from "./engine";

export const randomWalkPolicy = Object.freeze<Policy>({
  version: "random-walk.1",
  decide(view, policyDraw) {
    const neighbors = [...(view.adjacency[view.position] ?? [])].sort(
      (a, b) => a - b,
    );
    if (neighbors.length === 0) return { kind: "wait" };
    const index = Math.floor((policyDraw / 0x100000000) * neighbors.length);
    return { kind: "move", to: neighbors[index]! };
  },
});
