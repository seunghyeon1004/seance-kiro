# Model Rate Limit — Tasks

Commit messages: `model-rate-limit T<N>: <description>`.

## T1 — Limiter module
- [ ] Create `src/ratelimit.ts` per design.md and `test/ratelimit.test.ts`.

## T2 — Server wiring
- [ ] Apply the limiter middleware to `/api/ask` and `/api/exorcise` in `src/server.ts`; add `test/server/ratelimit.test.ts`; make sure existing server tests still pass (reset the limiter in their setup if needed).
- [ ] Document `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `MAX_MODEL_CALLS_PER_DAY` in `.env.example` and `render.yaml` if it lists env vars.
