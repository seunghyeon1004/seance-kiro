# Ward Hardening — Tasks

Commit messages: `ward-hardening T<N>: <description>`.

Each task starts by writing the tests that fail without it. Each task ends with `npm test`, `npm run typecheck` and `npm run lint` green. Tests that assert removed behaviour (design.md §13.2) change in the same task as the code they cover (N5). The baseline for "unchanged" checks is commit `d738258`.

---

## T1 — Schema constants and the new verifier

- [x] Write the failing unit tests in `test/ghost/verifier.test.ts`:
  - one test per reason F1–F11 and S1–S4 that asserts the exact sentence from design.md §4.2, with the citation's `sha7` in every citation reason (R1.9);
  - a quoteless citation, including a cast object that bypassed Zod, is rejected with F6 (R1.3);
  - a 7-character quote after `trim()` (F7) and a 501-character quote (F8) are rejected (R1.4);
  - a quote that only exists across the subject/body join, and a quote that only exists past `HUNK_UI_CHARS` in the hunk, are rejected with F9; a quote found in one field is verified (R1.5, R1.6);
  - two items sharing a `shortSha` make a citation of it fail with F5 (R1.7);
  - one malformed claim is rejected with F1 while the other claims in the same answer are still checked; 11 citations give F3 (R1.8);
  - a claim naming a year that no cited item is dated or mentions gets F10; the year boundaries follow R3.1 (`2019a` contains the year 2019, `12019` and `20190` contain no year);
  - a claim naming a ledger author who wrote no cited item and is not named in one gets F11; a name inside a longer ledger author's name is not counted separately (R3.2, R3.3);
  - a valid silence claim lands in `silent`, never `verified`; silence with a citation, an empty `silenceReason`, or text or `silenceReason` over 300 characters is rejected with S1–S4 (R4.1, R4.2);
  - `score` equals `verified / (verified + rejected + silent)` and is 1 for an empty result (R4.4).
- [x] Write the failing schema tests in `test/ghost/schema.test.ts`: `CitationSchema` requires `quote` with the 8/500 bounds (R1.1); `SilenceClaimSchema` caps `text` and `silenceReason` at 300; `GhostAnswerWireSchema` refuses 0 and 51 claims (R1.8); `VerifiedAnswerResponseSchema` requires `quotes`, `silent` and `tally`.
- [x] Write the failing property tests in `test/ghost/pbt/verifier.hardening.pbt.ts` for CP1–CP8 and the verifier half of CP9 (R1.3–R1.5, R1.7, R1.8, R1.10, R3.1, R3.2, R4.1, R4.4, R9.4, N2, N6). For CP4, add `test/ghost/pbt/legacy-verifier.ts`: `src/ghost/verifier.ts` from `git show d738258:src/ghost/verifier.ts`, changed only in import paths (and, if the new schema no longer types it, a local copy of the old `GhostAnswer` type).
- [x] Update the existing tests that assert removed behaviour, as listed in design.md §13.2: `test/ghost/verifier.test.ts` (quotes added, "handles all three kinds" expects `silent` and score `2/4`, the "Charles Babbage" test renamed because he is not a ledger author), `test/ghost/pbt/verifier.pbt.ts` (generators add quotes or expect rejection) and `test/ghost/schema.test.ts` (N5).
- [x] In `src/ghost/schema.ts`, add the constants `QUOTE_MIN_CHARS`, `QUOTE_MAX_CHARS`, `SILENCE_MAX_CHARS`, `MAX_CLAIMS`, `MAX_CITATIONS`, `HUNK_UI_CHARS`, and the citation, claim, `ClaimShapeSchema`, `GhostAnswerSchema`, `GhostAnswerWireSchema`, `VerifiedQuote`, `VerifierResult` and ask/ward response schemas from design.md §3. Leave the plan and exorcise schemas for T2 (R1.1, R1.6, N3).
- [x] Rewrite `src/ghost/verifier.ts` to the algorithm in design.md §4.1: one index per call, per-field quote search, `YEAR_RE` via `matchAll`, author masking with `indexOf`, no regular expression built from ledger or claim text, frozen result (R1.3–R1.9, R3.1–R3.3, R4.1, R4.2, R4.4, N2).
- [x] Make the minimum call-site changes so everything type-checks and behaves consistently:
  - `src/ghost/llm.ts`: parse model output and fixture files with `GhostAnswerWireSchema`, so a quoteless claim reaches the verifier instead of failing the answer, and the plan fixture's `0000000` envelope still loads;
  - `src/server.ts`: a shared `toAnswerResponse` for `/api/ask` and `/api/ward` with `verified[].quotes`, `citesSuspicious` (read from `item.suspiciousMessage`), `silent`, `tally` and the new `score`; `/api/ward` parses `GhostAnswerWireSchema`; the summon hunk uses `HUNK_UI_CHARS` (R1.6, R2.1, R4.3, R6.4);
  - `src/exorcism/plan.ts`: `verifyPlanClaims` reads the new `VerifierResult` and counts `silent` as rejected; the plan response shape stays as it is until T2;
  - `src/ghost/report.ts`: rejected items render `rc.text`.
