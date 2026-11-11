# BurrowProof engineering handoff

## Milestones

| Phase | Status | Exit evidence needed |
| --- | --- | --- |
| P0 · Discovery and guardrails | Complete | See verification below |
| P1A · Engine foundation | Complete | I1–I3 and I8 tested on 200 fixed seeds, gates below |
| P1B.1 · Exploration baselines | Complete | Locality, movement, repeatability and batching checks below |
| P1B.2 · Bounded transport | Complete | Scoped transport checks below |
| P1B · Exploration and coordination | In progress | Failures (I5), reservations and metrics remain pending |
| P2 · Comms, failures, EFR, metrics, replay | Pending | I1–I8, at least 200 seeds, repeatable hash |
| P3 · Mission Control | Pending | Main-path E2E, telemetry agreement, desktop/tablet/mobile captures |
| P4 · Lab | Pending | Worker batches, matched seeds, DNF fixtures, bounded imports |
| P5 · Visual and accessibility | Pending | Keyboard, touch, contrast, reduced motion and measured performance |
| P6 · Hardening | Pending | Independent audit, no open critical/high findings |
| P7 · Release | Pending | Local production smoke, authorized preview and production smoke |

## Starting inventory · 2026-11-11

- VERIFIED-REPO: `git status --short --branch --untracked-files=all` showed clean `main...origin/main`. USER WORK at discovery: none. `git log -5 --oneline` showed only `45572fc Initial commit`.
- VERIFIED-REPO: `git ls-files --stage` and the hidden-file inventory found only a one-line README and MIT LICENSE. No manifest, lockfile, tsconfig, source, tests, CI, repository skills or applicable AGENTS.md existed. All product features were pending.
- OBSERVED-RUNTIME: Node 24.19.0, npm 11.17.0. Initial `npm ci --ignore-scripts --offline` exited 1 (EUSAGE, missing lockfile). `npm run typecheck`, `npm run lint`, `npm run test` and `npm run build` each returned ENOENT for package.json.

## Skill discovery

OBSERVED-RUNTIME: queried the installed Codex app-server's `skills/list` for this checkout with `forceReload`. Independently read candidate files in user and plugin roots. Cache presence alone does not establish registration. The scan returned 1,928 entries and zero entry errors, and logged a user-root traversal limit and two plugin-icon warnings. The list below covers the requested candidates.

| Candidate | Installed / registered | Readable | Source |
| --- | --- | --- | --- |
| frontend-app-builder | Cache only in this scan | Yes | build-web-apps 0.1.2 |
| react-best-practices | Yes, user | Yes | User skill directory |
| data-visualization | Cache only in this scan | Yes | build-web-data-visualization 0.1.21 |
| frontend-testing-debugging | Cache only in this scan | Yes | build-web-apps 0.1.2 |
| game-playtest | Cache only in this scan | Yes | game-studio 0.1.2 |
| web-perf | Yes, cloudflare:web-perf | Yes | cloudflare 1.0.4 |
| cloudflare | Yes, cloudflare:cloudflare | Yes | cloudflare 1.0.4 |
| skill-creator | Yes, system and user | Yes | Used the system copy at ~/.codex/skills/.system/skill-creator/SKILL.md |
| burrowproof-simulation-audit | Absent initially, now enabled in repo | Yes | .agents/skills/burrowproof-simulation-audit/SKILL.md |
| burrowproof-visual-audit | Absent initially, now enabled in repo | Yes | .agents/skills/burrowproof-visual-audit/SKILL.md |

OBSERVED-RUNTIME: `python <system-skill-creator>/scripts/quick_validate.py .agents/skills/<name>` printed `Skill is valid!` for both project skills. Discovery and format are checked. Behavioral use of both audits starts with their respective product phases.

## Decisions

