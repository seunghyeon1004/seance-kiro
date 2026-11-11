# .kiro/ — Séance automation overview

## agents/archaeologist.json

A read-only code-archaeology agent that is held to the ward. Launch it with:

```
kiro-cli --agent archaeologist
```

It locates the code, calls Séance's own MCP server (`seance_summon`) to build the evidence ledger, drafts its claims with exact quotes, sends them to `seance_verify`, and states only what the ward verified; struck claims are shown struck with the ward's reason. `seance_haunting_map` tells it which files are haunted by departed authors. If the tools are unavailable it falls back to `git log`, `git blame` and `git show` and marks every claim "not checked by the ward". Steering files (`evidence-rules.md`, `product.md`, `tech.md`) are loaded as resources.

What happened when it ran on 2026-11-11 (`docs/kiro-evidence/seance-mcp-session.txt`): on the default V2 engine the three tools in `allowedTools` were auto-approved and it answered with 5 of 5 verified claims. On V3 without tool trust every call was denied, and it said so and marked its claims unchecked. On V3 with `--trust-all-tools` all three tools ran. That run found a real defect in our server (a silence claim sent without a `citations` field was refused), which was then fixed. The prompt and tool list were applied by hand from the `seance-mcp` design, because Kiro's own `kiro-scope` rule stops the agent from editing files under `.kiro/settings/` (it stopped and said so).

---

## agents/inquisitor.json

A read-only adversarial reviewer, added on 2026-11-11 and set to run on `gpt-5.6-sol`, a different model family from the one that wrote the code. Its one question: after a change, can anything reach the user marked verified without a deterministic check having found its evidence? It has `read` and a shell limited to `git diff/log/show/status`, `npx vitest run` and `npm test`. Two hooks: `agentSpawn` prints the files changed since the security audit, and `stop` logs how many files under `src`, `public`, `test`, `scripts` and `recordings` are modified, which should be 0 for a reviewer.

Its first run (`docs/kiro-evidence/inquisitor-review-session.txt`) confirmed eight findings in that day's work, among them that the "Verified" label overstated what the ward proves and that a file name could forge commits on the haunting map. Both hooks fired, and the stop hook logged `changed-files=0`. Its shell calls were denied in non-interactive V3, so it read files only and ran no test. The fixes are in `docs/kiro-evidence/inquisitor-fixes-session.txt`.

---

## agents/warden.json

A builder agent (V2 engine) for small fixes: failing test first, then the smallest change. Its CLI agent hooks are the ones proven to fire from the command line:

- `postToolUse` with matcher `fs_write`: runs `npx tsc --noEmit` after every file write and prints the result back to the agent.
- `stop`: runs the full vitest suite when the agent finishes.
- `agentSpawn`: prints `git log` and `git status`. It did not log anything in non-interactive runs, so it is unproven.

Each hook appends a line to `docs/kiro-evidence/warden-hook-fires.log`. In the run that fixed the inverted line range bug it logged two `postToolUse fs_write` entries (typecheck exit 0) and one `stop` entry (287 tests passed).

On 2026-11-11 the V3 engine upgraded this file to its own agent format by itself (the old file is kept as `warden.json.bak`). Since then all three hooks fire in non-interactive V3 runs, `agentSpawn` included: that day the log shows `agentSpawn` 15 times, `postToolUse` 686 times and `stop` 13 times. Every implementation session of the four new specs ran through this agent, so Kiro saw a typecheck result after each file it wrote.

Gotcha we hit: with `--agent warden`, `--trust-tools` on the command line did not widen the agent's own `allowedTools`. With only `fs_read` allowed, every write was denied, and Kiro's final summary still reported test results that never ran. Both runs are in `docs/kiro-evidence/warden-hooks-session.txt`.

## hooks/

### ghost-tests.json — `PostFileSave` on `src/ghost/**/*.ts`

Runs `npx vitest run test/ghost` automatically whenever you save a ghost source file. Output appears in the Kiro terminal panel. Catches verifier regressions before you commit.

### sloplint.json — `PostFileSave` on `public/**`

Runs the Hallmark atmospheric linter (`sloplint.mjs --genre atmospheric`) over `public/index.html`, `public/styles.css`, and `public/app.js` whenever any frontend asset is saved. Keeps the UI copy on-brand and free of generic filler. It calls a linter from a local Hallmark install that is not part of this repo, so on another machine it will not run as is.

### evidence-review.json — `UserPromptSubmit` matcher `/review-evidence`

A user-triggered review hook. Type `/review-evidence` in the Kiro chat to invoke it. The agent reads `git diff --cached` and cross-checks every change against the `evidence-rules.md` invariants:

- Every memory and speculation claim needs a `{ sha7, quote }` citation; the quote is mandatory and must be found in one field of the cited commit.
- A silence claim can never land in `verified`.
- `src/ghost/verifier.ts` may only become stricter.
- Recorded fixtures and recordings are never edited by hand.

Output is a ✅ / ❌ checklist per invariant. In the V3 engine this hook fires at the start of every session, not only on `/review-evidence` (see "What fires where"), so each of the 2026-11-11 sessions ends with that checklist. Kiro pointed out twice that the hook's text still said the quote was optional; the text was corrected by hand.

