# BurrowProof — Repository Instructions

BurrowProof: Swarms Under Siege is Team FINE PRINT's reproducible demo of decentralized multi-robot graph exploration under unreliable communication.

## Architecture and ownership

- Target a static site. Keep the deterministic TypeScript engine in `src/sim`, experiments in `src/lab`, and React and canvas rendering in `src/ui`. Follow existing conventions as these modules grow.
- The environment owns the full graph. Each planner sees only its agent's sensed or received knowledge. Messages obey explicit range, delay, loss and size rules.
- The engine owns the tick. The UI renders its timeline. Derive metrics from events and tie animations to observed state or events.
- Record the seed, complete configuration, algorithm and engine versions, and final state hash in each replay.

## Verification and workflow

- Inspect callers and tests before changing a contract. Keep one owner for each state and computation.
- Verify unfamiliar APIs against installed types and official documentation. Keep dependencies maintained and used. Investigate warnings and failures.
- Use scripts listed in `package.json`. Inspect UI changes in a running browser. Record commands and observed results in `PLAN.md`.
- Preserve user work. Stage explicit paths and make small, verified commits. Never amend, force-push or hard-reset. Obtain approval before pushing or deploying.
- Use skills confirmed installed and readable. Project-specific audit procedures live in `.agents/skills/`.

## Visual system

Give the viewport priority. Use obsidian navy surfaces, cyan for discovery and communication, violet for agent identity and selection, and amber for failures. Pair status colors with shapes or labels. Support keyboard, touch, reduced motion and responsive layouts.
