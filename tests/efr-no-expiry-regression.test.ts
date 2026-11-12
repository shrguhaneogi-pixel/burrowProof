import { expect, it } from "vitest";
import { efrPolicy, efrNoExpiryPolicy } from "../src/sim/efr";
import {
  initialize,
  runTicks,
  step,
  type Config,
  type SimEvent,
  type SimState,
} from "../src/sim/engine";
import { createWorld, type Scenario } from "../src/sim/graph";
import { stateHash, serializeState } from "../src/sim/state-hash";
import type { AgentView, Action } from "../src/sim/agent";

const policies = [efrPolicy, efrNoExpiryPolicy];
function snapshot(state: SimState): SimState {
  return JSON.parse(JSON.stringify(state), (_, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse())
      : value,
  );
}
function config(seed: number, scenario: Scenario): Config {
  return {
    seed,
    scenario,
    nodeCount: 14,
    agentCount: 3,
    efr: { ttl: 4 },
    failures: [{ agentId: 0, tick: 12 }],
    communication: {
      range: 3,
      delay: 2,
      loss: 0.35,
      maxBytes: 512,
      maxQueue: 12,
      maxOutbound: 1,
    },
  };
}

it.each(["branching", "loop-heavy", "bottleneck-heavy"] as const)(
  "records matched smoke observations and verifies replay for %s",
  (scenario) => {
    const observations = [];
    for (let seed = 0; seed < 12; seed++) {
      const cfg = config(seed, scenario);
      const runs = policies.map((policy) =>
        runTicks(initialize(cfg, policy).state, 64, policy),
      );
      const chunked = policies.map((policy) => initialize(cfg, policy).state);
      const logs: SimEvent[][] = [[], []];
      // Interleave independent variants, restoring reordered snapshots between batches.
      for (const count of [1, 0, 7, 3, 21, 32]) {
        for (const [index, policy] of policies.entries()) {
          const result = runTicks(snapshot(chunked[index]!), count, policy);
          logs[index]!.push(...result.events);
          chunked[index] = result.state;
        }
      }
      for (const [index, policy] of policies.entries()) {
        const reference = runs[index]!,
          context = `${scenario} seed=${seed} policy=${policy.version}`;
        expect(JSON.stringify(logs[index]), context).toBe(
          JSON.stringify(reference.events),
        );
        expect(chunked[index], context).toEqual(reference.state);
        expect(serializeState(chunked[index]!), context).toBe(
          serializeState(reference.state),
        );
        expect(stateHash(chunked[index]!), context).toBe(
          stateHash(reference.state),
        );
        const start = initialize(cfg, policy).state;
        let state = start;
        const events: SimEvent[] = [];
        for (let tick = 1; tick <= 64; tick++) {
          const before = state;
          const result = step(before, policy);
          events.push(...result.events);
          state = result.state;
          for (const event of result.events) {
            if (event.kind === "moved") {
              expect(
                before.agents[event.agentId]!.knowledge.adjacency[event.from],
                context,
              ).toContain(event.to);
              expect(before.world.adjacency[event.from], context).toContain(
                event.to,
              );
            }
            if (event.agentId === 0 && tick >= 12)
              expect(
                ["agent-failed", "message-dropped"].includes(event.kind),
                context,
              ).toBe(true);
          }
          expect(state.transport!.queue.length, context).toBeLessThanOrEqual(
            12,
          );
          for (const agent of state.agents) {
            expect(agent.efr!.received.length, context).toBe(3);
            expect(agent.efr!.pending.length, context).toBe(3);
            expect(
              agent.efr!.pending.every((row) => row.length <= 2),
              context,
            ).toBe(true);
          }
        }
        expect(JSON.stringify(events), context).toBe(
          JSON.stringify(reference.events),
        );
        expect(stateHash(state), context).toBe(stateHash(reference.state));
      }
      const standard = runs[0]!,
        ablation = runs[1]!;
      expect(standard.state.world).toEqual(ablation.state.world);
      const summaries = runs.map(({ state, events }) => {
        const visited = new Set(
          state.agents.flatMap((a) => a.knowledge.visited),
        ).size;
        return {
          visited,
          moves: events.filter((e) => e.kind === "moved").length,
          transmissions: events.filter((e) => e.kind === "message-sent").length,
          incomplete: visited < 14,
        };
      });
      const firstEventDifference =
        Array.from({ length: 64 }, (_, i) => i + 1).find(
          (tick) =>
            JSON.stringify(standard.events.filter((e) => e.tick === tick)) !==
            JSON.stringify(ablation.events.filter((e) => e.tick === tick)),
        ) ?? null;
      // Outcome measurements carry no assertion that either algorithm must win.
      observations.push({
        seed,
        standard: summaries[0],
        noExpiry: summaries[1],
        firstEventDifference,
      });
    }
    console.info(JSON.stringify({ scenario, observations }));
  },
);

it.each(policies)(
  "keeps hidden-world and private-memory boundaries for $version",
  (base) => {
    const worlds = [
      createWorld([[1, 3, 4], [0, 2], [1], [0], [0]]),
      createWorld([[1, 3, 4], [0, 2], [1], [0, 4], [0, 3]]),
    ];
    const traces = worlds.map((world) => {
      const calls: { view: AgentView; draw: number; action: Action }[] = [];
      const policy = {
        ...base,
        decide(view: AgentView, draw: number) {
          const action = base.decide(view, draw);
          calls.push({ view, draw, action });
          return action;
        },
      };
      const cfg = {
        ...config(3, "branching"),
        nodeCount: 5,
        failures: [],
        efr: { ttl: 16 },
        communication: {
          range: 5,
          delay: 1,
          loss: 0,
          maxBytes: 512,
          maxQueue: 32,
          maxOutbound: 3,
        },
      };
      const result = runTicks(initialize(cfg, policy, world).state, 6, policy);
      return { calls, result };
    });
    expect(traces[0]!.calls.slice(0, 15)).toEqual(
      traces[1]!.calls.slice(0, 15),
    );
    expect(traces[0]!.calls[15]!.view.adjacency[3]).toEqual([0]);
    expect(traces[1]!.calls[15]!.view.adjacency[3]).toEqual([0, 4]);
    const memory = traces[0]!.calls[0]!.view.efr!.memory;
    expect(() =>
      Object.assign(memory.pending[1]!, { 0: { seq: 999 } }),
    ).toThrow();
    expect(traces[0]!.result.state.agents[0]!.efr!.received).not.toBe(
      traces[0]!.result.state.agents[1]!.efr!.received,
    );
  },
);
