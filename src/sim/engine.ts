import {
  arrive,
  firstNeighbor,
  observe,
  spawnAgent,
  type Action,
  type AgentState,
  type Planner,
} from "./agent";
import { createWorld, generateWorld, type Scenario, type World } from "./graph";
import { draw, streamSeed } from "./rng";

export const ENGINE_VERSION = "1a.1";
export const foundationPolicy = Object.freeze({
  version: "first-neighbor.1",
  decide: firstNeighbor,
});
export interface Policy {
  readonly version: string;
  readonly decide: Planner;
}
export interface Config {
  readonly seed: number;
  readonly scenario: Scenario;
  readonly nodeCount: number;
  readonly agentCount: number;
}
interface Robot extends AgentState {
  readonly policyRng: number;
}
export interface SimState {
  readonly config: Config;
  readonly world: World;
  readonly agents: readonly Robot[];
  readonly tick: number;
  readonly algorithmVersion: string;
}
type Outcome =
  | { kind: "moved"; from: number; to: number }
  | { kind: "waited"; at: number }
  | {
      kind: "rejected";
      at: number;
      to: number | null;
      reason: "invalid-action" | "unknown-edge" | "missing-edge";
    }
  | { kind: "sensed"; at: number; neighbors: readonly number[] };
export type SimEvent = Outcome & { tick: number; agentId: number };
export interface Transition {
  state: SimState;
  events: SimEvent[];
}

export function initialize(
  config: Config,
  policy: Policy = foundationPolicy,
  fixture?: World,
): Transition {
  const { seed, scenario, nodeCount, agentCount } = config;
  if (!Number.isInteger(agentCount) || agentCount < 1 || agentCount > 256)
    throw new RangeError("Agent count must be an integer from 1 to 256");
  const world = fixture
    ? createWorld(fixture.adjacency)
    : generateWorld(seed, scenario, nodeCount);
  if (world.adjacency.length !== nodeCount)
    throw new RangeError("World size disagrees with configuration");
  const at = world.entrance,
    neighbors = world.adjacency[at]!;
  const agents = Array.from({ length: agentCount }, (_, id) => ({
    ...spawnAgent(id, at, neighbors),
    policyRng: streamSeed(seed, `policy/${id}`),
  }));
  const state = {
    config: { seed, scenario, nodeCount, agentCount },
    world,
    agents,
    tick: 0,
    algorithmVersion: policy.version,
  };
  return {
    state,
    events: agents.map(({ id }) => ({
      tick: 0,
      agentId: id,
      kind: "sensed",
      at,
      neighbors,
    })),
  };
}

function validate(
  agent: AgentState,
  action: Action,
  world: World,
): Exclude<Outcome, { kind: "sensed" }> {
  const at = agent.position;
  if (action?.kind === "wait") return { kind: "waited", at };
  if (action?.kind !== "move" || !Number.isSafeInteger(action.to)) {
    return { kind: "rejected", at, to: null, reason: "invalid-action" };
  }
  const to = action.to;
  if (!agent.knowledge.adjacency[at]?.includes(to))
    return { kind: "rejected", at, to, reason: "unknown-edge" };
  if (!world.adjacency[at]?.includes(to))
    return { kind: "rejected", at, to, reason: "missing-edge" };
  return { kind: "moved", from: at, to };
}

export function step(
  state: SimState,
  policy: Policy = foundationPolicy,
): Transition {
  if (policy.version !== state.algorithmVersion)
    throw new Error("Policy version mismatch");
  const tick = state.tick + 1;
  if (!Number.isSafeInteger(tick))
    throw new RangeError("Tick exceeds safe integer range");
  const decisions = [...state.agents]
    .sort((a, b) => a.id - b.id)
    .map((agent) => {
      const sample = draw(agent.policyRng);
      return {
        agent,
        policyRng: sample.state,
        action: policy.decide(observe(agent), sample.value),
      };
    });
  const events: SimEvent[] = [];
  const arrivals: SimEvent[] = [];
  const agents = decisions.map(({ agent, policyRng, action }) => {
    const outcome = validate(agent, action, state.world);
    events.push({ tick, agentId: agent.id, ...outcome });
    if (outcome.kind !== "moved") return { ...agent, policyRng };
    const at = outcome.to,
      neighbors = state.world.adjacency[at]!;
    arrivals.push({ tick, agentId: agent.id, kind: "sensed", at, neighbors });
    return { ...arrive(agent, at, neighbors), policyRng };
  });
  return { state: { ...state, tick, agents }, events: events.concat(arrivals) };
}

export function runTicks(
  initial: SimState,
  count: number,
  policy: Policy = foundationPolicy,
): Transition {
  if (!Number.isSafeInteger(count) || count < 0)
    throw new RangeError("Tick count must be a nonnegative integer");
  let state = initial;
  const events: SimEvent[] = [];
  for (let i = 0; i < count; i++) {
    const next = step(state, policy);
    state = next.state;
    events.push(...next.events);
  }
  return { state, events };
}
