# BurrowProof engineering handoff

## Milestones

| Phase | Status | Exit evidence needed |
| --- | --- | --- |
| P0 · Discovery and guardrails | Complete | See verification below |
| P1A · Engine foundation | Complete | I1–I3 and I8 tested on 200 fixed seeds, gates below |
| P1B.1 · Exploration baselines | Complete | Locality, movement, repeatability and batching checks below |
| P1B.2 · Bounded transport | Complete | Scoped transport checks below |
| P1B.3 · Robot failures | Complete | Permanent scheduled faults and message lifecycle checks below |
| P1B.4 · EFR | Complete, independently audited | Local claim provenance, failure recovery and byte-identical replay checks below |
| P1B.5 · No-expiry ablation | Complete | Shared expiry mode, causal divergence and matched smoke evidence below |
| P1B · Exploration and coordination | In progress | Event-derived metrics and final headless audit remain pending |
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

## Historical verification and commits

- P0 VERIFIED-REPO: start `45572fc`, toolchain `c61f175`, simulation skill `d68b7ce`, visual skill `05456c8`, handoff `b3ad55f`. OBSERVED-RUNTIME: npm ci installed 133 packages, six architecture tests and three Chromium title-page checks passed. Inspected desktop/tablet/mobile captures. Output was 651 bytes, 0.40 kB gzip. Browser revision 1254 was installed.
- P1A VERIFIED-REPO: RNG `5836843`, graphs `c0fdcca`, local observations `626581e`, tick/hash `ecce356`, handoff `b355ec7`. OBSERVED-RUNTIME: 1,023 tests, including 405 engine cases, with I1/I2/I3/I8 checked on 200 seeds. Engine version 1a.1 singleton checksum was 78ce3d53.
- P1B.1 VERIFIED-REPO: random walk `b934d62`, nearest frontier `4300887`, handoff `0604538`. OBSERVED-RUNTIME: 1,615 focused and 2,638 total tests. Each policy ran 200 seeds across three graph families with 1–8 nodes and 1–3 agents, plus 200 paired-world canaries. Random walk was capped at 64 ticks. Nearest frontier completed those worlds within N × (N−1) ticks.
- P1B.2 VERIFIED-REPO: contracts `9dc1be5`, transport `05f769a`, tests `eedd19a`, handoff `d4902b0`. OBSERVED-RUNTIME: 67 focused and 2,705 total tests. Thirty-six seed/scenario combinations matched steps and batches under 40% loss. Engine version 1b.2 singleton checksum was 14a0b7a7.
- P1B.3 VERIFIED-REPO: failures `ebd483e`, tests `d9be202`, handoff `088800d`. OBSERVED-RUNTIME: 95 focused and 2,800 total tests. Tested ticks 0/1/10, duplicates, zero survivors and in-flight packets. Both baselines exercised 72 combinations of policy, seed and graph family under 35% loss. Engine version 1b.3 singleton checksum was 0cdd905f.
- At each historical milestone, typecheck, lint, tests, production build and whitespace checks passed in the recorded session. The original ESLint parser startup timeout was resolved by suite initialization, preserving assertions.
- Security tracking from the earlier audit: 10 moderate development findings trace to minimatch 10.2.6 through ESLint, @eslint/config-array and @typescript-eslint/typescript-estree. Their 10.x constraints exclude the advisory's fixed 11.0.1. Production-only audit reported zero. Advisory status was not refreshed during EFR work. [Advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)

## Authoritative engine and transport contracts

- One step owns the integer clock. Graphs are connected, undirected and capped at 4,096 nodes. Agents are capped at 256. Local sensing learns incident edges at initialization and arrivals. Planners receive detached local maps. Metrics and mission completion remain evaluator concerns.
- Failure schedules normalize to each agent's earliest tick. Tick-0 failures precede sensing. Later failures precede delivery and planning. Failed agents retain position, knowledge and RNG state. Accepted packets survive sender failure. Failed recipients drop packets at their due tick, before new scheduling. Health stays outside AgentView.
- Transport uses send-time graph-hop eligibility after movement, delay of at least one tick and one-tick inboxes. All active decisions use pre-move snapshots. Events order failures, due delivery/drop, action outcomes, arrivals, then outbound outcomes. New messages affect subsequent ticks.
- Protocol addresses are fixed integer agent IDs. Envelope identity is (from,seq). Monotonic per-sender sequence marks reject duplicates. Canonical ASCII tuples include headers in byte size. Range is 0–4096, delay 1–10,000, loss 0–1, maxBytes 1–65,536, maxQueue 0–4096 and maxOutbound 1–16.
- Validated attempts yield attempted events. Transmitted bytes use sent events after range/capacity checks, including packets subsequently lost. Drops/rejections report causes. Queue and delivered inboxes have separate bounds. Packet-loss draws use the named loss seed plus tick/from/to/seq and never consume policy RNG.

## Phase 1B.4 — EFR handoff

