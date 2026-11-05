# Séance — Tech Steering

## Stack

- **Runtime:** Node 20, TypeScript (strict mode, no `any`)
- **Server:** Hono — single `src/server.ts`; routes `/api/summon`, `/api/ask`, `/api/exorcise`, `/api/health`, static `public/`
- **LLM:** Anthropic `claude-sonnet-5-5`, structured JSON output via Zod schemas; fixture/mock mode for all tests
- **Testing:** Vitest + fast-check (property-based tests); run with `vitest --run`
- **Build:** `tsc` then `node dist/server.js`; `npm run dev` uses `tsx watch` (run manually)

## Directory layout

```
src/
  evidence/   git.ts  refs.ts  github.ts  ledger.ts
  ghost/      persona.ts  schema.ts  verifier.ts  llm.ts
  exorcism/   score.ts  plan.ts
  server.ts
public/       vanilla HTML/CSS/JS — no framework
test/
.kiro/        steering/  specs/  hooks/  agents/
```

## Conventions

- Zod for every external boundary (LLM response, API request/response, git output)
- No code execution from cloned repos; GitHub-only remote URLs (SSRF allowlist)
- Remote clone: `git clone --filter=blob:none` into a temp dir; enforce size and time caps
- `EvidenceItem` and `GhostAnswer` shapes defined in `src/ghost/schema.ts` — treat as source of truth
- Lint: ESLint + Prettier; run `npm run lint` before committing
- Commit message format: `<scope>: <description>` — scope matches spec task ID when applicable

## Key commands

```
npm run build      # tsc
npm run lint       # eslint + prettier check
npm test           # vitest --run
npm run typecheck  # tsc --noEmit
```
