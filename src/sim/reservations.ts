import type { Announcement, Claim } from "./comms";

export const DEFAULT_TTL = 16;
export type ReservationExpiry = "enforced" | "disabled";

export function claimExpired(
  expiresTick: number,
  tick: number,
  expiry: ReservationExpiry,
): boolean {
  return expiry === "enforced" && expiresTick <= tick;
}
export interface Receipt {
  readonly seq: number;
  readonly latestIssue: number;
  readonly claim: Claim | null;
}
export interface EfrState {
  readonly own: Claim | null;
  readonly received: readonly (Receipt | null)[];
  readonly pending: readonly (readonly Announcement[])[];
  readonly nextSeq: number;
  readonly cursor: number;
}
export interface EfrView {
  readonly ttl: number;
  readonly rosterSize: number;
  readonly outboundLimit: number;
  readonly memory: EfrState;
}

export function normalizeTtl(ttl: number): number {
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 10000)
    throw new RangeError("EFR TTL must be an integer from 1 to 10000");
  return ttl;
}

function copyClaim(claim: Claim): Claim {
  return Object.freeze({
    kind: "claim",
    target: claim.target,
    issuedTick: claim.issuedTick,
    expiresTick: claim.expiresTick,
  });
}
export function copyAnnouncement(payload: Announcement): Announcement {
  return payload.kind === "claim"
    ? copyClaim(payload)
    : Object.freeze({
        kind: "release",
        target: payload.target,
        issuedTick: payload.issuedTick,
      });
}

// Copy at both policy boundaries. Dense slots are indexed by public protocol address.
export function snapshotEfr(state: EfrState, rosterSize: number): EfrState {
  if (
    state.received.length !== rosterSize ||
    state.pending.length !== rosterSize ||
    !Number.isSafeInteger(state.nextSeq) ||
    state.nextSeq < 0 ||
    !Number.isInteger(state.cursor) ||
    state.cursor < 0 ||
    state.cursor >= rosterSize
  ) {
    throw new RangeError("Invalid EFR state bounds");
  }
  return Object.freeze({
    own: state.own && copyClaim(state.own),
    received: Object.freeze(
      state.received.map(
        (entry) =>
          entry &&
          Object.freeze({
            seq: entry.seq,
            latestIssue: entry.latestIssue,
            claim: entry.claim && copyClaim(entry.claim),
          }),
      ),
    ),
    pending: Object.freeze(
      state.pending.map((row) => {
        if (row.length > 2)
          throw new RangeError("Excess pending announcements");
        return Object.freeze(row.map(copyAnnouncement));
      }),
    ),
    nextSeq: state.nextSeq,
    cursor: state.cursor,
  });
}
export function emptyEfr(rosterSize: number): EfrState {
  return snapshotEfr(
    {
      own: null,
      received: Array.from({ length: rosterSize }, () => null),
      pending: Array.from({ length: rosterSize }, () => []),
      nextSeq: 0,
      cursor: 0,
    },
    rosterSize,
  );
}