- [x] Update `test/server/ask.test.ts`, `test/ghost/report.test.ts`, `test/ghost/pbt/report.pbt.ts`, `test/ghost/ask.fixture.test.ts` and `test/exorcism/plan.test.ts` where they assert the old response fields or the old score. Add assertions in `test/server/ask.test.ts` for `quotes`, `silent`, `tally` and `citesSuspicious` on both `/api/ask` and `/api/ward`, using a ledger item with `suspiciousMessage: true` set directly (R2.1, R4.3, R6.4).
- [x] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R1.1, R1.3–R1.10, R2.1, R3.1–R3.3, R4.1–R4.4, R6.4 (ask/ward), R9.4, N2, N3, N5, N6.

---

## T2 — Prompt layout, model wrapper and plan transport

- [x] Write the failing prompt tests in `test/ghost/persona.test.ts`: `buildPrompt` returns `{ system, user }` (R5.1); `system` contains no ledger field and no part of the question (R5.2); every interpolated value in `user` is escaped with `&` first, so `a&lt;b` in a commit becomes `a&amp;lt;b` (R5.3); only flagged items carry `suspicious="true"` (R5.4); the `<!-- UNTRUSTED … -->` comments are gone; the persona author appears only in `<persona author="…"/>`; the system text states the quote rule (R1.2).
- [x] Write the failing property tests in `test/ghost/pbt/persona.pbt.ts`: CP10, and the prompt half of CP9 for `buildPrompt` and `buildPlanPrompt` (purity, no input mutation) (R5.2–R5.5, N6).
- [x] Write the failing model-wrapper tests in `test/ghost/llm.test.ts`:
  - the client receives `system` as the `system` parameter and `user` as the only message (R5.1);
  - `promptHash` is `sha256(system + "\n\u0000\n" + user)`, first 8 hex characters (R5.7);
  - both tool schemas require `quote` with `minLength: 8` and `maxLength: 500`, `claims` has `maxItems: 50`, `citations` has `maxItems: 10`, and the silence branch caps `text` and `silenceReason` at 300 (R1.2);
  - a quoteless claim no longer triggers the retry; an envelope failure still does;
  - `askPlan` reads `test/fixtures/exorcism-plans/<hash>.json` as the raw tool input, and neither function falls back to the other directory;
  - DEBUG output contains `system` and the length of `user`, never ledger text;
  - the synthetic fixtures `c2b57afa.json` and `286eb0a0.json`, which these tests write themselves, are rewritten for the new format and hashes.
- [x] Write the failing plan tests in `test/exorcism/plan.test.ts`, `test/exorcism/pbt/plan.pbt.ts` (CP12) and `test/server/exorcise.test.ts`:
  - `buildPlanPrompt` returns `{ system, user }`, and each marker's `lineText` is cut to 80 characters, then escaped (R5.6);
  - a step or entry with zero verified claims moves to `dropped` with the fixed reason from R7.1 or R7.2, and its rejected claims (R7.1, R7.2);
  - one malformed plan claim rejects only itself; a silence claim in a plan is rejected with P1 (R7.3);
  - `verifierScore` counts dropped entries (R7.6);
  - no request or fixture uses the `0000000` envelope (R7.7);
  - with `REDACT_REJECTED=1`, dropped `title` and `modelText` are redacted;
  - `/api/exorcise` claims carry `citesSuspicious` (R6.4).
