// Graph-level transport contract. All fields serialize as ASCII.
import type { AgentView } from "./agent";
import type { World } from "./graph";
import { draw, streamSeed } from "./rng";

export type TransportEvent =
  | {
      kind: "message-rejected";
      tick: number;
      agentId: number;
      seq: number | null;
      reason: string;
      count: number;
    }
  | {
      kind: "message-attempted" | "message-sent" | "message-delivered";
      tick: number;
      agentId: number;
      message: Message;
      bytes: number;
    }
  | {
      kind: "message-dropped";
      tick: number;
      agentId: number;
      message: Message;
      bytes: number;
      reason: "range" | "loss" | "queue-full" | "recipient-failed";
    };

export function validateCommunication(
  config: CommunicationConfig,
): CommunicationConfig {
  for (const [key, limit, minimum] of [
    ["range", 4096, 0],
    ["delay", 10000, 1],
    ["maxBytes", 65536, 1],
    ["maxQueue", 4096, 0],
    ["maxOutbound", 16, 1],
  ] as const) {
    if (
      !Number.isInteger(config[key]) ||
      config[key] < minimum ||
      config[key] > limit
    )
      throw new RangeError("Invalid communication " + key);
  }
  if (!Number.isFinite(config.loss) || config.loss < 0 || config.loss > 1)
    throw new RangeError("Invalid communication loss");
  return Object.freeze({
    range: config.range,
    delay: config.delay,
    loss: config.loss,
    maxBytes: config.maxBytes,
    maxQueue: config.maxQueue,
    maxOutbound: config.maxOutbound,
  });
}

export function emptyTransport(agents: number): TransportState {
  return {
    queue: [],
    inboxes: Array.from({ length: agents }, () => []),
    lastSeq: Array.from({ length: agents }, () => -1),
  };
}

function compare(a: Message, b: Message): number {
  return a.dueTick - b.dueTick || a.from - b.from || a.seq - b.seq;
}

export function deliverDue(
  state: TransportState,
  tick: number,
  failedRecipients: ReadonlySet<number> = new Set(),
): { transport: TransportState; events: TransportEvent[] } {
  const inboxes: Message[][] = state.inboxes.map(() => []);
  const queue: Message[] = [];
  const events: TransportEvent[] = [];
  for (const message of [...state.queue].sort(compare)) {
    if (message.dueTick > tick) {
      queue.push(message);
      continue;
    }
    if (failedRecipients.has(message.to)) {
      events.push({
        kind: "message-dropped",
        tick,
        agentId: message.from,
        message,
        bytes: messageBytes(message),
        reason: "recipient-failed",
      });
      continue;
    }
    inboxes[message.to]!.push(message);
    events.push({
      kind: "message-delivered",
      tick,
      agentId: message.to,
      message,
      bytes: messageBytes(message),
    });
  }
  return { transport: { queue, inboxes, lastSeq: state.lastSeq }, events };
}

export function inboxView(messages: readonly Message[]): readonly Message[] {
  return Object.freeze(
    messages.map((message) =>
      Object.freeze({
        ...message,
        payload: copyPayload(message.payload),
      }),
    ),
  );
}

function withinRange(
  world: World,
  from: number,
  to: number,
  range: number,
): boolean {
  const seen = new Set([from]);
  let layer = [from];
  for (let distance = 0; distance <= range && layer.length > 0; distance++) {
    if (layer.includes(to)) return true;
    const next: number[] = [];
    for (const node of layer)
      for (const neighbor of world.adjacency[node]!) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          next.push(neighbor);
        }
      }
    layer = next;
  }
  return false;
}

function validObservation(
  payload: ObservationPayload,
  view: AgentView,
): boolean {
  if (
    !payload ||
    payload.kind !== "observation" ||
    !Number.isInteger(payload.node) ||
    !Array.isArray(payload.neighbors)
  )
    return false;
  if (Object.keys(payload).sort().join(",") !== "kind,neighbors,node")
    return false;
  const known = view.adjacency[payload.node];
  return (
    view.visited.includes(payload.node) &&
    known !== undefined &&
    payload.neighbors.length === known.length &&
    payload.neighbors.every((node, index) => node === known[index])
  );
}

export interface Claim {
  readonly kind: "claim";
  readonly target: number;
  readonly issuedTick: number;
  readonly expiresTick: number;
}
export interface Release {
  readonly kind: "release";
  readonly target: number;
  readonly issuedTick: number;
}
export type Announcement = Claim | Release;
export type Payload = ObservationPayload | Announcement;

export function validAnnouncement(
  payload: Announcement,
  sentTick: number,
  ttl: number,
): boolean {
  if (
    !Number.isSafeInteger(payload.target) ||
    payload.target < 0 ||
    !Number.isSafeInteger(payload.issuedTick) ||
    payload.issuedTick < 0 ||
    payload.issuedTick > sentTick
  )
    return false;
  const keys = Object.keys(payload).sort().join(",");
  if (payload.kind === "release") return keys === "issuedTick,kind,target";
  return (
    payload.kind === "claim" &&
    keys === "expiresTick,issuedTick,kind,target" &&
    Number.isSafeInteger(payload.expiresTick) &&
    payload.expiresTick === payload.issuedTick + ttl &&
    sentTick < payload.expiresTick
  );
}

