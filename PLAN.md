# BurrowProof engineering handoff

## Milestones

| Phase | Status | Exit evidence needed |
| --- | --- | --- |
| P0 · Discovery and guardrails | Complete | See verification below |
| P1A · Engine foundation | Complete | I1–I3 and I8 tested on 200 fixed seeds, gates below |
| P1B · Exploration and coordination | Pending | Random and greedy policies, communication, failures (I5), reservations and metrics |
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
- NEXT: add random and nearest-frontier planners behind AgentView, then bounded comms and failure schedules, EFR/ablation, and independently checked metrics. These P1B tasks cover the coordination part of the original P2 milestone. Complete replay validation before marking that broader milestone complete.