- [x] In `src/ghost/persona.ts`, add `ModelPrompt`, `escapeLedgerText` and `renderEvidenceBlock`, and rewrite `buildPrompt` to design.md §5.1 and §5.2, with the hunk cut to `HUNK_UI_CHARS` (R1.2, R1.6, R5.1–R5.5).
- [x] In `src/ghost/llm.ts`, implement design.md §6: `system` on `AnthropicCreateParams`, a private `callTool`, `promptHash`, `askGhost(prompt, sessionId, client?)` returning `GhostAnswerWire`, `askPlan(prompt, client?)`, the tool schemas, per-directory fixture loading and the DEBUG rule (R1.2, R5.1, R5.7, R7.7).
- [x] In `src/ghost/schema.ts`, replace the plan schemas with the raw `RefactorPlanSchema` and the plan response schemas from design.md §3, and remove the `Verified*Plan*` schemas. In `src/exorcism/plan.ts`, implement `buildPlanPrompt` (§5.3), `verifyPlanClaims` (§9.3) and `buildPlan(ledger, scored, sessionId, client?)` through `askPlan`. In `src/server.ts`, pass `ModelPrompt` to `askGhost` and map the new plan in `/api/exorcise` (R5.6, R6.4, R7.1–R7.3, R7.6, R7.7).
- [x] Update `scripts/record-plan-fixture.ts` to key files by `promptHash`, write the raw tool input in plan mode, keep `--ghost` and `--hash-only`, and print the hash (R5.7).
- [x] The prompt change moves the recorded fixtures' hashes, and fixtures are never edited by hand (R5.7). During the T2 session the two loading tests in `test/ghost/ask.fixture.test.ts` and `test/exorcism/plan.fixture.test.ts` were marked `it.skip`. The human then recorded both fixtures from real model calls with the new prompt (`b0b2564e.json`, `464f2680.json`), and the skips were removed in the same working tree, before any commit. No skip was ever committed. Then `npm test`, `npm run typecheck` and `npm run lint` ran green.

Covers: R1.2, R1.6 (prompts), R5.1–R5.6, R5.7 (keying and recorder), R6.4 (exorcise), R7.1–R7.3, R7.6, R7.7, N2, N3, N5, N6.

---

## T3 — Ward report

- [x] Write the failing tests in `test/ghost/report.test.ts` and `test/ghost/pbt/report.pbt.ts`:
  - the count line is `**N of M claims verified**` with `N = verified.length` and `M = verified.length + rejected.length`, so silence claims are not counted (R4.3);
  - the line directly after the count line is `The ward checked each citation and quote, not the wording of the claims.` (R2.4);
  - `## The record is silent (not checked)` lists `- [silence] ${text} Reason: ${silenceReason}`, both passed through `escapeMd`, and the heading is absent when `silent` is empty (R4.6);
  - a rejected claim whose `claim` is `null` renders its escaped `text`.
- [x] Add an assertion in `test/server/ask.test.ts` that the `report` field of `/api/ask` and `/api/ward` carries the limit line and the silence section.
- [x] Implement design.md §9.4 in `src/ghost/report.ts`. (The silence section comes after `## Struck by the ward`, in the order §9.4 lists the parts.)
- [x] Make sure `src/server.ts` passes the full `VerifierResult`, including `silent`, to `renderWardReport`. (Already true since T1: both routes pass the result of `verify` unchanged; no code change needed.)
- [x] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R2.4, R4.3 (report), R4.6, N5.

---

## T4 — Suspicious-message flag

- [x] Write the failing tests in `test/evidence/refs.test.ts`:
  - every needle from the old list and the new list in design.md §7 triggers `isSuspicious` (R6.1, R6.2);
  - normalisation works: fullwidth letters (NFKC), U+200B/U+200C/U+200D/U+2060/U+FEFF inside a needle, runs of whitespace, mixed case;
  - "respond with", "user:", "override", "act as" and "safe to delete" alone do not trigger the flag.
