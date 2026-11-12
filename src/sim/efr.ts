import type { AgentView } from "./agent";
import type { Policy } from "./engine";
import {
  validAnnouncement,
  type Claim,
  type Announcement,
  type MessageRequest,
} from "./comms";
import { frontierRoutes } from "./frontiers";
import {
  claimExpired,
  type ReservationExpiry,
  type EfrView,
  type EfrState,
  type Receipt,
} from "./reservations";

function receive(
  view: AgentView,
  local: EfrView,
  tick: number,
  expiry: ReservationExpiry,
): (Receipt | null)[] {
  const frontier = (id: number) =>
    view.adjacency[id] !== undefined && !view.visited.includes(id);
  const received = local.memory.received.map((entry) => {
    if (
      entry?.claim &&
      (claimExpired(entry.claim.expiresTick, tick, expiry) ||
        !frontier(entry.claim.target))
    )
      return { ...entry, claim: null };
    return entry;
  });
  for (const message of view.inbox ?? []) {
    const { from, seq, payload } = message;
    if (
      payload.kind === "observation" ||
      from === view.id ||
      !Number.isInteger(from) ||
      from < 0 ||
      from >= local.rosterSize ||
      message.to !== view.id ||
      !Number.isSafeInteger(seq) ||
      seq < 0 ||
      message.dueTick !== tick ||
      message.sentTick >= tick ||
      !validAnnouncement(payload, message.sentTick, local.ttl, expiry)
    )
      continue;
    const previous = received[from];
    if (previous && seq <= previous.seq) continue;
    const latestIssue = previous?.latestIssue ?? -1;
    let claim = previous?.claim ?? null;
    if (payload.kind === "release") {
      if (
        claim?.issuedTick === payload.issuedTick &&
        claim.target === payload.target
      )
        claim = null;
    } else if (
      payload.issuedTick > latestIssue &&
      !claimExpired(payload.expiresTick, tick, expiry) &&
      frontier(payload.target)
    ) {
      claim = payload;
    }
    received[from] = {
      seq,
      latestIssue: Math.max(latestIssue, payload.issuedTick),
      claim,
    };
  }
  return received;
}

function winners(
  received: readonly (Receipt | null)[],
): Map<number, { issuer: number; issuedTick: number }> {
  const result = new Map<number, { issuer: number; issuedTick: number }>();
  // Iterating addresses in order gives the smaller issuer priority on a tie.
  for (const [issuer, receipt] of received.entries()) {
    const claim = receipt?.claim;
    if (!claim) continue;
    const existing = result.get(claim.target);
    if (!existing || claim.issuedTick < existing.issuedTick)
      result.set(claim.target, { issuer, issuedTick: claim.issuedTick });
  }
  return result;
}

function announce(
  local: EfrView,
  id: number,
  previous: Claim | null,
  own: Claim | null,
  tick: number,
  expiry: ReservationExpiry,
) {
  const pending = local.memory.pending.map((row) =>
    row.filter(
      (item) => !claimExpired(item.issuedTick + local.ttl, tick, expiry),
    ),
  );
  if (own !== previous) {
    for (const [peer, row] of pending.entries()) {
      if (peer === id) continue;
      const release: Announcement | undefined =
        previous && !claimExpired(previous.expiresTick, tick, expiry)
          ? {
              kind: "release",
              target: previous.target,
              issuedTick: previous.issuedTick,
            }
          : row.find((item) => item.kind === "release");
      pending[peer] = [];
      if (release) pending[peer]!.push(release);
      if (own) pending[peer]!.push(own);
    }
  }
  let { nextSeq, cursor } = local.memory;
  const outbound: MessageRequest[] = [];
  let emptySlots = 0;
  while (
    outbound.length < local.outboundLimit &&
    emptySlots < local.rosterSize
  ) {
    const peer = cursor;
    cursor = (cursor + 1) % local.rosterSize;
    const payload = pending[peer]!.shift();
    if (!payload) {
      emptySlots++;
      continue;
    }
    if (!Number.isSafeInteger(nextSeq + 1))
      throw new RangeError("EFR sequence exhausted");
    outbound.push({ to: peer, seq: nextSeq++, payload });
    emptySlots = 0;
  }
  return { pending, nextSeq, cursor, outbound };
}

function createEfrPolicy(expiry: ReservationExpiry): Policy {
  return Object.freeze<Policy>({
    version: expiry === "enforced" ? "efr.1" : "efr-no-expiry.1",
    reservationExpiry: expiry,
    usesEfr: true,
    decide(view) {
      const local = view.efr,
        tick = view.tick;
      if (!local || tick === undefined)
        throw new Error("EFR requires an initialized local view");
      const received = receive(view, local, tick, expiry);
      const foreign = winners(received);
      const previous = local.memory.own;
      const routes = [...frontierRoutes(view)].filter(
        (route) => route.target !== view.position,
      );
      let own = previous;
      let route = routes.find((route) => route.target === own?.target);
      const rival = own && foreign.get(own.target);
      if (
        !own ||
        claimExpired(own.expiresTick, tick, expiry) ||
        !route ||
        (rival &&
          (rival.issuedTick < own.issuedTick ||
            (rival.issuedTick === own.issuedTick && rival.issuer < view.id)))
      ) {
        route = routes.find((candidate) => !foreign.has(candidate.target));
        own = null;
        if (route) {
          const expiresTick = tick + local.ttl;
          if (!Number.isSafeInteger(expiresTick))
            throw new RangeError("EFR expiry exceeds safe tick range");
          own = {
            kind: "claim",
            target: route.target,
            issuedTick: tick,
            expiresTick,
          };
        }
      }
      const { outbound, ...fanout } = announce(
        local,
        view.id,
        previous,
        own,
        tick,
        expiry,
      );
      const efr: EfrState = { own, received, ...fanout };
      return route
        ? { kind: "move", to: route.firstStep, efr, outbound }
        : { kind: "wait", efr, outbound };
    },
  });
}

export const efrPolicy = createEfrPolicy("enforced");
export const efrNoExpiryPolicy = createEfrPolicy("disabled");
