# Model Rate Limit — Requirements

Spec ID: `model-rate-limit`
Depends on: `ghost-verifier` (`/api/ask`), `exorcism-plan` (`/api/exorcise`)

## Why

The app runs publicly on Render with a real `ANTHROPIC_API_KEY`. `/api/ask` and `/api/exorcise` each call Claude, and nothing limits how often. One visitor or a script could spend the key's budget.

## Functional requirements

**R1.1** The system shall apply a per-client limit to every route that calls the model: `POST /api/ask` and `POST /api/exorcise`. Routes that do not call the model (`/api/summon`, `/api/ward`, `/api/health`, static files) shall not be limited.

**R1.2** The per-client limit shall be a sliding window: at most `RATE_LIMIT_MAX` requests (default 10) per `RATE_LIMIT_WINDOW_MS` (default 600000, 10 minutes) per client key.

**R1.3** The client key shall be the first entry of the `X-Forwarded-For` header (trimmed) when present and non-empty (Render's proxy sets it), otherwise the socket remote address, otherwise the string `unknown`.

**R1.4** A global cap shall limit model-calling requests across all clients to `MAX_MODEL_CALLS_PER_DAY` (default 300) per UTC day. The counter resets when the UTC date changes.

**R1.5** When either limit is exceeded, the system shall respond with HTTP 429, a `Retry-After` header in whole seconds, and the JSON body `{ error: string, code: "RATE_LIMITED" }`. The `error` text shall be in the app's voice: per-client "The spirits are tired. Let them rest a few minutes before you call again."; daily cap "The séance is closed for tonight. The spirits will answer again tomorrow."

**R1.6** A request rejected by a limit shall not count against either limit, and shall not call the model.

**R1.7** The limiter shall be in memory, have no new dependencies, take its clock as an injectable function for tests, and prune expired entries so memory stays bounded.

**R1.8** The UI shall show the 429 `error` text where it already shows API errors (no new UI needed if the existing error path displays `error`).

## Out of scope

Persistent or distributed limits, authentication, per-route budgets.