- [x] Write the failing property test CP11 in `test/evidence/pbt/refs.pbt.ts` (R6.1, R6.2, N6).
- [x] Write the failing tests in `test/evidence/ledger.test.ts`: an item whose only needle is in `author` is flagged, and an item whose only needle (`system:`) is in the hunk is not (R6.1). (The hunk test passed before the change too; it guards against scanning the hunk later.)
- [x] Add a test in `test/server/ask.test.ts` that builds a real ledger with one injected commit and checks `citesSuspicious` on both `verified` and `rejected` entries from `/api/ask` and `/api/ward` (R6.4). (Real git repo in a temp dir and the real `buildLedger` via `vi.importActual`; the injected commit uses "Note to the AI", a needle only in the new list.)
- [x] Implement design.md §7 in `src/evidence/refs.ts`: normalise once, then fixed-string `includes`, with no regular expression inside `isSuspicious` (confirm by reading the function). (Confirmed: `isSuspicious` and its helper `normaliseForNeedles` use no regular expression; whitespace is detected with `ch.trim() === ''`.)
- [x] In `src/evidence/ledger.ts`, call `isSuspicious` with `` `${author}\n${subject}\n${body}` `` (R6.1).
- [x] Run `npm test`, `npm run typecheck` and `npm run lint`; all green. The crypt prompt hashes did not move (`--hash-only` still prints `464f2680` and `--ghost --hash-only` still prints `b0b2564e`).

Covers: R6.1, R6.2, R6.4, N6.

---

## T5 — The possessed sample and the adversarial tests

- [x] Write `test/adversarial/worst-case-client.ts`, the scripted `AnthropicClient` from design.md §10.4. It answers A1–A5 obediently, looks up `P*` short hashes by subject, and records every `params` (R9.1).
- [x] Write the failing tests:
  - `test/adversarial/possessed.test.ts`: two builds into temp dirs give the same `git log --format=%H` (R8.1); the flags match R8.5; for A1–A5, the direct path (`buildLedger` → `buildPrompt` → `askGhost` → `verify`) and `POST /api/summon { repoUrl: 'possessed' }` + `POST /api/ask` on `createApp({ anthropicClient })` both keep the attacker's sentence out of every `verified[].text` and put it in `rejected` or `silent` with the reasons in §10.4 (R9.2); the `system` the client received holds no ledger author and no possessed subject or body (R9.3); the user turn has exactly 7 `<evidence ` openings and 7 `</evidence>` closings; the file sets a dummy `ANTHROPIC_API_KEY`, deletes `ANTHROPIC_FIXTURE` and makes no network call (R9.5);
  - `test/adversarial/self-quote.test.ts`: the documented limit in §10.4, with `citesSuspicious: true` and the quote and field in the response;
  - `test/server/summon.test.ts`: `possessed` resolves to `POSSESSED_DIR`, and an unbuilt sample returns 400 with the exact message from R8.2.
  (A1's reason is F6 followed by F10: once F6 strikes the citation, no cited item supports the year 2023, per §4.1 step 6. Mutation check: with the F6 check replaced by the old "accept a quoteless citation", A1 and A2 fail; with F9 removed, A3 fails because the sentence is verified; with F10 removed, A1 and A5 fail; with F11 removed, A5 fails; with both removed, A5's sentence is verified. `src/ghost/verifier.ts` was restored and `git diff` on it is empty.)
- [x] Write `scripts/make-possessed.sh [target-dir]` (default `data/possessed`) to design.md §10.1–§10.3: fixed dates, fictional people, `.example` emails, quoted heredocs, P1 and P4 hashes captured with `git rev-parse`, final line `possessed ready at … (7 commits)` (R8.1).
- [x] In `package.json`, change only the `scripts` entries: add `"possessed": "bash scripts/make-possessed.sh data/possessed"` and set `start` to `npm run crypt && npm run possessed && tsx src/server.ts`. The file has uncommitted local edits, so do not overwrite the rest of it (R8.3).
- [x] In `src/server.ts`, resolve `possessed` to `POSSESSED_DIR` with the R8.2 error, and add `createApp(deps)` with `export const app = createApp()`. `anthropicClient` is forwarded to `askGhost` and to `buildPlan`. The sessions, limiters and pool stay module-level (R8.2, R9.2).
- [x] Document `POSSESSED_DIR` in `.env.example`. Add `data/possessed/` to `.prettierignore` and `data/possessed/**` to the `ignores` list in `eslint.config.js`, as is already done for `data/crypt`, so a built sample does not break `npm run lint`.
- [x] Run `npm run possessed` twice and compare `git -C data/possessed log --format=%H`; then run `npm test`, `npm run typecheck` and `npm run lint`; all green. (Both builds gave the same 7 hashes. `data/possessed` is covered by the `data/` rule in `.gitignore`.)

