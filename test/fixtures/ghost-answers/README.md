# Ghost Answer Fixtures

Fixture files in this directory are keyed by the SHA-256 hash (first 8 hex characters) of the
prompt string that would be sent to the LLM.

## How fixture mode works

When `ANTHROPIC_FIXTURE=1` is set, `askGhost()` in `src/ghost/llm.ts`:

1. Computes `sha256(prompt).slice(0, 8)` to get an 8-character hash.
2. Reads `test/fixtures/ghost-answers/<hash>.json`.
3. Parses it with `GhostAnswerSchema`.
4. Returns the typed `GhostAnswer`.

## Canonical fixture: `ebfa44af.json`

- **Recorded from a real model call** on 2026-11-09 with `npx tsx scripts/record-plan-fixture.ts --ghost`. Nothing was edited afterwards.
- **Ledger:** the sample crypt from `scripts/make-crypt.sh`, `legacy/tax.js` line 7. The commit hashes are stable because the script fixes authors and dates.
- **Question:** "Why does taxFor wait 3 seconds before calling the vendor?" The session id is `fixture-session`.
- **Used by:** `test/ghost/ask.fixture.test.ts`, which rebuilds the crypt with real git and runs buildPrompt, then askGhost in fixture mode, then verify.

Print the hash without a model call:

    npx tsx scripts/record-plan-fixture.ts --ghost --hash-only

The other entries here (`c2b57afa.json`, `286eb0a0.json`) are synthetic answers that `test/ghost/llm.test.ts` writes and reads for its own unit tests.

## Adding new fixtures

1. Build the prompt using `buildPrompt()`.
2. Compute `sha256(prompt).slice(0, 8)`.
3. Create `<hash>.json` with a valid `GhostAnswer` object.
4. Document the question and ledger source here.

## Existing fixtures

| Hash     | Question                                    | Ledger source        |
| -------- | ------------------------------------------- | -------------------- |
| (varies) | "Why is there a hardcoded 3000ms delay...?" | crypt/haunted.ts:1-5 |