- Follow the explicit v3 phase order. Retain existing main. Choose npm for this greenfield checkout. Defer React and other runtime dependencies until a product feature imports them.
- Use an HTML title page as the production entry smoke target. It reports no simulation data. Use the installed Playwright runner for load and refresh. The Browser skill was absent from the discovery response. The readable frontend-testing-debugging procedure was consulted manually.
- OBSERVED-RUNTIME: installing npm latest tags together raised ERESOLVE. typescript-eslint 8.72.2 requires TypeScript >=4.8.4 and <6.1.0. npm resolved typescript@6 to 6.0.3. Peer checks remained enabled.
- VERIFIED-REPO: exact development pins: TypeScript 6.0.3, typescript-eslint 8.72.2, ESLint 10.14.0, @eslint/js 10.0.1, Vite 8.3.7, Vitest 5.1.0, Prettier 3.9.10, @playwright/test 1.65.0 and @types/node 24.19.2.
- VERIFIED-DOCS: Vite takes index.html as its default static build entry. Playwright can launch the production preview for its suite. [Vite production builds](https://vite.dev/guide/build) · [Playwright web servers](https://playwright.dev/docs/test-webserver)

## Verification, commits and next step

- OBSERVED-RUNTIME: `npm ci` added 133 packages. `npm run typecheck` and `npm run lint` exited 0, including ESLint with zero warnings and Prettier's style check.
- OBSERVED-RUNTIME: `npm test` (same script run via `npm run test`) passed all six architecture checks. The first run timed out loading the ESLint parser inside a case. Moving configuration loading to suite initialization preserved the original assertions and timeout.
- OBSERVED-RUNTIME: `npm run build` produced a 651-byte dist/index.html (0.40 kB gzip) and zero JavaScript assets. `npm exec -- playwright install --only-shell chromium` installed browser revision 1254.
- OBSERVED-RUNTIME: `npm run test:e2e` passed 3/3 against the local production preview. Load and refresh retained the heading at 1440×900, 768×1024 and 390×844. Inspected all three captures. The mobile heading wraps onto two lines, without clipping. Page console and network checks passed. Node warned about competing terminal color settings in the test processes.
- OBSERVED-RUNTIME: `npm audit` reported 10 moderate results tracing to one minimatch advisory in the ESLint toolchain, zero high/critical. `npm audit --omit=dev` reported zero. npm's proposed fix changes ESLint major. Track compatible upstream fixes. [Advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
- VERIFIED-REPO: start `45572fc`, toolchain `c61f175`, simulation audit skill `d68b7ce`, visual audit skill `05456c8`, P0 handoff `b3ad55f`.

## Phase 1A — engine foundation

- VERIFIED-REPO: `5836843` adds explicit named uint32 streams, `c0fdcca` adds three connected graph families and `626581e` adds incident-edge sensing and detached planner observations.
- OBSERVED-RUNTIME: the first three stages passed 7, 602 and 3 focused cases respectively. Full-suite totals were 13, 615 and 618. Typecheck, lint and build passed at each stage.
- Tick contract: initialize at tick 0 with one entrance observation per agent. At t+1, use the pre-tick maps and one private draw per agent. Collect all decisions in ascending ID order before resolving any move. A move requires the edge in the pre-move local map and in the world. A rejection or wait keeps position and knowledge. Shared occupancy is allowed. Sense incident edges at every arrival. Emit all action outcomes by agent ID, then arrival observations by agent ID. Only the engine advances time.
- Foundation policy chooses the lowest known neighbor or waits on an isolated node. Graphs allow 1–4096 nodes. The engine supports 1–256 agents. Both limits apply at configuration entry.
- VERIFIED-REPO: `ecce356` implements the tick, batch runner, versioned state serialization and checksum. Entry points are `initialize(config)`, `step(state)` and `runTicks(state, count)` in src/sim/engine.ts. Each returns state and events. Custom pure policies supply their version and decision function. A supplied canary world is an additional explicit input and is validated and copied.
- OBSERVED-RUNTIME: `npm test -- tests/engine.test.ts` passed 405 cases. Seeds 0–199 ran paired hidden worlds through the actual planner boundary. The observer at the entrance retained the same input after the moving agent sensed a changed edge (I1).
- OBSERVED-RUNTIME: with 1–3 agents, 1–18 nodes and 12 ticks per seed, every move matched both the pre-move local map and the world. Reconstructed maps from independent movement histories matched each agent's knowledge (I2). Fresh initializations and batch sizes [3, 0, 1, 8] matched single-step events, canonical states and hashes (I3, I8). Seed 0, one agent, one branching node, tick 0 produced checksum `78ce3d53`.
- OBSERVED-RUNTIME: final `npm run typecheck`, `npm run lint`, `npm test` (1,023 cases, including the six original boundary tests), `npm run build` and `npm run test:e2e` (3 Chromium title-page regressions) exited 0. Test processes emitted the previously observed terminal-color warning.
- Security tracking: baseline checks resolved minimatch 10.2.6 through ESLint, @eslint/config-array and @typescript-eslint/typescript-estree. Their 10.x constraints exclude the advisory's fixed 11.0.1 release. npm reported 10 moderate development findings and zero production findings. Recheck upstream compatibility when updating tooling.
- NOT VERIFIED: I4 message semantics, I5 failed agents, I6 claim expiry and I7 event-derived metrics. Cross-browser engine determinism and comparative policy performance are also pending.
- P1A handoff commit: `b355ec7`.

## Phase 1B.1 — exploration baselines

- VERIFIED-REPO: discovery found clean main at `b355ec7`, aligned with origin/main. `b934d62` adds random walk and `4300887` adds nearest frontier in src/sim/policies.ts. Both frozen Policy objects work through initialize, step and runTicks.
- Policy semantics: random-walk.1 sorts local neighbors and uses floor(draw / 2^32 × degree). nearest-frontier.1 treats known unvisited nodes as frontiers. Ordered BFS selects shortest distance, then lowest target ID, with the first discovered equal-length route. Both wait when no eligible local action exists. Only evaluator code can determine global completion.
- SKILLS: used the existing burrowproof-simulation-audit instructions for pre-move edge checks, paired hidden-world traces, and fresh-run/batch comparisons.
- OBSERVED-RUNTIME: random-walk stage passed 805 focused cases and 1,828 total tests. Final `npm test -- tests/policies.test.ts` passed 1,615 cases. Final `npm test` passed all 2,638 cases, including the original 1,023. Both commits passed `npm run typecheck`, `npm run lint`, `npm run build` and `git diff --check`. Typecheck initially exposed a contextual typing issue with Object.freeze, corrected with its supported Policy type argument before the random-walk commit.
- OBSERVED-RUNTIME: each policy ran seeds 0–199 on all three graph families, with 1–8 nodes and 1–3 agents. Random walk ran 64 ticks per case, allowing incomplete exploration. Nearest frontier visited every node within N × (N−1) ticks and then waited in all tested cases. Fresh runs and uneven batches containing a zero-length batch matched serialized events, states and hashes.
- OBSERVED-RUNTIME: 200 paired-world canaries per policy checked actual planner inputs and actions until changed topology was sensed. Another agent waiting at the entrance retained its private observation. Focused cases checked draw endpoints, stable target/path ties, backtracking, disconnected frontiers, observation immutability and independence from other agents' presence.
- NOT VERIFIED: behavior at maximum graph/agent limits, cross-browser engine determinism, performance comparisons and I4–I7 remain pending. The development-only minimatch advisory above remains tracked. These runs are correctness checks and establish no comparative performance claim.
- P1B.1 handoff commit: `0604538`.

## Phase 1B.2 — transport protocol

- Design: observation payload contains one sensed node and its full incident row. Address requests by recipient ID and monotonic nonnegative safe-integer sender sequence. Validate against the pre-move observation. Encode [from,to,seq,sentTick,dueTick,kind,node,neighbors] as canonical ASCII JSON. Headers count toward maxBytes.
- Tick order: deliver due packets, build detached local views with only this tick's inbox, collect simultaneous decisions, validate/apply movement, sense arrivals, then schedule outbound requests using post-move graph-hop range. Delay is fixed and at least one tick. Eligibility is checked once at sending. Delivery does not merge maps.
- Bounds/order: maxOutbound per agent per tick, maxBytes per message, global maxQueue pending packets. Reject duplicate/stale sequences, invalid recipients/payloads and size excess. Drop on range, loss or full queue. Sort by dueTick/from/seq. Invalid attempts consume valid new sequence numbers. Overflow requests produce one bounded summary event. Packet-loss draws derive from the named loss seed plus tick/from/to/seq, independently of policy draws. Retain bounded inboxes for the current tick only. Planner code has no queue access.
- VERIFIED-REPO: began clean on main at 0604538, three commits ahead of origin/main. `9dc1be5` defines the protocol and byte fixture. `05f769a` integrates transport into step. `eedd19a` adds adversarial and regression verification.
- API: Config.communication opts in. Action.outbound carries requests. AgentView gains optional tick and inbox only with transport enabled. An inbox is a detached frozen snapshot of this tick's deliveries. Known recipient IDs are protocol addresses. Message identity is (from,seq). Forwarding and map merging are deferred.
- Bounds: range 0–4096 hops, delay 1–10,000 ticks, loss 0–1, maxBytes 1–65,536, maxQueue 0–4096, maxOutbound 1–16. Pending queue and per-tick delivered inboxes are bounded separately. An attempted event follows validation and size checks. Sent events represent bytes transmitted after range/capacity checks, including packets subsequently lost. Rejected and dropped events identify all enabled-transport failures.
- Serialization: engine version is 1b.2. Hashing covers communication configuration, pending queue, current inboxes and sequence high-water marks. The singleton golden checksum changes to 14a0b7a7 with the version change. Prior 1a.1 hashes above remain historical evidence.
- SKILLS: read and applied burrowproof-simulation-audit to message timing, sender knowledge, inbox isolation and repeated event/hash traces.
- OBSERVED-RUNTIME: baseline `npm test` passed 2,638 cases. Contract and initial integration stages passed 2,639 and 2,641 cases. Final `npm test -- tests/comms.test.ts` passed 67 cases, `npm test` passed 2,705 cases. `npm run typecheck`, `npm run lint`, `npm run build` and `git diff --check` exited 0 at each verified stage. A test's event narrowing was corrected after typecheck identified it.
- OBSERVED-RUNTIME: fixtures exercised zero/total loss, byte and queue boundaries, delayed delivery, stable concurrent order, range after movement, invalid recipients/sequences, unauthorized facts, bounded outbound summaries, duplicate rejection, no same-tick influence, detached inboxes and no automatic map merge. All 36 combinations of seeds 0–11 and three graph families matched single-step and uneven-batch events and states under 40% loss. An additional paired-world transport canary retained identical authorized inbox views despite hidden topology changes.
- OBSERVED-RUNTIME: both baseline policies retained identical agent states after 64 ticks with idle transport enabled. JSON-cloned state continued identically in the tested fixture. This is an internal continuation check. Untrusted replay import remains pending.
- Status: Phase 1B.2 complete for the selected graph-hop transport rules. I4 is checked for range, delay, loss, size, queue and message provenance. Blackouts, failure behavior (I5), reservations (I6), metrics (I7), maximum-scale performance and cross-browser execution remain NOT VERIFIED. The development-only minimatch advisory remains tracked above.
- NEXT: Phase 1B.3 deterministic robot failures, including in-flight sender/recipient handling and valid local failure awareness. EFR, ablation, event-derived metrics, replay validation and Mission Control remain pending.
