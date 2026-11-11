import type { Policy } from "./engine";
import { frontierRoutes } from "./frontiers";

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
    const route = frontierRoutes(view).next();
    if (route.done || route.value.target === view.position)
      return { kind: "wait" };
    return { kind: "move", to: route.value.firstStep };
  },
});
