# Model Rate Limit — Design

## Module `src/ratelimit.ts`

```ts
export interface LimiterOptions { max: number; windowMs: number; dailyMax: number; now?: () => number }
export type LimitResult = { ok: true } | { ok: false; reason: 'client' | 'daily'; retryAfterSec: number };
export function createModelLimiter(opts: LimiterOptions): { check(key: string): LimitResult; reset(): void };
export function clientKey(xForwardedFor: string | undefined, remoteAddr: string | undefined): string;
```

- Per client: `Map<string, number[]>` of request timestamps; drop timestamps older than `now - windowMs` on each check; when an array empties, delete the key. Reject when `length >= max`; `retryAfterSec = ceil((oldest + windowMs - now) / 1000)`, at least 1.
- Daily: `{ day: 'YYYY-MM-DD' (UTC), count }`; roll over when the day changes. Reject when `count >= dailyMax`; `retryAfterSec` = seconds until next UTC midnight, at least 1.
- Check daily first, then client. Only record a request (push timestamp, increment count) when both pass (R1.6).

## Server wiring (`src/server.ts`)

- One limiter instance built from env (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `MAX_MODEL_CALLS_PER_DAY`, parsed as positive integers with the defaults above), exported for tests as `modelLimiter`.
- A Hono middleware applied to `/api/ask` and `/api/exorcise` only. Remote address comes from `@hono/node-server`'s `getConnInfo` when available; tests pass `X-Forwarded-For`.
- Runs before the body is parsed and before any model call.

## Testing

- `test/ratelimit.test.ts`: unit tests with an injected clock: 10 pass then the 11th is rejected with reason `client`; the window slides; separate keys are independent; the daily cap rejects with reason `daily` and resets on the next UTC day; rejected calls are not counted; `clientKey` picks the first X-Forwarded-For hop.
- `test/server/ratelimit.test.ts`: with the fixture model (`ANTHROPIC_FIXTURE=1`), 11 calls to `/api/ask` from one `X-Forwarded-For` give a 429 with `code: "RATE_LIMITED"` and a `Retry-After` header; a different IP still gets 200; `/api/ward` is not limited. Reset the limiter between tests.