Covers: R8.1, R8.2, R8.3, R8.5, R9.1, R9.2, R9.3, R9.5.

---

## T6 — Input and abuse limits

- [x] Write the failing tests in `test/server/hardening.test.ts`, using the list in design.md §13.1:
  - `../../etc/passwd`, `/etc/passwd` and a 501-line range each return 400 `VALIDATION_ERROR` without running git (R10.1);
  - a `GitError` or `CloneError` returns 422 with the fixed message, containing no `/tmp` or `seance-`, and `console.error` received the full error (R10.2);
  - a 70 KB body returns 413 `PAYLOAD_TOO_LARGE` and leaves `modelLimiter` unchanged (R10.3);
  - 51 claims sent to `/api/ward` return 400 (R10.4);
  - the 21st summon returns 429 `RATE_LIMITED` with `Retry-After` and leaves `modelLimiter` unchanged (R10.5);
  - with `MAX_CONCURRENT_CLONES=1` and a stubbed slow clone, the second remote summon returns 503 `BUSY` with `Retry-After: 30`; a failed or throwing clone releases its slot; `crypt` and `possessed` take no slot (R10.6);
  - the 501st session evicts the first (R10.7);
  - after 61 ward calls, the last returns 429, and `/api/ask` still succeeds with the model limiter's per-client and daily counters unchanged (R10.8).
  (The file sets `MAX_MODEL_CALLS_PER_DAY=1` before the server loads, so a request that touched the daily counter would make the following `/api/ask` fail. On the first run the whole file failed at setup because the limiters and pool were not exported yet. The 51-claim case already passed, because `GhostAnswerWireSchema` has enforced it since T1.)
- [x] Write the failing tests for `createSlotPool` in `test/ratelimit.test.ts`: up to `max` acquires succeed, the next returns `null`, release is idempotent, and `reset` frees every slot (R10.6).
- [x] Implement `createSlotPool` in `src/ratelimit.ts`. `createModelLimiter` and `clientKey` stay unchanged (R10.6, R10.9).
- [x] In `src/server.ts`, add the middleware order from design.md §8.2: `hono/body-limit` at 64 KB on `/api/*` before every limiter, the existing model limiter on `/api/ask` and `/api/exorcise`, then `summonLimiter` and `wardLimiter` through `limitBy` (R10.3, R10.5, R10.8, N1).
- [x] In `src/server.ts`, implement the summon flow from design.md §8.4: `validateLedgerInput`, the clone slot released in `finally`, `rememberSession` with the `SESSION_MAX` cap, and `toHttpError` with fixed messages after `console.error` (R10.1, R10.2, R10.6, R10.7).
- [x] Reset `summonLimiter`, `wardLimiter` and `clonePool` in the setup of `test/server/summon.test.ts`, `test/server/ask.test.ts`, `test/server/exorcise.test.ts` and `test/adversarial/possessed.test.ts` where they send many requests. Check that `git diff d738258 -- test/server/ratelimit.test.ts` is empty and that the file passes (R10.9).
- [x] Document `SUMMON_RATE_LIMIT_MAX`, `SUMMON_RATE_LIMIT_WINDOW_MS`, `WARD_RATE_LIMIT_MAX`, `WARD_RATE_LIMIT_WINDOW_MS`, `MAX_CONCURRENT_CLONES` and `SESSION_MAX` in `.env.example` and `render.yaml`.
- [x] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R10.1–R10.9, N1.

---

## T7 — UI

