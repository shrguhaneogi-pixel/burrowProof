// Graph-level transport contract. All fields serialize as ASCII.
export interface ObservationPayload {
  readonly kind: "observation";
  readonly node: number;
  readonly neighbors: readonly number[];
}
export interface MessageRequest {
  readonly to: number;
  readonly seq: number;
  readonly payload: ObservationPayload;
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
  return JSON.stringify([
    message.from,
    message.to,
    message.seq,
    message.sentTick,
    message.dueTick,
    message.payload.kind,
    message.payload.node,
    message.payload.neighbors,
  ]);
}

// Fixed names, integer IDs and integer neighbors make the tuple ASCII-only.
export function messageBytes(message: Message): number {
  return encodeMessage(message).length;
}
