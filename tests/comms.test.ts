import { expect, it } from "vitest";
import { encodeMessage, messageBytes, type Message } from "../src/sim/comms";
import { initialize, step, runTicks, type Policy } from "../src/sim/engine";

const settings = {
  range: 1,
  delay: 1,
  loss: 0,
  maxBytes: 256,
  maxQueue: 4,
  maxOutbound: 2,
};
const config = {
  seed: 2,
  scenario: "branching" as const,
  nodeCount: 3,
  agentCount: 2,
  communication: settings,
};
const sender: Policy = {
  version: "transport-test.1",
  decide(view) {
    return {
      kind: "wait",
      outbound:
        view.id === 0 && view.tick === 1
          ? [
              {
                to: 1,
                seq: 0,
                payload: {
                  kind: "observation",
                  node: view.position,
                  neighbors: view.adjacency[view.position]!,
                },
              },
            ]
          : [],
    };
  },
};

it("delivers only in a subsequent tick and bounds inbox lifetime", () => {
  const initial = initialize(config, sender).state;
  const sent = step(initial, sender);
  expect(
    sent.events.filter((e) => e.kind === "message-delivered"),
  ).toHaveLength(0);
  expect(sent.state.transport!.queue).toHaveLength(1);
  const received = step(sent.state, sender);
  expect(
    received.events.filter((e) => e.kind === "message-delivered"),
  ).toHaveLength(1);
  expect(received.state.transport!.inboxes[1]).toHaveLength(1);
  expect(received.state.agents[1]!.knowledge).toEqual(
    initial.agents[1]!.knowledge,
  );
  expect(step(received.state, sender).state.transport!.inboxes[1]).toEqual([]);
});

it("drops all transmissions at loss one and reproduces the queued state", () => {
  const start = initialize(
    { ...config, communication: { ...settings, loss: 1 } },
    sender,
  ).state;
  const result = runTicks(start, 3, sender);
  expect(
    result.events.filter((e) => e.kind === "message-delivered"),
  ).toHaveLength(0);
  expect(
    result.events.filter((e) => e.kind === "message-dropped"),
  ).toHaveLength(1);
  expect(result.state.transport!.queue).toEqual([]);
  expect(runTicks(start, 3, sender)).toEqual(result);
});

it("counts the complete canonical envelope as ASCII bytes", () => {
  const message: Message = {
    from: 0,
    to: 1,
    seq: 0,
    sentTick: 1,
    dueTick: 3,
    payload: { kind: "observation", node: 0, neighbors: [1, 2] },
  };
  const expected = '[0,1,0,1,3,"observation",0,[1,2]]';
  expect(encodeMessage(message)).toBe(expected);
  expect(messageBytes(message)).toBe(Buffer.byteLength(expected, "utf8"));
});
