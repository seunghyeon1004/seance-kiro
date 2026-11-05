# Ghost Answer Fixtures

Fixture files in this directory are keyed by the SHA-256 hash (first 8 hex characters) of the
prompt string that would be sent to the LLM.

## How fixture mode works

When `ANTHROPIC_FIXTURE=1` is set, `askGhost()` in `src/ghost/llm.ts`:

1. Computes `sha256(prompt).slice(0, 8)` to get an 8-character hash.
2. Reads `test/fixtures/ghost-answers/<hash>.json`.
3. Parses it with `GhostAnswerSchema`.
4. Returns the typed `GhostAnswer`.

## Canonical fixture for integration tests

The canonical fixture used in `test/ghost/ask.integration.ts` is generated from:

- **Ledger source:** `test/fixtures/crypt/haunted.ts` (lines 1–5)
- **Question:** `"Why is there a hardcoded 3000ms delay in hauntedSleep?"`

To regenerate the fixture hash, run the integration test helper with `INTEGRATION=1`:

```
INTEGRATION=1 npx tsx test/ghost/ask.integration.ts
```

Or compute manually:

```ts
import { createHash } from 'node:crypto';
import { buildPrompt } from '../../src/ghost/persona.js';
// ... build ledger from crypt fixture, then:
const hash = createHash('sha256')
  .update(buildPrompt(ledger.items, question, sessionId))
  .digest('hex')
  .slice(0, 8);
```

## Adding new fixtures

1. Build the prompt using `buildPrompt()`.
2. Compute `sha256(prompt).slice(0, 8)`.
3. Create `<hash>.json` with a valid `GhostAnswer` object.
4. Document the question and ledger source here.

## Existing fixtures

| Hash     | Question                                    | Ledger source        |
| -------- | ------------------------------------------- | -------------------- |
| (varies) | "Why is there a hardcoded 3000ms delay...?" | crypt/haunted.ts:1-5 |
