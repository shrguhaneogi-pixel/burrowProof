---
name: burrowproof-simulation-audit
description: Audit BurrowProof engine, replay and experiment changes for hidden-map leakage, deterministic timing, reservation liveness and fair matched comparisons.
---

# Simulation audit

Trace a single tick from sensing through the planner's actual input to movement and emitted events. Identify which owner can see the environment, how the agent learned each edge, and which invariants the change can affect.

- **Locality and movement (I1-I2).** Hold the planner-visible history fixed and change a connected, undiscovered region. Compare decisions only while the two local views agree. For each move, look up its edge in the pre-move local view and independently in the environment.
- **Reproducibility (I3, I8).** Run identical seed, config and version tuples twice. Compare serialized events and final state hashes. Repeat with different tick batch sizes. Keep a failing seed and first divergent tick.
- **Communication and failures (I4-I5).** Follow message IDs from send through delivery or drop. Exercise range and payload boundaries, delay, total loss and blackouts. Fail a recipient with a packet in flight. Check failed agents' events against their failure intervals.
- **Claims (I6).** Give a live agent a sole frontier with a stale foreign claim. Check the choice one tick before expiry and exactly at expiry. Exercise conflict order, duplicate/out-of-order updates, release and an owner that fails before releasing. Test the no-expiry control separately.
- **Metrics and experiments (I7).** Hand-count a short event fixture independently of the reducer. Compare exogenous inputs on paired seeds, including packet-loss draws for matching opportunities. Check timeout counts and the predeclared seed split.

Use the applicable repository commands. Record input, tested seed count, observed output and any counterexample. A failing invariant keeps its milestone open.
