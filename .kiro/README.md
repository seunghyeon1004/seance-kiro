# .kiro/ — Séance automation overview

## agents/archaeologist.json

A read-only code-archaeology agent. Launch it with:

```
kiro-cli --agent archaeologist
```

It answers questions about git history and code provenance using only `git log`, `git blame`, `git show`, `git diff`, and `git rev-list`. Every factual claim carries a bracketed short-SHA citation `[a1b2c3d]`. When the record is silent it says so; it never invents facts. Steering files (`evidence-rules.md`, `product.md`, `tech.md`) are loaded as resources so it understands the ledger schema and citation rules from day one.

---

## hooks/

### ghost-tests.json — `PostFileSave` on `src/ghost/**/*.ts`

Runs `npx vitest run test/ghost` automatically whenever you save a ghost source file. Output appears in the Kiro terminal panel. Catches verifier regressions before you commit.

### sloplint.json — `PostFileSave` on `public/**`

Runs the Hallmark atmospheric linter (`sloplint.mjs --genre atmospheric`) over `public/index.html`, `public/styles.css`, and `public/app.js` whenever any frontend asset is saved. Keeps the UI copy on-brand and free of generic filler.

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
| `filesystem` | `uvx mcp-server-filesystem@latest <repo>` | Sandboxed file reads scoped to this repository root |

Both servers are read-oriented. The filesystem server root is pinned to the repo directory so agents cannot access files outside it.

List them: `kiro-cli mcp list workspace`

## specs/ — five specs

`evidence-ledger`, `ghost-verifier`, `exorcism-plan`, `spooky-ui` (built during the first week) and `ward-report` (added 2026-11-09). `ward-report` asks for a Markdown export of the ward's verdict; Kiro CLI implemented its T1 and T2 (`src/ghost/report.ts`, unit tests and four property tests) from the spec and ticked the boxes. T3 (API field and copy button) is still open.

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
- **MCP servers**: the git server was called from a CLI session (`@git/git_log`) and connected again in the V3 runs. The `filesystem` server fails to start (`Connection closed` in the MCP log); it is not used by anything that was run.