- VERIFIED-REPO: began clean on main at 088800d, ten commits ahead of origin/main. Shared BFS and tagged transport `27ff857`; EFR/state integration `db99dbe`; adversarial verification `7573a56`. Used the existing burrowproof-simulation-audit skill for locality, timing, expiry, failure and replay checks.
- Entry points: import efrPolicy from src/sim/efr.ts and pass it to initialize/step/runTicks. Policy.usesEfr allocates independent state per robot. Config.efr.ttl defaults to 16 and accepts integers 1–10,000. AgentView.efr exposes only that robot's copied frozen memory, TTL, public roster size and outbound limit. Action.efr returns the next local state, copied by the engine.
- Shared node IDs and the fixed roster are simulation assumptions. Observation, claim and release payloads share the existing queue and limits. Observation wire encoding is preserved. Claims carry target/issuedTick/expiresTick, releases carry target/issuedTick, and the envelope supplies issuer/sequence. Outbound claims must describe a known unvisited target and satisfy exact TTL arithmetic.
- A lease is active for issuedTick ≤ tick < expiresTick. Receivers ignore unknown/visited targets, expired arrivals and older sequences or issuance times. One receipt/tombstone per issuer preserves watermarks. Claims never add topology. Conflict priority is earliest issue tick then lowest issuer ID.
- Shared BFS orders reachable goals by distance then target ID, with ordered discovery selecting equal-length routes. EFR retains a winning local lease, otherwise selects an unreserved alternative. When all reachable goals are reserved it waits and reevaluates each tick. Reissue occurs only after expiry. Completion is observed at the next planning tick after arrival.
- Completion, abandonment and conflict loss schedule a release. Round-robin unicast obeys maxOutbound and increments sequence on attempts. Unsent work retains at most the latest release/claim pair per peer. Superseded announcements can be lost during rapid target changes. TTL remains the recovery mechanism when release packets are lost or an owner fails.
- Engine version 1b.4 serialization includes TTL, each agent's own claim, receipts/tombstones, pending announcements, next sequence and cursor. The singleton versioned checksum is 7d5acf24. Failed local memories stay frozen, and survivors receive no privileged failure cleanup.
- OBSERVED-RUNTIME: foundation passed 1,685 focused routing/transport and 2,803 total tests. Initial EFR integration passed 16 focused and 2,819 total tests. Final npm test -- tests/efr.test.ts passed 62 tests; npm test passed 2,865; npm run typecheck and npm run build exited 0. git diff --check passed for the EFR changes.
- OBSERVED-RUNTIME: expiry, stale replay, target ties, per-agent/run isolation and unknown-target delivery fixtures passed. All 36 seed/scenario combinations (seeds 0–11, three families, eight nodes, three agents, 16 ticks) matched event bytes, states and hashes across fresh runs, single steps, batches and JSON snapshot continuation with loss, delay and failures.
- OBSERVED-RUNTIME: the corridor fixture selected the same goal before delivery, then goals 3/4 after conflict resolution. A delivered release allowed movement on tick 7; a range-dropped release deferred movement to tick 9. With owner failure at tick 4, the survivor retained the delivered claim and resumed at tick 9 through expiry. Under total loss and zero communication, duplicate goal selection persisted.
- User work discovered on resume: index.html, package.json (dev port), and .vscode/mcp.json. These paths were excluded from EFR commits. Current npm run lint exits 1 solely for index.html formatting. An isolated HEAD-plus-EFR-tests snapshot passed npm run lint (exit 0). The current build includes the independent user HTML edits. Their visual behavior was not inspected as part of EFR.
- Status: P1B.4 and its scoped I6 expiry/recovery checks are complete. No comparative performance result is established. No-expiry ablation, I7 metrics, blackouts, recovery, validated replay imports, maximum-scale performance, cross-browser execution, visualization and deployment remain pending. JSON continuation checks cover trusted current-version state.
- NEXT: Phase 1B.5. Isolate expiry behavior using the same routing, scoring, transport and state model, retain a finite experiment tick cap, and expose incomplete runs honestly.

## Phase 1B.4 independent audit

