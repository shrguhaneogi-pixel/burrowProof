# BurrowProof engineering handoff

## Milestones

| Phase | Status | Exit evidence needed |
| --- | --- | --- |
| P0 · Discovery and guardrails | Complete | See verification below |
| P1 · Engine core | Pending | I1–I3, I5, I8 and quality gates |
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
- VERIFIED-REPO: start `45572fc`, toolchain `c61f175`, simulation audit skill `d68b7ce`, visual audit skill `05456c8`. Locate this handoff commit with `git log -1 --oneline -- PLAN.md`.
- Handoff: Phase 0 gate met. No open P0 blocker. P1 is pending. Begin with seed substreams, connected graphs, AgentView, sensing and the single tick function. Use the simulation audit skill and run I1–I3, I5 and I8 before advancing. Product behavior and hosted deployment are NOT VERIFIED at P0.
