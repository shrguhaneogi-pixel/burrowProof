import { ENGINE_VERSION, type SimState } from "./engine";
import { encodeMessage, validateCommunication } from "./comms";
import type { Announcement } from "./comms";
import type { EfrState } from "./reservations";

function signalTuple(signal: Announcement | null) {
  if (!signal) return null;
  const identity = [signal.kind, signal.target, signal.issuedTick];
  return signal.kind === "claim" ? [...identity, signal.expiresTick] : identity;
}
function reservationTuple(state: EfrState) {
  return [
    signalTuple(state.own),
    state.received.map(
      (entry) =>
        entry && [entry.seq, entry.latestIssue, signalTuple(entry.claim)],
    ),
    state.pending.map((row) => row.map(signalTuple)),
    state.nextSeq,
    state.cursor,
  ];
}

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
      return [
        agent.id,
        agent.position,
        agent.policyRng,
        visited,
        edges,
        agent.lifecycle.status,
        agent.lifecycle.status === "failed" ? agent.lifecycle.tick : null,
        ...(agent.efr ? [reservationTuple(agent.efr)] : []),
      ];
    });
  return JSON.stringify([
    ENGINE_VERSION,
    state.algorithmVersion,
    [
      seed,
      scenario,
      nodeCount,
      agentCount,
      (state.config.failures ?? []).map((failure) => [
        failure.tick,
        failure.agentId,
      ]),
      ...(state.config.efr ? [state.config.efr.ttl] : []),
    ],
    state.tick,
    state.world.entrance,
    state.world.adjacency,
    robots,
    ...(state.transport === undefined
      ? []
      : [
          state.config.communication &&
            validateCommunication(state.config.communication),
          state.transport.queue.map(encodeMessage),
          state.transport.inboxes.map((inbox) => inbox.map(encodeMessage)),
          state.transport.lastSeq,
        ]),
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
