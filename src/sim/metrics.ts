import type { SimEvent, SimState } from "./engine";

export interface CoverageProgress {
  readonly tick: number;
  readonly visited: number;
}
export interface CommunicationMetrics {
  readonly generated: null;
  readonly attempted: number;
  readonly transmitted: number;
  readonly delivered: number;
  readonly rejected: number;
  readonly dropped: number;
  readonly transmittedBytes: number;
}
export interface MovementMetrics {
  readonly traversals: number;
  readonly globalRevisits: number;
  readonly agentRevisits: number;
  readonly rejected: number;
}
export type MissionOutcome =
  "running" | "complete" | "tick-cap" | "no-active-agents";
export interface MissionMetrics {
  readonly tick: number;
  readonly reachableNodes: number;
  readonly visited: readonly number[];
  readonly agentVisited: readonly (readonly number[])[];
  readonly failed: readonly number[];
  readonly movement: MovementMetrics;
  readonly communication: CommunicationMetrics;
  readonly progress: readonly CoverageProgress[];
  readonly threshold: number;
  readonly thresholdTick: number | null;
  readonly completionTick: number | null;
}

function increment(value: number, amount = 1): number {
  const result = value + amount;
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !Number.isSafeInteger(result)
  )
    throw new RangeError("Invalid or overflowing metric count");
  return result;
}

// Evaluator-only entry point. Initialization events are already represented here.
export function initialMetrics(
  initial: SimState,
  threshold = 0.9,
): MissionMetrics {
  if (
    initial.tick !== 0 ||
    !Number.isFinite(threshold) ||
    threshold <= 0 ||
    threshold > 1
  )
    throw new RangeError("Metrics require tick zero and a threshold in (0, 1]");
  const agentVisited = initial.agents.map((a) => [...a.knowledge.visited]);
  const visited = [...new Set(agentVisited.flat())].sort((a, b) => a - b);
  const reachableNodes = initial.world.adjacency.length; // World construction validates connectivity.
  return {
    tick: 0,
    reachableNodes,
    visited,
    agentVisited,
    failed: initial.agents
      .filter((a) => a.lifecycle.status === "failed")
      .map((a) => a.id),
    movement: {
      traversals: 0,
      globalRevisits: 0,
      agentRevisits: 0,
      rejected: 0,
    },
    communication: {
      generated: null,
      attempted: 0,
      transmitted: 0,
      delivered: 0,
      rejected: 0,
      dropped: 0,
      transmittedBytes: 0,
    },
    progress: [{ tick: 0, visited: visited.length }],
    threshold,
    thresholdTick:
      visited.length >= Math.ceil(threshold * reachableNodes) ? 0 : null,
    completionTick: visited.length === reachableNodes ? 0 : null,
  };
}

// Supply complete ticks in canonical order, exactly once, excluding tick-zero events.
// throughTick also accounts for ticks with no events after every robot has failed.
export function reduceMetrics(
  previous: MissionMetrics,
  events: readonly SimEvent[],
  throughTick: number,
): MissionMetrics {
  if (!Number.isSafeInteger(throughTick) || throughTick < previous.tick)
    throw new RangeError("Invalid metric tick boundary");
  const visited = new Set(previous.visited);
  const agentVisited = previous.agentVisited.map((nodes) => new Set(nodes));
  const failed = new Set(previous.failed);
  const movement = { ...previous.movement },
    communication = { ...previous.communication };
  const progress = previous.progress.map((point) => ({ ...point }));
  let lastTick = previous.tick,
    thresholdTick = previous.thresholdTick,
    completionTick = previous.completionTick;
  for (const event of events) {
    if (
      !Number.isSafeInteger(event.tick) ||
      event.tick <= previous.tick ||
      event.tick < lastTick ||
      event.tick > throughTick ||
      !Number.isInteger(event.agentId) ||
      event.agentId < 0 ||
      event.agentId >= agentVisited.length
    )
      throw new RangeError(
        "Events must belong to ordered, previously unprocessed ticks",
      );
    lastTick = event.tick;
    if (event.kind === "moved") {
      const own = agentVisited[event.agentId]!;
      if (
        !Number.isInteger(event.to) ||
        event.to < 0 ||
        event.to >= previous.reachableNodes
      )
        throw new RangeError("Invalid arrival node");
      movement.traversals = increment(movement.traversals);
      if (visited.has(event.to))
        movement.globalRevisits = increment(movement.globalRevisits);
      if (own.has(event.to))
        movement.agentRevisits = increment(movement.agentRevisits);
      own.add(event.to);
      visited.add(event.to);
      if (progress[progress.length - 1]!.visited !== visited.size) {
        if (progress[progress.length - 1]!.tick === event.tick) progress.pop();
        progress.push({ tick: event.tick, visited: visited.size });
      }
      if (
        thresholdTick === null &&
        visited.size >= Math.ceil(previous.threshold * previous.reachableNodes)
      )
        thresholdTick = event.tick;
      if (completionTick === null && visited.size === previous.reachableNodes)
        completionTick = event.tick;
    } else if (event.kind === "agent-failed") failed.add(event.agentId);
    else if (event.kind === "rejected")
      movement.rejected = increment(movement.rejected);
    else if (event.kind === "message-rejected")
      communication.rejected = increment(communication.rejected, event.count);
    else if (event.kind === "message-attempted")
      communication.attempted = increment(communication.attempted);
    else if (event.kind === "message-sent") {
      communication.transmitted = increment(communication.transmitted);
      communication.transmittedBytes = increment(
        communication.transmittedBytes,
        event.bytes,
      );
    } else if (event.kind === "message-delivered")
      communication.delivered = increment(communication.delivered);
    else if (event.kind === "message-dropped")
      communication.dropped = increment(communication.dropped);
  }
  return {
    ...previous,
    tick: throughTick,
    visited: [...visited].sort((a, b) => a - b),
    agentVisited: agentVisited.map((nodes) => [...nodes].sort((a, b) => a - b)),
    failed: [...failed].sort((a, b) => a - b),
    movement,
    communication,
    progress,
    thresholdTick,
    completionTick,
  };
}

export function missionOutcome(
  metrics: MissionMetrics,
  tickLimit: number,
): MissionOutcome {
  if (!Number.isSafeInteger(tickLimit) || tickLimit < 0)
    throw new RangeError("Invalid tick limit");
  if (metrics.completionTick !== null) return "complete";
  if (metrics.failed.length === metrics.agentVisited.length)
    return "no-active-agents";
  return metrics.tick >= tickLimit ? "tick-cap" : "running";
}
