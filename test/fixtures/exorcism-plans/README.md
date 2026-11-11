# Exorcism plan fixtures

Recorded `refactor_plan` tool inputs for `askPlan()` (called by `buildPlan()`) in fixture mode (`ANTHROPIC_FIXTURE=1`). `askPlan()` reads only this directory; it never falls back to `test/fixtures/ghost-answers/`.

## The fixture key: `promptHash`

A file is named `<promptHash>.json`, where `promptHash` in `src/ghost/llm.ts` is

    sha256(system + "\n\u0000\n" + user).slice(0, 8)   // hex

over the `{ system, user }` prompt that `buildPlanPrompt()` returns (ward-hardening R5.7). Any change to the prompt text, the ledger or the score moves the hash, so the fixture must be recorded again from a real model call. Fixture JSON is never edited by hand.

## Format: the raw tool input

The file holds the `refactor_plan` tool input exactly as the model returned it: `{ characterizationTests, steps, doNotTouchList, summary }`, parsed with `RefactorPlanSchema`. There is no `GhostAnswer` envelope and no `0000000` placeholder citation (ward-hardening R7.7). Each step's and entry's `claims` are checked one by one by the ward in `verifyPlanClaims`.

## Canonical fixture: `464f2680.json`

- **Recorded from a real model call** with `npx tsx scripts/record-plan-fixture.ts`, using the ward-hardening `{ system, user }` prompt. Nothing was edited afterwards. The file holds only plan text and commit hashes from the fictional sample repository: no keys, emails or paths.
- **Ledger:** the sample crypt built by `scripts/make-crypt.sh` (fixed authors and dates, so the commit hashes are stable), `legacy/tax.js` line 7, which gives 2 evidence items.
- **ScoreInput:** `authorGoneThresholdDays: 365` and `nowMs = Date.UTC(2026, 10, 9)`. The resulting score is 57.
- **Prompt structure:** `system` holds the plan rules and the response format. `user` holds the escaped evidence block (one `<evidence>` element per commit) and the score block.
- **Used by:** `test/exorcism/plan.fixture.test.ts`.

It replaces `5de303db.json`, which was keyed by the old single-string prompt and wrapped the plan in an answer envelope.

## Recording

Print the hash only (no model call):

    npx tsx scripts/record-plan-fixture.ts --hash-only

Record again, with a real key (the human runs this; the agent does not call the model):

    ANTHROPIC_API_KEY=... npx tsx scripts/record-plan-fixture.ts

Then update the expected hash in `test/exorcism/plan.fixture.test.ts` and this README, and delete the old file.
