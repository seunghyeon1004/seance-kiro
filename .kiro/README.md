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
