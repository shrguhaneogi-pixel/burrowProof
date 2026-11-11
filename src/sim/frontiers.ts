import type { AgentView } from "./agent";

export interface FrontierRoute {
  readonly target: number;
  readonly distance: number;
  readonly firstStep: number;
}

// Yield in target preference order. Discovery order within BFS chooses the route.
export function* frontierRoutes(
  view: AgentView,
): Generator<FrontierRoute, void> {
  const visited = new Set(view.visited);
  const firstSteps = new Map([[view.position, view.position]]);
  let layer = [view.position];
  for (let distance = 0; layer.length; distance++) {
    const frontiers = layer
      .filter((node) => !visited.has(node))
      .sort((a, b) => a - b);
    for (const target of frontiers) {
      yield { target, distance, firstStep: firstSteps.get(target)! };
    }
    const nextLayer: number[] = [];
    for (const node of layer) {
      const neighbors = [...(view.adjacency[node] ?? [])].sort((a, b) => a - b);
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
}
