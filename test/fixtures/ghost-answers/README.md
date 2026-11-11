# Ghost Answer Fixtures

Recorded `ghost_answer` tool inputs for `askGhost()` in fixture mode (`ANTHROPIC_FIXTURE=1`).

## The fixture key: `promptHash`

A file is named `<promptHash>.json`, where `promptHash` in `src/ghost/llm.ts` is

    sha256(system + "\n\u0000\n" + user).slice(0, 8)   // hex

over the `{ system, user }` prompt that `buildPrompt()` returns (ward-hardening R5.7). Any change to the prompt text, the ledger or the question moves the hash, so the fixture must be recorded again from a real model call. Fixture JSON is never edited by hand.

## How fixture mode works

When `ANTHROPIC_FIXTURE=1` is set, `askGhost()`:

1. Computes `promptHash(prompt)`.
2. Reads `test/fixtures/ghost-answers/<hash>.json`. It never falls back to `test/fixtures/exorcism-plans/`.
3. Parses it with `GhostAnswerWireSchema`: the envelope (`claims`, `voice`, `sessionId`) is strict, and each claim is left for the verifier.

## Canonical fixture: `b0b2564e.json`

- **Recorded from a real model call** with `npx tsx scripts/record-plan-fixture.ts --ghost`, using the ward-hardening `{ system, user }` prompt. Nothing was edited afterwards.
- **Ledger:** the sample crypt from `scripts/make-crypt.sh`, `legacy/tax.js` line 7 (2 evidence items). The commit hashes are stable because the script fixes authors and dates.
- **Question:** "Why does taxFor wait 3 seconds before calling the vendor?" The session id is `fixture-session`.
- **Used by:** `test/ghost/ask.fixture.test.ts`, which rebuilds the crypt with real git and runs buildPrompt, then askGhost in fixture mode, then verify.

It replaces `ebfa44af.json`, which was keyed by the old single-string prompt.

## Recording

Print the hash without a model call:

    npx tsx scripts/record-plan-fixture.ts --ghost --hash-only

Record again, with a real key (the human runs this; the agent does not call the model):

    ANTHROPIC_API_KEY=... npx tsx scripts/record-plan-fixture.ts --ghost

Then update the expected hash in `test/ghost/ask.fixture.test.ts` and this README, and delete the old file.

## Synthetic fixtures

Other `<hash>.json` files here (currently `50f6a8a5.json` and `76439609.json`) are synthetic answers that `test/ghost/llm.test.ts` writes and reads for its own unit tests, keyed by `promptHash` of fixed test prompts.
