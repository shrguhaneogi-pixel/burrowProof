export type StreamName =
  "world" | "failures" | "packet-loss" | `policy/${number}`;

export function streamSeed(seed: number, name: StreamName): number {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError("Seed must be an unsigned 32-bit integer");
  }
  // FNV-1a over the ASCII stream name, salted with the root seed.
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < name.length; i++) {
    hash = Math.imul(hash ^ name.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash;
}

// Mulberry32. State is explicit so snapshots can resume at the next draw.
export function draw(state: number): { state: number; value: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let bits = Math.imul(next ^ (next >>> 15), next | 1);
  bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61);
  return { state: next, value: (bits ^ (bits >>> 14)) >>> 0 };
}
