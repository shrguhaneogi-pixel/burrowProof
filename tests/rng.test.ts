import { expect, it } from "vitest";
import { draw, streamSeed, type StreamName } from "../src/sim/rng";

function sequence(start: number) {
  let state = start;
  return Array.from({ length: 3 }, () => {
    const result = draw(state);
    state = result.state;
    return result.value;
  });
}

it("reproduces the world stream reference vector", () => {
  expect(streamSeed(0, "world")).toBe(933488787);
  expect(sequence(streamSeed(0, "world"))).toEqual([
    2057972730, 1796983555, 2025660908,
  ]);
  expect(sequence(streamSeed(0xffffffff, "world"))).toEqual(
    sequence(streamSeed(0xffffffff, "world")),
  );
});

it("isolates stream names, creation order, and consumption", () => {
  const names: StreamName[] = [
    "world",
    "policy/0",
    "policy/1",
    "failures",
    "packet-loss",
  ];
  const streams = names.map((name) => streamSeed(17, name));
  expect(new Set(streams).size).toBe(names.length);
  const original = sequence(streams[0]!);
  sequence(streams[1]!);
  expect(
    [...names]
      .reverse()
      .map((name) => streamSeed(17, name))
      .reverse(),
  ).toEqual(streams);
  expect(sequence(streamSeed(17, "world"))).toEqual(original);
});

it.each([-1, 2 ** 32, 0.5, NaN, Infinity])(
  "rejects invalid seed %s",
  (seed) => {
    expect(() => streamSeed(seed, "world")).toThrow(RangeError);
  },
);
