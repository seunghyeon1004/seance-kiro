# Exorcism Plan Fixtures

Canonical refactor plan fixtures for testing `buildPlan()` in fixture mode (`ANTHROPIC_FIXTURE=1`).

## Structure

Each fixture file is named `<hash>.json` where `<hash>` is the first 8 characters of the SHA-256 digest of the prompt that would generate it.

The hash is computed as:
```js
sha256(buildPlanPrompt(ledger, scoredResult)).slice(0, 8)
```

## Contents

Each fixture file contains a `GhostAnswer` JSON object with a single claim whose `text` field holds the stringified `RefactorPlan`:

```json
{
  "voice": "string",
  "sessionId": "uuid",
  "claims": [
    {
      "kind": "memory",
      "text": "{...stringified RefactorPlan JSON...}",
      "citations": [{"sha7": "abc1234"}]
    }
  ]
}
```

## Regeneration

To regenerate a fixture hash:

1. Run the corresponding test in `test/exorcism/plan.fixture.test.ts`
2. Extract the prompt from the test setup
3. In Node:
   ```js
   const crypto = require('crypto');
   const prompt = "...full buildPlanPrompt output...";
   const hash = crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 8);
   console.log(hash);
   ```
4. Create the fixture file with the computed hash name

## Current fixtures

- **Fixed ledger:** Single-item ledger with a 3-second sleep workaround commit (SHA: `abc1234`)
- **ScoreInput:** `{ authorGoneThresholdDays: 365, nowMs: 2026-11-09T00:00:00Z }`
- **Expected plan:** At least 2 characterization tests, 2 refactor steps, and 1 do-not-touch entry with a valid sha7 citation

See `test/exorcism/plan.fixture.test.ts` for the exact ledger definition and how to regenerate.