- [x] Write the failing static tests in `test/ui/spooky-ui.test.ts` for `public/index.html`: the `possessed` option in `#repo-list` and the new `#repo-help` text (R8.4); `#ward-limit` directly after `#verified-counter` with the exact R2.3 sentence (R2.3); the `plant-quote` label and placeholder; `#ex-summary-lab`, `#ex-tests-lab` and `#ex-dropped-wrap` with their copy (R7.4, R7.5); the `wrongauthor` preset button labelled "Blame the wrong author"; the new contrast rows in `public/tokens.css` (N4); no new `innerHTML` with untrusted data in `public/app.js` (N4).
- [x] Write the failing property tests in `test/ui/pbt/ui.pbt.ts`, extracting functions from `public/app.js` as that file already does:
  - `claimNode` gives verified claims "The words the ward found" with the field labels from R2.2 (R2.2), silent claims the R4.5 label and "Unanswered question: " (R4.5), and claims with `citesSuspicious` the R6.4 label (R6.4);
  - ledger rows with `suspiciousMessage` get `data-suspicious="true"` and the R6.3 text (R6.3);
  - the answer tally and `#verified-counter` use `tally.verified` of `tally.checked` with correct singular and plural silence text (R4.3);
  - the sample-default swap happens only when the fields still hold the other sample's defaults (R8.4);
  - the plan tally counts dropped entries, and an empty `steps` list shows "The ward kept no step of this plan." (R7.5, R7.6);
  - the `wrongauthor` preset cites a commit by another author whose `subject`, `body` and `hunk.slice(0, HUNK_UI_CHARS)` do not name the claimed author as a whole word (design.md §11.2), with a quote from its subject; it falls back to `misquote` for a single-author ledger or when no such pair exists.
