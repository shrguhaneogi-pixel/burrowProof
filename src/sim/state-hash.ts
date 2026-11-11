import { ENGINE_VERSION, type SimState } from "./engine";

// Fixed tuple order is the serialization contract. Node IDs and neighbor rows
// are canonical at construction; local maps use explicit numeric node order.
export function serializeState(state: SimState): string {
  const { seed, scenario, nodeCount, agentCount } = state.config;
  const robots = [...state.agents]
    .sort((a, b) => a.id - b.id)
    .map((agent) => {
      const { adjacency, visited } = agent.knowledge;
      const edges = Object.keys(adjacency)
        .map(Number)
        .sort((a, b) => a - b)
        .map((id) => [id, adjacency[id]]);
      return [agent.id, agent.position, agent.policyRng, visited, edges];
    });
  return JSON.stringify([
    ENGINE_VERSION,
    state.algorithmVersion,
    [seed, scenario, nodeCount, agentCount],
    state.tick,
    state.world.entrance,
    state.world.adjacency,
    robots,
  ]);
}

// FNV-1a over UTF-16 code units. A reproducibility checksum, not authentication.
export function stateHash(state: SimState): string {
  const text = serializeState(state);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
