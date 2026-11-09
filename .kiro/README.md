# .kiro/ — Séance automation overview

## agents/archaeologist.json

A read-only code-archaeology agent. Launch it with:

```
kiro-cli --agent archaeologist
```

It answers questions about git history and code provenance using only `git log`, `git blame`, `git show`, `git diff`, and `git rev-list`. Every factual claim carries a bracketed short-SHA citation `[a1b2c3d]`. When the record is silent it says so; it never invents facts. Steering files (`evidence-rules.md`, `product.md`, `tech.md`) are loaded as resources so it understands the ledger schema and citation rules from day one.

---

## agents/warden.json

A builder agent (V2 engine) for small fixes: failing test first, then the smallest change. Its CLI agent hooks are the ones proven to fire from the command line:

- `postToolUse` with matcher `fs_write`: runs `npx tsc --noEmit` after every file write and prints the result back to the agent.
- `stop`: runs the full vitest suite when the agent finishes.
- `agentSpawn`: prints `git log` and `git status`. It did not log anything in non-interactive runs, so it is unproven.

Each hook appends a line to `docs/kiro-evidence/warden-hook-fires.log`. In the run that fixed the inverted line range bug it logged two `postToolUse fs_write` entries (typecheck exit 0) and one `stop` entry (287 tests passed).

Gotcha we hit: with `--agent warden`, `--trust-tools` on the command line did not widen the agent's own `allowedTools`. With only `fs_read` allowed, every write was denied, and Kiro's final summary still reported test results that never ran. Both runs are in `docs/kiro-evidence/warden-hooks-session.txt`.

## hooks/

### ghost-tests.json — `PostFileSave` on `src/ghost/**/*.ts`

Runs `npx vitest run test/ghost` automatically whenever you save a ghost source file. Output appears in the Kiro terminal panel. Catches verifier regressions before you commit.

### sloplint.json — `PostFileSave` on `public/**`

Runs the Hallmark atmospheric linter (`sloplint.mjs --genre atmospheric`) over `public/index.html`, `public/styles.css`, and `public/app.js` whenever any frontend asset is saved. Keeps the UI copy on-brand and free of generic filler. It calls a linter from a local Hallmark install that is not part of this repo, so on another machine it will not run as is.

### evidence-review.json — `UserPromptSubmit` matcher `/review-evidence`

A user-triggered review hook. Type `/review-evidence` in the Kiro chat to invoke it. The agent reads `git diff --cached` and cross-checks every change against the `evidence-rules.md` invariants:

- No claim may reach the user without at least one `{ sha7 }` citation.
- `src/ghost/verifier.ts` may not be weakened unless the commit message references a spec task ID.

Output is a ✅ / ❌ checklist per invariant.

---

## settings/mcp.json — workspace MCP servers

| Server | Command | Purpose |
|---|---|---|
| `git` | `uvx mcp-server-git --repository .` | Read-only git access for agents and tools (log, blame, show, diff) |
| `filesystem` | `npx -y @modelcontextprotocol/server-filesystem@2.0.1 .` | File access scoped to this repository root |

The filesystem server root is the repo directory, so agents cannot reach files outside it. It used to point at `uvx mcp-server-filesystem@latest`, a package that does not exist, so it never started. Kiro diagnosed and fixed that on 2026-11-09 (`docs/kiro-evidence/mcp-filesystem-fix-session.txt`).

List them: `kiro-cli mcp list workspace`

## specs/ — six specs

`evidence-ledger`, `ghost-verifier`, `exorcism-plan`, `spooky-ui` (written during the first week), `ward-report` and `model-rate-limit` (both added 2026-11-09). `model-rate-limit` was implemented by the warden agent, with two fixes by hand (pruning, socket-address fallback). `ward-report` asks for a Markdown export of the ward's verdict; Kiro CLI implemented all three tasks from the spec and ticked the boxes: T1 and T2 (`src/ghost/report.ts`, unit tests and four property tests), then T3 (a `report` field on `/api/ask` and `/api/ward` and a "Copy ward report" button).

### spooky-ui: hand-written first, then audited and finished by Kiro

The `spooky-ui` page was first written by hand on 2026-11-06: Kiro's batch run of that spec stopped on the free plan's monthly limit. On 2026-11-09, with credits available again, Kiro went back to it in three steps. First, it audited `public/` against all 52 requirements (27 met, 20 partial, 5 missing; `docs/kiro-evidence/spooky-ui-audit.md`). Second, the warden agent fixed the gaps that change nothing on screen, and added `test/ui/spooky-ui.test.ts`. The fixes: `aria-busy` while loading; an opacity substitute for the flicker under reduced motion; a candle flicker whose half-period runs from 4 s down to a 333 ms floor (at most 1.5 cycles a second); a "séance has ended" path for expired sessions; an inline error for an empty repository field; atomic tally announcements; and claim bubbles as `article` elements. One Kiro change was reverted in review: moving `--confidence` to the root element, which `.candle`'s own value shadows. Third, Kiro ticked only the 4 task items it could verify at that point. The other 84 described a module layout (`public/js/*`, three CSS files) that the hand-written UI never had. It did not implement hiding rejected claims in production (R3.7, R7.7), because showing them struck through is the product's point. Severity labels, step badges and collapsible steps were left for later at first, so the demo captures would stay valid. Then, after a user decision to match the spec fully (the demo video is re-rendered), the warden agent added the visible parts it had left out: a severity label next to the haunting score (Restless, Troubled, Haunted, Possessed), Reversible ✓ / Irreversible ⚠ badges on refactor steps, steps and do-not-touch entries as keyboard-collapsible `details` (open by default), a running "N of M claims verified this séance" counter, a "Performing exorcism…" status, and a contrast check (`scripts/contrast.mjs`, `npm run contrast`, 11 token pairs, all at least 4.5:1). That session also ended on a throttle. By hand: prettier, and a CSS fix where the list number overlapped the disclosure triangle. Kiro then rewrote `tasks.md` to describe the real files (one `app.js`, flat CSS) instead of the module split. In review I reopened four ticks that were reasoned rather than tested, fixed one wrong id, and corrected its reason for R3.7/R7.7. That left 116 verified and 4 open. The last four were property tests for the planchette angle, the fog opacity and the claims counter, plus the fast-check setup. Kiro's credits were spent by then, so I wrote them by hand in `test/ui/pbt/ui.pbt.ts`. All 120 are now verified. The module split was not done: it would put a working UI at risk near the deadline.