- [x] Update `public/index.html` per design.md §11.1, and add the `wrongauthor` button after the `misquote` button (R2.3, R7.4, R7.5, R8.4).
- [x] In `public/app.js`, implement `SAMPLE_DEFAULTS` and the `#repo` change handler, the suspicious ledger rows, `claimNode(c, state)` for all three states, and `renderAnswer` with its order, tally and counter (R2.2, R4.3, R4.5, R6.3, R6.4, R8.4).
- [x] In `public/app.js`, implement the plant form: the 8-character quote notice that sends nothing, the new `invent` quote, always sending `{ sha7, quote }`, and the `wrongauthor` preset from design.md §11.2 (R1.1).
- [x] In `public/app.js`, implement the exorcism changes: the "not checked" labels, the empty-plan notice, `#ex-dropped` entries, `#ex-dropped-wrap.hidden`, and the tally across steps, entries and dropped entries (R7.4, R7.5, R7.6).
- [x] Add the rules from design.md §11.3 to `public/styles.css` (tokens only, no `transition: all`, no new animation), add the contrast rows to `public/tokens.css`, and run `npm run contrast` (N4). (One row added, `--color-accent` on `--color-paper`, 8.98:1. The conditional `--color-muted` on `--color-paper-3` row was not added, because `.found` sits on the claim's own background, not on `paper-3`. Long quotes, hashes, names and paths wrap through `overflow-wrap: anywhere` on the containers of untrusted text; the 320 px layout is checked statically only, since no browser was available.)
- [x] Read every new UI string and confirm that none claims the ward checks names outside the ledger, months or days, or the meaning of a sentence (R3.4).
- [x] Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast`; all green.

Also added `test/ui/dom.test.ts`: `public/index.html` in jsdom, `public/app.js` evaluated unmodified, every request handed to the real `createApp` in process with a scripted model, and both samples built into a temp dir. Only `fetch`, `matchMedia` and `Element.prototype.scrollIntoView` are stubbed.

Covers: R1.1 (form), R2.2, R2.3, R3.4, R4.3 (UI), R4.5, R6.3, R6.4 (UI), R7.4, R7.5, R7.6 (UI), R8.4, N4.

---

## T8 — Re-recorded fixtures and steering

This task needs a real `ANTHROPIC_API_KEY`. **The human runs the recording.** The agent does not call the model, and nobody edits fixture JSON by hand (R5.7).

Items 1–4 were done right after T2, before T3, because the human had already recorded both fixtures.

- [x] Remove the `it.skip` marks added in T2 from `test/ghost/ask.fixture.test.ts` and `test/exorcism/plan.fixture.test.ts`. Set their expected hashes to the values printed by `npx tsx scripts/record-plan-fixture.ts --hash-only` and `npx tsx scripts/record-plan-fixture.ts --ghost --hash-only` against `data/crypt` (`legacy/tax.js` lines 7–7). The tests now fail because the fixture files do not exist yet. (Done after T2: `--hash-only` printed `464f2680` and `--ghost --hash-only` printed `b0b2564e`; the files already existed, so the tests passed at once.)
- [x] Human: with a real key, run `ANTHROPIC_API_KEY=… npx tsx scripts/record-plan-fixture.ts` and `ANTHROPIC_API_KEY=… npx tsx scripts/record-plan-fixture.ts --ghost`, then commit the two new `<hash>.json` files as written. (Recorded by the human after T2: `test/fixtures/exorcism-plans/464f2680.json` and `test/fixtures/ghost-answers/b0b2564e.json`, not edited. Committing them is left to the human.)
- [x] Delete the stale `test/fixtures/ghost-answers/ebfa44af.json` and `test/fixtures/exorcism-plans/5de303db.json` once nothing references them. (Done after T2. Only historical spec and session records still name them.)
- [x] Update `test/fixtures/ghost-answers/README.md` and `test/fixtures/exorcism-plans/README.md` with the new hashes, the `promptHash` definition, the raw tool-input plan format and the recording commands (R5.7). (Done after T2.)
- [x] Update `.kiro/steering/evidence-rules.md` per design.md §13.3: mandatory quotes checked one field at a time, the silence bucket, the score formula, and a note that this spec supersedes `ghost-verifier` R3.5 and `ward-report` R1.4 (N7). (`.kiro/steering/product.md` and `tech.md` were also corrected: the `{ sha7, quote }` citation format, silence not counted as verified, the two samples, the new limits, `npm run possessed`, and the `adversarial/` and jsdom test folders.)
- [x] Run `npm test`, `npm run typecheck` and `npm run lint`; all green, with both fixture tests running and passing.

Covers: R5.7, N7.

---

## T9 — Final verification

- [x] Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast`; all green.
- [x] Build both samples with `npm run crypt` and `npm run possessed`; both print their ready line, and `data/possessed` has 7 commits.
- [x] Search `test/` for `it.skip`, `describe.skip` and `.only`; none added by this spec remain.
- [x] Compare `dependencies` and `devDependencies` in `package.json` with `d738258`; nothing added (N1). Check that `git diff d738258 -- test/server/ratelimit.test.ts` is empty (R10.9). (The one difference is `jsdom` 25.0.1 in `devDependencies`. It was added on purpose in commit 26654f2, separately from this spec, for the DOM tests, and is the one allowed exception. `dependencies` are unchanged, and the ratelimit test diff is empty.)
- [x] Confirm `npm run lint` reports no `@typescript-eslint/no-explicit-any` in the changed files under `src/` (N3).
- [x] Check that every requirement id R1.1–R1.10, R2.1–R2.4, R3.1–R3.4, R4.1–R4.6, R5.1–R5.7, R6.1–R6.4, R7.1–R7.7, R8.1–R8.5, R9.1–R9.5, R10.1–R10.9 and N1–N7 appears in at least one ticked task above, using the traceability table below.

Covers: N1, N3, N5, R10.9 (re-check), and the traceability check.

---

## Traceability

| Requirement | Task |
| --- | --- |
| R1.1 | T1 (schema), T7 (plant form) |
| R1.2 | T2 |
| R1.3 | T1 |
| R1.4 | T1 |
| R1.5 | T1 |
| R1.6 | T1 (constant, verifier, summon), T2 (prompts) |
| R1.7 | T1 |
| R1.8 | T1 |
| R1.9 | T1 |
| R1.10 | T1 |
| R2.1 | T1 |
| R2.2 | T7 |
| R2.3 | T7 |
| R2.4 | T3 |
| R3.1 | T1 |
| R3.2 | T1 |
| R3.3 | T1 |
| R3.4 | T7 |
| R4.1 | T1 |
| R4.2 | T1 |
| R4.3 | T1 (API), T3 (report), T7 (UI) |
| R4.4 | T1 |
| R4.5 | T7 |
| R4.6 | T3 |
| R5.1 | T2 |
| R5.2 | T2 |
| R5.3 | T2 |
| R5.4 | T2 |
| R5.5 | T2 |
| R5.6 | T2 |
| R5.7 | T2 (keying, recorder), T8 (recording) |
| R6.1 | T4 |
| R6.2 | T4 |
| R6.3 | T7 |
| R6.4 | T1 (ask/ward), T2 (exorcise), T4 (real ledger), T7 (UI) |
| R7.1 | T2 |
| R7.2 | T2 |
| R7.3 | T2 |
| R7.4 | T7 |
| R7.5 | T7 |
| R7.6 | T2 (API), T7 (UI) |
| R7.7 | T2 |
| R8.1 | T5 |
| R8.2 | T5 |
| R8.3 | T5 |
| R8.4 | T7 |
| R8.5 | T5 |
| R9.1 | T5 |
| R9.2 | T5 |
| R9.3 | T5 |
| R9.4 | T1 |
| R9.5 | T5 |
| R10.1 | T6 |
| R10.2 | T6 |
| R10.3 | T6 |
| R10.4 | T6 |
| R10.5 | T6 |
| R10.6 | T6 |
| R10.7 | T6 |
| R10.8 | T6 |
| R10.9 | T6, T9 |
| N1 | T6, T9 |
| N2 | T1, T2 |
| N3 | T1, T2, T9 |
| N4 | T7 |
| N5 | T1, T2, T3, T9 |
| N6 | T1, T2, T4 |
| N7 | T8 |

---

## T10 — Inquisitor review (2026-11-11)

Each item began with a test that failed for the stated reason before the code changed.

- [x] Write the failing tests for R11.1–R11.3: `/api/ward` with the review's unrelated sentence still gives `1 of 1` and a report with `## Citations verified` and no `## Verified` line (`test/server/hardening.test.ts`); the report heading in `test/ghost/report.test.ts`; the `.meta` limit sentence right after each tally (`test/e2e/crypt.test.ts` step 5). Change `renderWardReport` and `renderAnswer`.
- [x] Freeze today's verifier as `test/ghost/pbt/verifier-2026-11-11.ts` (import paths only changed; checked byte for byte against `HEAD`).
- [x] Write the failing tests for R11.4–R11.6 in `test/ghost/verifier.unicode.test.ts` (`２０２４`, `20\u200B24`, `A\u200Blice`, a tag character, a Hangul filler, a soft hyphen, a decomposed `José`, a ledger name hiding U+200B, quotes that match only in detection form, and the lower-case limit) and the properties CP10–CP13 in `test/ghost/pbt/verifier.unicode.pbt.ts`. Add `detectionText` and step 7b to `src/ghost/verifier.ts` (R11.4, R11.5, R11.7).
- [x] Check R11.7 and the hard rules: CP4 against `d738258` and CP10 against the frozen copy pass; `npx tsx scripts/record-plan-fixture.ts --hash-only` prints `464f2680` and `--ghost --hash-only` prints `b0b2564e`; `test/recordings.test.ts` passes, and all eight shipped recordings give the same verified, rejected and silent counts with both verifiers. No recording or fixture was edited.
- [x] Write the failing tests for R11.8 (`test/ui/bidi.test.ts`) and R11.9 (`test/ghost/report.test.ts`, P5 in `test/ghost/pbt/report.pbt.ts`). Add the CSS rule to `public/styles.css` and step 3 to `escapeMd`.
- [x] Write the failing tests for R11.10–R11.13 in `test/evidence/summon-bounds.test.ts`, with a mocked slow git layer and a mocked size probe: 50 slow `git show` calls fail with `HistoryError` within the deadline and start no further git call; the 60,000 ms default; local paths unaffected; a clone over `CLONE_MAX_MB` after the reads gives `CloneError`, after the map read has settled; `/api/summon` returns the fixed 422 for both, deletes the clone and frees the slot; a 300-character author and email become 256. Add `deadlineGuard`, `cloneSizeBytes` and the cuts. Document `SUMMON_DEADLINE_MS` in `.env.example`.
- [x] Update `.kiro/steering/evidence-rules.md` (detection form, raw quotes, the stated limits) and the `ward-report` design note.
- [x] Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast`; all green.

Covers: R11.1–R11.13.
