# Séance — Tech Steering

## Stack

- **Runtime:** Node 20, TypeScript (strict mode, no `any`)
- **Server:** Hono — single `src/server.ts` (`createApp(deps)`); routes `/api/summon`, `/api/ask`, `/api/ward`, `/api/exorcise`, `/api/health`, static `public/`; security headers (CSP) on every response; 64 KB body limit on `/api/*`; per-IP and daily limit on the model routes, separate per-IP limits on `/api/summon` and `/api/ward`, at most 3 concurrent remote clones and 500 sessions (`src/ratelimit.ts`, `.env.example`)
- **LLM:** Anthropic `claude-sonnet-5-5`, rules in the `system` parameter and escaped ledger text in the user turn, structured JSON output via Zod schemas; fixture/mock mode for all tests (fixtures keyed by `promptHash`)
- **Testing:** Vitest + fast-check (property-based tests) + jsdom (DOM tests of the page); run with `vitest --run`
- **Run:** `npm start` builds both samples (`scripts/make-crypt.sh`, `scripts/make-possessed.sh`) and serves with `tsx`; `npm run dev` uses `tsx watch` (run manually); `npm run build` is `tsc`

## Directory layout

```
src/
  evidence/   git.ts  refs.ts  github.ts  ledger.ts  ledger.input.ts
  ghost/      persona.ts  schema.ts  verifier.ts  llm.ts  report.ts
  exorcism/   score.ts  plan.ts
  errors.ts  ratelimit.ts  server.ts
public/       index.html  app.js  tokens.css  base.css  styles.css — vanilla, no framework, no build step
scripts/      make-crypt.sh  make-possessed.sh  contrast.mjs  record-plan-fixture.ts
test/         adversarial/  evidence/  ghost/  exorcism/  server/  ui/ (incl. ui/pbt/)  ratelimit.test.ts  fixtures/ (ghost-answers/, exorcism-plans/)
.kiro/        steering/  specs/  hooks/  agents/  settings/
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
npm run contrast   # WCAG contrast check of the colour tokens
npm run crypt      # (re)build the sample repository in data/crypt
npm run possessed  # (re)build the hostile sample repository in data/possessed
```