### Task lists checked against the code (2026-11-09)

Every `tasks.md` was re-checked against the code and tests.

- **exorcism-plan:** Kiro verified the tasks, then implemented the two that were missing: API tests for `/api/exorcise` and recorded plan fixtures with a fixture loader. Review caught two problems:
  - Kiro loosened the model-output schema to fix a real bug, a step whose claims were all rejected. The fix now applies only to the verified plan.
  - Its fixture test mocked the very loader it was meant to prove. I rewrote it.
- **evidence-ledger:** two items named files that never existed. They now point at what was built: `scripts/make-crypt.sh` and `test/evidence/crypt.test.ts`.
- **Steering:** `tech.md` now lists the real routes, files and commands.

All six specs are now fully ticked: 308 of 308 task items, each checked against code and tests. Two pieces were finished by hand after Kiro's credits ran out (48.58 of 50 used):

- The canonical plan fixture, `test/fixtures/exorcism-plans/5de303db.json`. It was recorded from a real model call on the sample crypt with `scripts/record-plan-fixture.ts`. It replaces the hand-made fixture Kiro had written for a toy ledger, and its test rebuilds the crypt with real git.
- The four `spooky-ui` property tests.

The ticks in `ghost-verifier` and `evidence-ledger` were then re-checked line by line against code and tests. Five ticked items turned out not to be true, and each was fixed and annotated in its `tasks.md`:

- `cloneRepo` had no tests (it was always mocked). Writing them exposed two bugs: the size cap used GNU-only `du -sb`, and concurrent clones shared one directory.
- The ghost integration test pointed at a missing crypt and never ran. It was replaced by a test on the real sample crypt with an answer recorded from the model.
- `.env.example` was missing the documented variables.

Redaction of rejected claims is opt-in (`REDACT_REJECTED`), not tied to production, and `git log -L` runs without `--follow`.

## Powers — Context7

Installed with `kiro-cli powers install context7` (Kiro CLI 3.1.0). What was observed, in `docs/kiro-evidence/powers-context7-session.txt`:

- The default (V2) engine did not see the power: the agent looked for a `context7` binary and fell back to its own knowledge.
- The V3 engine (`--v3`) listed the power through `/powers` and activated its `POWER.md` through the `kiro_powers` tool.
- The power's MCP server never connected in a non-interactive V3 session (the log says `MCP server 'power-context7-context7' is not connected`). So no Context7 docs were fetched. Kiro checked the `secureHeaders` option format against the installed `hono` type definitions instead.

The resulting code (Hono `secureHeaders` with a CSP, plus `test/server/headers.test.ts`) was written by Kiro in that session.

## Crew — two subagents in parallel

`kiro-cli crew -y` installed Kiro Crew 0.12.0 locally (managed Python, no paid plan asked for; it signs in through kiro-cli). A local gateway ran on port 5477 with an isolated `KIROCREW_HOME`, and `kirocrew spawn run` started two subagents at once:

- Task A wrote `test/exorcism/pbt/plan.pbt.ts` (six properties on `buildPlanPrompt`).
- Task B added the skip link in `public/index.html` and its focus style in `public/styles.css`.

The second subagent waited in the queue for a few seconds because the machine was low on memory, then both finished. Output in `docs/kiro-evidence/crew-parallel-session.txt`.

## What fires where (checked, not assumed)

- **Prompt hook (`evidence-review.json`)**: fired in a Kiro CLI 3.0.0 session when `/review-evidence` was typed (`docs/kiro-evidence/review-and-mcp-session.txt`). In the CLI 3.1.0 V3 engine it also fired on prompts that do not match `^/review-evidence` (seen on `/powers` and on a normal task prompt), so the matcher does not seem to be applied there.
- **Save hooks (`ghost-tests.json`, `sloplint.json`)**: written for Kiro's `PostFileSave` trigger. They have not been seen firing in the CLI (non-interactive runs do not emit file-save events), so treat them as IDE-side automation until shown otherwise.
- **CLI agent hooks (`warden.json`)**: `postToolUse` and `stop` fired in a non-interactive V2 run (`docs/kiro-evidence/warden-hook-fires.log`). `agentSpawn` did not log.
- **MCP servers**: the git server was called from a CLI session (`@git/git_log`) and connected again in the V3 runs. After the fix, the filesystem server was called through `@filesystem/list_directory` and `@filesystem/read_text_file`.
- **Archaeologist in V3**: the review pass found a real defect, but its `git` shell and `@git` MCP calls were denied in non-interactive V3, so it cited no commits.