- **VERIFIED-REPO** · Used the project simulation-audit skill on `05e591a`. Two corrections restore the existing 1b.4 replay encoding for equivalent trusted JSON snapshots.
- **OBSERVED-RUNTIME** · At seed 3 with six claims in flight, reversing the radio settings' field order changed the tick-1 checksum from `0873984e` to `710ea04e`. After `e58d4f7`, both snapshots produced `0873984e` at tick 1 and `b99ee82f` at tick 11.
- **OBSERVED-RUNTIME** · Reordering a queued envelope and its payload changed the first delivered event's bytes at tick 3. Three regression cases failed before `1954018` and passed afterward, covering observations, claims, releases and failed-recipient drops. The normal-order delivery bytes are pinned in `tests/transport-replay.test.ts`.
- **OBSERVED-RUNTIME** · `7b5cf12` traces each claim to the issuer's own frontier and each receipt to a delivered packet. On a fork with one send per tick, robot 2 switched goals at tick 9 and robot 1 at tick 10. Interleaved runs on different hidden graphs had identical planner inputs and actions through tick 11. Sensing the changed edge distinguished the views at tick 12.
- **OBSERVED-RUNTIME** · An owner issued a lease at tick 6 and failed at tick 7. Delivery at tick 9 blocked the survivor until tick 10. Delivery at tick 10 created no active claim. In a separate two-issuer fixture with a lost release and a wrong-issuer release, the survivor waited on ticks 2–5 and moved at tick 6 when the last lease expired.
- **OBSERVED-RUNTIME** · A Node comparison against `git show 088800d:src/sim/…` matched final states and event bytes for both baseline policies in 72 runs (seeds 0–11, three graph families, 14 nodes, three agents, 32 ticks). Another 36 EFR runs matched event bytes, states and hashes across JSON snapshots with every object reordered, batches of 1/0/4/3/8 ticks, 35% loss and a scheduled failure.
- **OBSERVED-RUNTIME** · `npm.cmd test -- tests/efr-audit.test.ts tests/efr.test.ts tests/transport-replay.test.ts` passed 70 tests. `npm.cmd test` passed 2,873 tests. Both exited 0, as did `npm.cmd run typecheck`, `npm.cmd run build` and `git diff --check`. `npm.cmd run lint` exited 1 in the workspace on the pre-existing `index.html` formatting and 0 in clean checkouts of the staged changes.
- **NOT VERIFIED** · These fixtures establish recovery after the last outstanding lease expires. Continually renewed claims, general mission completion, cross-browser replay and comparative exploration performance remain outside this gate. Phase 1B.5 was pending at this audit.

## Phase 1B.5 handoff · 2026-11-12

- **VERIFIED-REPO** · Shared policy factory and seven causal tests committed as `e2ecdad`; lifecycle, isolation and replay checks as `96fad14`. Loaded and applied burrowproof-simulation-audit. The algorithm versions are efr.1 and efr-no-expiry.1. Import both policies from src/sim/efr.ts and pass the selected policy to initialize/step/runTicks.
- **VERIFIED-REPO** · Policy.reservationExpiry selects enforced or disabled expiry through one shared predicate. Disabled expiry applies to stored/arriving/owned claims, pending announcements, transmission validation and release generation. Finite issuedTick/expiresTick fields and exact TTL arithmetic remain validated. Completion, abandonment, conflict, release identity, supersession, visited-target removal and bounded waiting use the same code.
- **OBSERVED-RUNTIME** · The local target-selection fixture first diverged at tick 5. In the owner-failure corridor, authorized observations and events matched through tick 9, then standard EFR moved on tick 10 while no-expiry waited through the tick-16 cap. Late claims and releases, duplicate suppression, overlapping issuers, total loss, zero survivors and hidden-world canaries passed.
- **OBSERVED-RUNTIME** · All 72 smoke runs (36 matched pairs) matched event bytes, state and hash across fresh runs, single steps, interleaved batches and reordered JSON snapshots. Queue length stayed at most 12, with one receipt per issuer and at most two pending announcements per peer.
- **OBSERVED-RUNTIME** · Seeds 0–11, three graph families, 14 nodes, three agents and a 64-tick cap were fixed before running. Both policies visited every node in every pair; ten pairs had identical event logs. No-expiry used fewer moves in six pairs and more in two. Full configurations, per-trial measurements and reproduction commands are recorded in [docs/ABLATION.md](docs/ABLATION.md). These exploratory seeds were previously exercised.
- **OBSERVED-RUNTIME** · An independent Node comparison loading committed TypeScript through git show matched standard EFR, nearest frontier and random walk against `1f1a422` in 108 runs, including state, canonical serialization and event bytes. Engine 1b.4 and prior checksum fixtures are preserved. The serialized algorithm version prevents switching variants during continuation.
- **OBSERVED-RUNTIME** · `npm.cmd test -- tests/efr-no-expiry.test.ts tests/efr-no-expiry-regression.test.ts tests/efr.test.ts tests/efr-audit.test.ts tests/transport-replay.test.ts` passed 86 tests. `npm.cmd test` passed 2,889 tests. Both exited 0, as did `npm.cmd run typecheck`, `npm.cmd run build` and `git diff --check`. Workspace `npm.cmd run lint` exited 1 on pre-existing index.html formatting; exact staged-checkout lint exited 0.
- **VERIFIED-REPO** · Preserved user edits in index.html, package.json and .vscode/mcp.json. The package edit changes only the dev-server port. No dependencies were added. The previously recorded development-dependency advisory remains tracked.
- **NOT VERIFIED** · No held-out efficacy, general superiority, physical-robot validation, maximum-scale performance or cross-browser replay is established. State continuation covers trusted current-version JSON. A permanent stale claim can leave the ablation waiting through its finite run cap.
- **NEXT** · Phase 1B.6 event-derived metrics. Define evaluator units and completion/timeout events, then verify a single aggregation path against independent fixtures. Mission Control and the full laboratory remain pending.
