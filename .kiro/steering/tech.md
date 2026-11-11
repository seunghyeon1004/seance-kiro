# Séance — Tech Steering

## Stack

- **Runtime:** Node 20+, TypeScript strict, no `any`. ESM (`"type": "module"`).
- **Server:** Hono, one `createApp(deps)` in `src/server.ts`. CSP and security headers on every response; 64 KB body limit on `/api/*`, applied before any limiter.
- **Model:** Anthropic `claude-sonnet-5-5` (`MODEL_ID` in `src/ghost/llm.ts`). Rules go in `system`; ledger text and the question go escaped in the one user turn (`src/ghost/persona.ts`). Output is a tool call parsed with Zod. `ANTHROPIC_FIXTURE=1` answers from `test/fixtures/` keyed by `promptHash`.
- **MCP:** `@modelcontextprotocol/sdk` over stdio, entry `src/mcp/server.ts`.
- **Tests:** Vitest, fast-check, jsdom. **Git:** execa with argument arrays.

## Routes (`src/server.ts`)

| Route | Does | Limit |
| --- | --- | --- |
| `GET /api/health` | status, model configured, built samples | none |
| `POST /api/summon` | build the ledger (line range, or `wholeFile: true`) and the haunting map | per-IP summon limit; `MAX_CONCURRENT_CLONES` (3) remote clones at once |
| `POST /api/ask` | ghost answer through the ward, or a recording | per-IP + daily model limit; recorded limit |
| `POST /api/exorcise` | haunting score and verified plan, or a recording | same as `/api/ask` |
| `POST /api/ward` | any claim set through the ward (planted claims) | per-IP ward limit |
| `POST /api/possess` | scripted possessed ghost through the ward | ward limit, never the model limit |
| `GET /*` | static files from `public/` | none |

Sessions live in memory (at most `SESSION_MAX`, oldest dropped first). All limits and timeouts are env vars in `.env.example`.

## Directory layout

```
src/evidence/  git.ts refs.ts github.ts ledger.ts ledger.input.ts haunting.ts haunting.read.ts
src/ghost/     schema.ts verifier.ts persona.ts llm.ts report.ts recordings.ts possessed-ghost.ts
src/exorcism/  score.ts plan.ts
src/mcp/       server.ts app.ts tools.ts repo.ts store.ts messages.ts console.ts
src/           errors.ts ratelimit.ts server.ts
public/        index.html app.js tokens.css base.css styles.css (vanilla, no build step)
recordings/    <key>.json recorded answers and plans for the two samples, README.md
scripts/       make-crypt.sh make-possessed.sh contrast.mjs record-answers.ts record-plan-fixture.ts
test/          adversarial/ e2e/ evidence/ exorcism/ fixtures/ ghost/ mcp/ server/ ui/
               (pbt/ under evidence, exorcism, ghost, mcp, ui) ratelimit.test.ts recordings.test.ts
```

## Conventions

- Zod at every boundary: HTTP requests and responses, model output, git output, MCP tool input, recordings. `src/ghost/schema.ts` is the source of truth for shapes.
- Git and every other subprocess run with argument arrays (`runGit` via execa, or `execFile`, in `src/evidence/git.ts`). Never build a shell string. Never execute code from a cloned repository. Remote URLs are GitHub only; clones use `--filter=blob:none --depth 100` into a temp dir with size and time caps.
- Errors: visitors see the fixed sentences in `ERROR_MESSAGES` (`src/server.ts`) or `MESSAGES` (`src/mcp/messages.ts`). Details (stderr, paths, command lines) go only to the server log.
- Every route that does work has a limit. A new route gets one in `createApp` before it ships.
- No new dependency without a decision recorded in a spec. Pin a new dependency to an exact version.
- Commit messages: `<scope>: <description>`, the scope being the spec and task when there is one (`haunting-map T5-T6: …`).

## Key commands

```
npm test            # vitest --run
npm run typecheck   # tsc --noEmit
npm run lint        # eslint . && prettier --check .
npm run contrast    # WCAG contrast of public/tokens.css
npm run crypt       # rebuild data/crypt
npm run possessed   # rebuild data/possessed
npm run mcp         # MCP server on stdio
npm start           # build both samples, serve with tsx; npm run dev = tsx watch (run it yourself)
```

Recording scripts call the real model. **Only a human with a real `ANTHROPIC_API_KEY` runs them**; an agent never does. `npx tsx scripts/record-answers.ts` writes `recordings/` (`--keys-only` makes no call). `npx tsx scripts/record-plan-fixture.ts [--ghost]` writes `test/fixtures/` (`--hash-only` makes no call).
