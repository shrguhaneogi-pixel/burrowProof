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

export const nearestFrontierPolicy = Object.freeze<Policy>({
  version: "nearest-frontier.1",
  decide(view) {
    const visited = new Set(view.visited);
    const firstSteps = new Map([[view.position, view.position]]);
    let layer = [view.position];
    while (layer.length > 0) {
      // All nodes in a layer have the same distance. Target ID breaks ties.
      const frontiers = layer.filter((node) => !visited.has(node));
      if (frontiers.length > 0) {
        const target = Math.min(...frontiers);
        if (target === view.position) return { kind: "wait" };
        return { kind: "move", to: firstSteps.get(target)! };
      }
      const nextLayer: number[] = [];
      for (const node of layer) {
        const neighbors = [...(view.adjacency[node] ?? [])].sort(
          (a, b) => a - b,
        );
        for (const neighbor of neighbors) {
          if (firstSteps.has(neighbor)) continue;
          firstSteps.set(
            neighbor,
            node === view.position ? neighbor : firstSteps.get(node)!,
          );
          nextLayer.push(neighbor);
        }
      }
      layer = nextLayer;
    }
    return { kind: "wait" };
  },
});