---

## settings/mcp.json — workspace MCP servers

| Server | Command | Purpose |
|---|---|---|
| `git` | `uvx mcp-server-git --repository .` | Read-only git access for agents and tools (log, blame, show, diff) |
| `filesystem` | `npx -y @modelcontextprotocol/server-filesystem@2.0.1 .` | File access scoped to this repository root |
| `seance` | `npx -y tsx src/mcp/server.ts` | Séance's own ledger and ward as tools (`seance_summon`, `seance_verify`, `seance_haunting_map`); local repositories only, no model inside. Added with `kiro-cli mcp add` |

The filesystem server root is the repo directory, so agents cannot reach files outside it. It used to point at `uvx mcp-server-filesystem@latest`, a package that does not exist, so it never started. Kiro diagnosed and fixed that on 2026-11-09 (`docs/kiro-evidence/mcp-filesystem-fix-session.txt`).

List them: `kiro-cli mcp list workspace`

## specs/ — ten specs

`evidence-ledger`, `ghost-verifier`, `exorcism-plan`, `spooky-ui` (written during the first week), `ward-report` and `model-rate-limit` (both added 2026-11-09), and `ward-hardening`, `first-seance`, `haunting-map` and `seance-mcp` (all 2026-11-11, described in "The 4,000-credit round" below). `model-rate-limit` was implemented by the warden agent, with two fixes by hand (pruning, socket-address fallback). `ward-report` asks for a Markdown export of the ward's verdict; Kiro CLI implemented all three tasks from the spec and ticked the boxes: T1 and T2 (`src/ghost/report.ts`, unit tests and four property tests), then T3 (a `report` field on `/api/ask` and `/api/ward` and a "Copy ward report" button).

### spooky-ui: hand-written first, then audited and finished by Kiro

The `spooky-ui` page was first written by hand on 2026-11-06: Kiro's batch run of that spec stopped on the free plan's monthly limit. On 2026-11-09, with credits available again, Kiro went back to it in three steps. First, it audited `public/` against all 52 requirements (27 met, 20 partial, 5 missing; `docs/kiro-evidence/spooky-ui-audit.md`). Second, the warden agent fixed the gaps that change nothing on screen, and added `test/ui/spooky-ui.test.ts`. The fixes: `aria-busy` while loading; an opacity substitute for the flicker under reduced motion; a candle flicker whose half-period runs from 4 s down to a 333 ms floor (at most 1.5 cycles a second); a "séance has ended" path for expired sessions; an inline error for an empty repository field; atomic tally announcements; and claim bubbles as `article` elements. One Kiro change was reverted in review: moving `--confidence` to the root element, which `.candle`'s own value shadows. Third, Kiro ticked only the 4 task items it could verify at that point. The other 84 described a module layout (`public/js/*`, three CSS files) that the hand-written UI never had. It did not implement hiding rejected claims in production (R3.7, R7.7), because showing them struck through is the product's point. Severity labels, step badges and collapsible steps were left for later at first, so the demo captures would stay valid. Then, after a user decision to match the spec fully (the demo video is re-rendered), the warden agent added the visible parts it had left out: a severity label next to the haunting score (Restless, Troubled, Haunted, Possessed), Reversible ✓ / Irreversible ⚠ badges on refactor steps, steps and do-not-touch entries as keyboard-collapsible `details` (open by default), a running "N of M claims verified this séance" counter, a "Performing exorcism…" status, and a contrast check (`scripts/contrast.mjs`, `npm run contrast`, 11 token pairs, all at least 4.5:1). That session also ended on a throttle. By hand: prettier, and a CSS fix where the list number overlapped the disclosure triangle. Kiro then rewrote `tasks.md` to describe the real files (one `app.js`, flat CSS) instead of the module split. In review I reopened four ticks that were reasoned rather than tested, fixed one wrong id, and corrected its reason for R3.7/R7.7. That left 116 verified and 4 open. The last four were property tests for the planchette angle, the fog opacity and the claims counter, plus the fast-check setup. Kiro's credits were spent by then, so I wrote them by hand in `test/ui/pbt/ui.pbt.ts`. All 120 are now verified. The module split was not done: it would put a working UI at risk near the deadline.

### Task lists checked against the code (2026-11-09)

Every `tasks.md` was re-checked against the code and tests.

- **exorcism-plan:** Kiro verified the tasks, then implemented the two that were missing: API tests for `/api/exorcise` and recorded plan fixtures with a fixture loader. Review caught two problems:
  - Kiro loosened the model-output schema to fix a real bug, a step whose claims were all rejected. The fix now applies only to the verified plan.
  - Its fixture test mocked the very loader it was meant to prove. I rewrote it.
- **evidence-ledger:** two items named files that never existed. They now point at what was built: `scripts/make-crypt.sh` and `test/evidence/crypt.test.ts`.
- **Steering:** `tech.md` now lists the real routes, files and commands.

As of 2026-11-09 all six specs were fully ticked: 308 of 308 task items, each checked against code and tests. (The count for all ten specs is in "The 4,000-credit round" below.) Two pieces were finished by hand after Kiro's credits ran out (48.58 of 50 used):

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
