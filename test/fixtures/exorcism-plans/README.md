# Exorcism plan fixtures

Recorded refactor-plan answers for `buildPlan()` in fixture mode (`ANTHROPIC_FIXTURE=1`). In plan mode, `loadFixture()` in `src/ghost/llm.ts` looks here first and falls back to `test/fixtures/ghost-answers/`.

## Canonical fixture: `5de303db.json`

- **Recorded from a real model call** on 2026-11-09 with `scripts/record-plan-fixture.ts`. Nothing was edited afterwards. The file holds only plan text and commit hashes from the fictional sample repository: no keys, emails or paths.
- **Ledger:** the sample crypt built by `scripts/make-crypt.sh` (fixed authors and dates, so the commit hashes are stable), `legacy/tax.js` line 7, which gives 2 evidence items.
- **ScoreInput:** `authorGoneThresholdDays: 365` and `nowMs = Date.UTC(2026, 10, 9)`. The resulting score is 57.
- **Prompt structure:** `buildPlanPrompt()` renders a system block, the evidence block (one item per commit), the score block (overall score and the six signals) and the response-format block. The file name is `sha256(prompt).slice(0, 8)`.
- **Shape:** a `GhostAnswer` whose first claim's `text` is the JSON `RefactorPlan`. That is how the model tool returns a plan.

## Regenerate

Print the hash only (no model call):

    npx tsx scripts/record-plan-fixture.ts --hash-only

Record again, with ANTHROPIC_API_KEY set in the environment:

    npx tsx scripts/record-plan-fixture.ts

If the hash changes (for example after a prompt edit), record again and update the expected hash in `test/exorcism/plan.fixture.test.ts`.
