import type { Message, MessageRequest } from "./comms";
import { inboxView } from "./comms";

export interface LocalMap {
  readonly visited: readonly number[];
  readonly adjacency: Readonly<Partial<Record<number, readonly number[]>>>;
}
export interface AgentState {
  readonly id: number;
  readonly position: number;
  readonly knowledge: LocalMap;
}
export interface AgentView {
  readonly tick?: number;
  readonly inbox?: readonly Message[];
  readonly id: number;
  readonly position: number;
  readonly visited: readonly number[];
  readonly adjacency: LocalMap["adjacency"];
}
export type Action = (
  { readonly kind: "wait" } | { readonly kind: "move"; readonly to: number }
) & { readonly outbound?: readonly MessageRequest[] };
export type Planner = (view: AgentView, policyDraw: number) => Action;

function sorted(values: Iterable<number>) {
  return [...new Set(values)].sort((a, b) => a - b);
}
export function spawnAgent(
  id: number,
  entrance: number,
  neighbors: readonly number[],
): AgentState {
  return arrive(
    { id, position: entrance, knowledge: { visited: [], adjacency: {} } },
    entrance,
    neighbors,
  );
}
// The environment passes only the incident row. Knowledge always records both directions.
export function arrive(
  agent: AgentState,
  position: number,
  neighbors: readonly number[],
): AgentState {
  const known = agent.knowledge;
  if (known.visited.includes(position)) return { ...agent, position };
  const adjacency = { ...known.adjacency };
  adjacency[position] = sorted(neighbors);
  for (const n of neighbors)
    adjacency[n] = sorted([...(adjacency[n] ?? []), position]);
  return {
    id: agent.id,
    position,
    knowledge: { visited: sorted([...known.visited, position]), adjacency },
  };
}

export function observe(
  agent: AgentState,
  inbox?: readonly Message[],
  tick?: number,
): AgentView {
  const adjacency: Partial<Record<number, readonly number[]>> = {};
  for (const key of Object.keys(agent.knowledge.adjacency)) {
    const id = Number(key);
    adjacency[id] = Object.freeze([...agent.knowledge.adjacency[id]!]);
  }
  return Object.freeze({
    ...(inbox === undefined ? {} : { inbox: inboxView(inbox) }),
    ...(tick === undefined ? {} : { tick }),
    id: agent.id,
    position: agent.position,
    visited: Object.freeze([...agent.knowledge.visited]),
    adjacency: Object.freeze(adjacency),
  });
}
export const firstNeighbor: Planner = (view) => {
  const next = view.adjacency[view.position]?.[0];
  return next === undefined ? { kind: "wait" } : { kind: "move", to: next };
};
