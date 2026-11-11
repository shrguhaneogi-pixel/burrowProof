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
import {
  deliverDue,
  emptyTransport,
  scheduleOutbound,
  validateCommunication,
  type CommunicationConfig,
  type TransportState,
  type TransportEvent,
} from "./comms";

export const ENGINE_VERSION = "1b.3";
export const foundationPolicy = Object.freeze({
  version: "first-neighbor.1",
  decide: firstNeighbor,
});
export interface Policy {
  readonly version: string;
  readonly decide: Planner;
}
export interface Config {
  readonly failures?: readonly Failure[];
  readonly communication?: CommunicationConfig;
  readonly seed: number;
  readonly scenario: Scenario;
  readonly nodeCount: number;
  readonly agentCount: number;
}
export interface Failure {
  readonly tick: number;
  readonly agentId: number;
}
type Lifecycle =
  | { readonly status: "active" }
  | { readonly status: "failed"; readonly tick: number };
interface Robot extends AgentState {
  readonly lifecycle: Lifecycle;
  readonly policyRng: number;
}
export interface SimState {
  readonly transport?: TransportState;
  readonly config: Config;
  readonly world: World;
  readonly agents: readonly Robot[];
  readonly tick: number;
  readonly algorithmVersion: string;
}
type Outcome =
  | { kind: "agent-failed" }
  | { kind: "moved"; from: number; to: number }
  | { kind: "waited"; at: number }
  | {
      kind: "rejected";
      at: number;
      to: number | null;
      reason: "invalid-action" | "unknown-edge" | "missing-edge";
    }
  | { kind: "sensed"; at: number; neighbors: readonly number[] };
export type SimEvent =
  (Outcome & { tick: number; agentId: number }) | TransportEvent;
export interface Transition {
  state: SimState;
  events: SimEvent[];
}

function normalizeFailures(
  failures: readonly Failure[],
  agentCount: number,
): readonly Failure[] {
  const earliest = new Map<number, number>();
  for (const { tick, agentId } of failures) {
    if (
      !Number.isSafeInteger(tick) ||
      tick < 0 ||
      !Number.isInteger(agentId) ||
      agentId < 0 ||
      agentId >= agentCount
    ) {
      throw new RangeError("Invalid failure tick or agent ID");
    }
    earliest.set(agentId, Math.min(tick, earliest.get(agentId) ?? tick));
  }
  return Object.freeze(
    [...earliest]
      .map(([agentId, tick]) => Object.freeze({ tick, agentId }))
      .sort((a, b) => a.tick - b.tick || a.agentId - b.agentId),
  );
}

function failAtTick(
  agents: readonly Robot[],
  failures: readonly Failure[],
  tick: number,
) {
  const due = new Set(
    failures
      .filter((failure) => failure.tick === tick)
      .map((failure) => failure.agentId),
  );
  const events: SimEvent[] = [];
  const next = [...agents]
    .sort((a, b) => a.id - b.id)
    .map((agent): Robot => {
      if (!due.has(agent.id) || agent.lifecycle.status === "failed")
        return agent;
      events.push({ kind: "agent-failed", tick, agentId: agent.id });
      return { ...agent, lifecycle: { status: "failed", tick } };
    });
  return { agents: next, events };
}

export function initialize(
  config: Config,
  policy: Policy = foundationPolicy,
  fixture?: World,
): Transition {
  const { seed, scenario, nodeCount, agentCount } = config;
  const communication =
    config.communication === undefined
      ? undefined
      : validateCommunication(config.communication);
  if (!Number.isInteger(agentCount) || agentCount < 1 || agentCount > 256)
    throw new RangeError("Agent count must be an integer from 1 to 256");
  const failures = normalizeFailures(config.failures ?? [], agentCount);
  const world = fixture
    ? createWorld(fixture.adjacency)
    : generateWorld(seed, scenario, nodeCount);
  if (world.adjacency.length !== nodeCount)
    throw new RangeError("World size disagrees with configuration");
  const at = world.entrance,
    neighbors = world.adjacency[at]!;
  const unsensed: Robot[] = Array.from({ length: agentCount }, (_, id) => ({
    id,
    position: at,
    knowledge: { visited: [], adjacency: {} },
    lifecycle: { status: "active" },
    policyRng: streamSeed(seed, `policy/${id}`),
  }));
  const initial = failAtTick(unsensed, failures, 0);
  const agents = initial.agents.map((agent) =>
    agent.lifecycle.status === "failed"
      ? agent
      : { ...agent, ...spawnAgent(agent.id, at, neighbors) },
  );
  const state = {
    config: {
      seed,
      scenario,
      nodeCount,
      agentCount,
      failures,
      ...(communication === undefined ? {} : { communication }),
    },
    ...(communication === undefined
      ? {}
      : { transport: emptyTransport(agentCount) }),
    world,
    agents,
    tick: 0,
    algorithmVersion: policy.version,
  };
  return {
    state,
    events: [
      ...initial.events,
      ...agents
        .filter((agent) => agent.lifecycle.status === "active")
        .map(({ id }): SimEvent => ({
          tick: 0,
          agentId: id,
          kind: "sensed",
          at,
          neighbors,
        })),
    ],
  };
}

function validate(
  agent: AgentState,
  action: Action,
  world: World,
): Exclude<Outcome, { kind: "sensed" | "agent-failed" }> {
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
  const failures = failAtTick(state.agents, state.config.failures ?? [], tick);
  const failedIds = new Set(
    failures.agents
      .filter((agent) => agent.lifecycle.status === "failed")
      .map((agent) => agent.id),
  );
  const delivery = state.transport
    ? deliverDue(state.transport, tick, failedIds)
    : undefined;
  const decisions = failures.agents
    .filter((agent) => agent.lifecycle.status === "active")
    .map((agent) => {
      const sample = draw(agent.policyRng);
      const view = observe(
        agent,
        delivery?.transport.inboxes[agent.id],
        delivery ? tick : undefined,
      );
      return {
        agent,
        view,
        policyRng: sample.state,
        action: policy.decide(view, sample.value),
      };
    });
  const events: SimEvent[] = [];
  const arrivals: SimEvent[] = [];
  const updates = new Map(
    decisions.map(({ agent, policyRng, action }): [number, Robot] => {
      const outcome = validate(agent, action, state.world);
      events.push({ tick, agentId: agent.id, ...outcome });
      if (outcome.kind !== "moved") return [agent.id, { ...agent, policyRng }];
      const at = outcome.to,
        neighbors = state.world.adjacency[at]!;
      arrivals.push({ tick, agentId: agent.id, kind: "sensed", at, neighbors });
      return [
        agent.id,
        { ...agent, ...arrive(agent, at, neighbors), policyRng },
      ];
    }),
  );
  const agents = failures.agents.map((agent) => updates.get(agent.id) ?? agent);
  events.push(...arrivals);
  let transport = delivery?.transport;
  if (transport && state.config.communication) {
    const outgoing = scheduleOutbound(
      transport,
      state.config.communication,
      state.world,
      agents.map((agent) => agent.position),
      decisions.map(({ view, action }) => ({
        view,
        requests: action?.outbound ?? [],
      })),
      tick,
      state.config.seed,
    );
    transport = outgoing.transport;
    events.push(...outgoing.events);
  }
  return {
    state: {
      ...state,
      tick,
      agents,
      ...(transport === undefined ? {} : { transport }),
    },
    events: [...failures.events, ...(delivery?.events ?? []), ...events],
  };
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