function copyPayload(payload: Payload): Payload {
  if (payload.kind === "observation")
    return Object.freeze({
      kind: payload.kind,
      node: payload.node,
      neighbors: Object.freeze([...payload.neighbors]),
    });
  return Object.freeze({ ...payload });
}

function validPayload(
  payload: Payload,
  view: AgentView,
  tick: number,
  ttl: number,
): boolean {
  if (!payload) return false;
  if (payload.kind === "observation") return validObservation(payload, view);
  return (
    validAnnouncement(payload, tick, ttl) &&
    view.adjacency[payload.target] !== undefined &&
    (payload.kind === "release" || !view.visited.includes(payload.target))
  );
}

export function scheduleOutbound(
  state: TransportState,
  config: CommunicationConfig,
  world: World,
  positions: readonly number[],
  senders: readonly { view: AgentView; requests: readonly MessageRequest[] }[],
  tick: number,
  seed: number,
  ttl = 16,
): { transport: TransportState; events: TransportEvent[] } {
  const queue = [...state.queue],
    lastSeq = [...state.lastSeq];
  const events: TransportEvent[] = [];
  for (const { view, requests } of [...senders].sort(
    (a, b) => a.view.id - b.view.id,
  )) {
    const agentId = view.id;
    const reject = (seq: number | null, reason: string, count = 1) =>
      events.push({
        kind: "message-rejected",
        tick,
        agentId,
        seq,
        reason,
        count,
      });
    if (!Array.isArray(requests)) {
      reject(null, "invalid-requests");
      continue;
    }
    for (const request of requests.slice(0, config.maxOutbound)) {
      const seq = request?.seq;
      if (!Number.isSafeInteger(seq) || seq < 0) {
        reject(null, "invalid-sequence");
        continue;
      }
      if (seq <= lastSeq[agentId]!) {
        reject(seq, "duplicate-sequence");
        continue;
      }
      lastSeq[agentId] = seq;
      if (
        Object.keys(request).sort().join(",") !== "payload,seq,to" ||
        !Number.isInteger(request.to) ||
        request.to < 0 ||
        request.to >= positions.length ||
        request.to === agentId
      ) {
        reject(seq, "invalid-recipient");
        continue;
      }
      if (!validPayload(request.payload, view, tick, ttl)) {
        reject(seq, "unauthorized-payload");
        continue;
      }
      const dueTick = tick + config.delay;
      if (!Number.isSafeInteger(dueTick))
        throw new RangeError("Delivery tick exceeds safe integer range");
      const message: Message = Object.freeze({
        from: agentId,
        to: request.to,
        seq,
        sentTick: tick,
        dueTick,
        payload: copyPayload(request.payload),
      });
      const bytes = messageBytes(message);
      if (bytes > config.maxBytes) {
        reject(seq, "size-limit");
        continue;
      }
      events.push({ kind: "message-attempted", tick, agentId, message, bytes });
      let reason: "range" | "queue-full" | "loss" | undefined;
      if (
        !withinRange(
          world,
          positions[agentId]!,
          positions[request.to]!,
          config.range,
        )
      )
        reason = "range";
      else if (queue.length >= config.maxQueue) reason = "queue-full";
      else {
        events.push({ kind: "message-sent", tick, agentId, message, bytes });
        let key = streamSeed(seed, "packet-loss");
        for (const character of [tick, agentId, request.to, seq].join(":"))
          key = Math.imul(key ^ character.charCodeAt(0), 0x01000193) >>> 0;
        if (draw(key).value / 0x100000000 < config.loss) reason = "loss";
      }
      if (reason)
        events.push({
          kind: "message-dropped",
          tick,
          agentId,
          message,
          bytes,
          reason,
        });
      else queue.push(message);
    }
    if (requests.length > config.maxOutbound)
      reject(null, "outbound-limit", requests.length - config.maxOutbound);
  }
  return {
    transport: { queue: queue.sort(compare), inboxes: state.inboxes, lastSeq },
    events,
  };
}

export interface ObservationPayload {
  readonly kind: "observation";
  readonly node: number;
  readonly neighbors: readonly number[];
}
export interface MessageRequest {
  readonly to: number;
  readonly seq: number;
  readonly payload: Payload;
}
export interface Message extends MessageRequest {
  readonly from: number;
  readonly sentTick: number;
  readonly dueTick: number;
}
export interface CommunicationConfig {
  readonly range: number;
  readonly delay: number;
  readonly loss: number;
  readonly maxBytes: number;
  readonly maxQueue: number;
  readonly maxOutbound: number;
}
export interface TransportState {
  readonly queue: readonly Message[];
  readonly inboxes: readonly (readonly Message[])[];
  readonly lastSeq: readonly number[];
}

export function encodeMessage(message: Message): string {
  const body = message.payload;
  const header = [
    message.from,
    message.to,
    message.seq,
    message.sentTick,
    message.dueTick,
    body.kind,
  ];
  if (body.kind === "observation")
    return JSON.stringify([...header, body.node, body.neighbors]);
  if (body.kind === "claim")
    return JSON.stringify([
      ...header,
      body.target,
      body.issuedTick,
      body.expiresTick,
    ]);
  return JSON.stringify([...header, body.target, body.issuedTick]);
}

// Fixed names, integer IDs and integer neighbors make the tuple ASCII-only.
export function messageBytes(message: Message): number {
  return encodeMessage(message).length;
}
