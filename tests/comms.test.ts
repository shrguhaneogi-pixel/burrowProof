import { expect, it } from "vitest";
import { encodeMessage, messageBytes, type Message } from "../src/sim/comms";

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
