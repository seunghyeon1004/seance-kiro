---
inclusion: fileMatch
fileMatchPattern: 'test/**'
---

# Séance — Testing Steering

Applies to everything under `test/`. Run with `npm test` (`vitest --run`); never start Vitest in watch mode.

## Write the test first

- Write the test before the code. Run it and see it fail, and check that it fails for the reason the task names, not for a typo, an import or a missing fixture.
- Never mock the thing a test is meant to prove. A ward test calls the real `verify()`; a ledger test runs real git; a page test runs the real `public/app.js` against the real `createApp()`.
- No `it.skip`, `describe.skip` or `.only` in a commit.

## Never weaken to pass

- Never loosen a Zod schema, the verifier or a limit to make a test pass. Fix the code or the test.
- A new verifier rule comes with a fast-check property in `test/ghost/pbt/` showing it never verifies a claim that `verifier-2026-11-11.ts` or `legacy-verifier.ts` rejects. Never edit those frozen copies.

## Fixtures and recordings

- `test/fixtures/**/*.json` and `recordings/*.json` are written only by `scripts/record-plan-fixture.ts` and `scripts/record-answers.ts`, from real model calls run by a human with a real key. Never write or edit one by hand, and never ask an agent to.
- One documented exception: `test/ghost/llm.test.ts` writes two synthetic fixtures (named in `test/fixtures/ghost-answers/README.md`) to test the fixture loader itself. No other test writes under `test/fixtures/`.
- A test that needs a recording or a fixture writes its own into a temp dir (`fs.mkdtempSync(path.join(os.tmpdir(), '<prefix>'))`, with `RECORDINGS_DIR` pointed at it) and removes it afterwards.

## Git

- Anything that parses git output is tested with real git on a repository the test generates in a temp dir (`scripts/make-crypt.sh`, `scripts/make-possessed.sh`, or commits made in the test with fixed authors and dates). Never feed hand-written git output to a parser test alone.

## Page tests

- Page behaviour is tested in jsdom through `test/e2e/harness.ts`: `public/index.html` loaded, `public/app.js` evaluated unmodified, every request sent to the real `createApp()` in process. Only the model is scripted, by the client the test passes in.
- Each page test file says in its header what is stubbed (`fetch`, `matchMedia`, `scrollIntoView`, timers) and what is real.
- These are behaviour tests, not rendering tests: they prove text, attributes, focus and requests, never layout, colour or pixels. Do not claim visual results from them.

## Ticking a task

- Tick a task only after its test was run, it passed, and its claim was checked against the code.
- If something could not be verified, leave it unticked and write why next to it.
