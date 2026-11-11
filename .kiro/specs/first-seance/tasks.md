# First Séance — Tasks

Commit messages: `first-seance T<N>: <description>`.

Each task starts by writing the tests that fail without it. Each task ends with `npm test`, `npm run typecheck` and `npm run lint` green (N8). Tests that assert changed behaviour (design.md §12.2) change in the same task as the code they cover (N5). The baseline for "unchanged" checks is commit `3486e14`. At the end of every task, `git diff 3486e14 -- src/ghost/verifier.ts src/ratelimit.ts test/server/ratelimit.test.ts` is empty (N2).

---

## T1 — Model failures and the health check

- [x] Write the failing tests in `test/ghost/llm-errors.test.ts`:
  - with an injected client that rejects with `new Anthropic.APIError(s, …)`, `askGhost` throws `ModelConfigError` for 401, 403 and 404 and `ModelBusyError` for 429, 529, 500 and 503; with `Anthropic.APIConnectionError` it throws `ModelBusyError` (R6.1);
  - a client that waits for the abort signal and then throws `Anthropic.APIUserAbortError` gives `TimeoutError` with `code === 'TIMEOUT'`, and so does one that throws a plain `Error` after the abort (R6.1, audit §4);
  - `askPlan` passes a signal that aborts after `LLM_PLAN_TIMEOUT_MS` (default 90,000 ms), and `askGhost` after `LLM_TIMEOUT_MS` (default 30,000 ms), checked with fake timers (R6.4);
  - none of these errors is retried, and a `ParseError` still is, once (R6.5);
  - `modelConfigured()` is true with a non-blank key or `ANTHROPIC_FIXTURE=1`, and false otherwise (R5.1).
- [x] Write the failing property test CP11 in `test/ghost/pbt/llm-errors.pbt.ts` (R6.1, R6.3, N6).
- [x] Write the failing tests in `test/server/first-seance.test.ts` (with `askGhost` and `buildPlan` mocked to throw):
  - every row of design.md §3.3 gives the exact status, code and message on `/api/ask` and `/api/exorcise` (R6.1);
  - `MODEL_BUSY` carries `Retry-After: 60` (R6.2);
  - no body contains `ANTHROPIC`, `sk-`, `/`, `ZodError` or `"path"`, and `console.error` received the full error (R6.3);
  - `GET /api/health` returns `model` and `samples` per R5.1, including `samples: []` when neither sample dir has `.git`.
- [x] Update `test/server/health.test.ts` to assert the two new fields, and the timeout test in `test/ghost/llm.test.ts` to assert `code === 'TIMEOUT'` (design.md §12.2).
- [x] In `src/errors.ts`, add `HistoryError`, `ModelConfigError` and `ModelBusyError`, and set `TimeoutError`'s code to `TIMEOUT` (design.md §4.1).
- [x] In `src/ghost/llm.ts`, export `MODEL_ID`, `modelConfigured` and `classifyModelError`, give `callTool` a `timeoutMs` parameter, and pass `LLM_TIMEOUT_MS` from `askGhost` and `LLM_PLAN_TIMEOUT_MS` from `askPlan` (design.md §4.2). The prompt and tool schemas do not change, so `--hash-only` must still print `464f2680` and `--ghost --hash-only` must still print `b0b2564e`.
- [x] In `src/server.ts`, rewrite `toHttpError` to design.md §3.3 (log first, fixed messages, optional headers), and extend `/api/health` per design.md §3.1 with `sampleDir` and `builtSamples` (R5.1, R6.1–R6.3).
- [x] Add `HealthResponseSchema` to `src/ghost/schema.ts` and parse the health response with it in the test (N3).
- [x] Document `LLM_PLAN_TIMEOUT_MS` in `.env.example`.
- [x] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R5.1, R6.1–R6.5, N3, N6.

---

## T2 — The line in question, the ghost's name and honest history (server)

- [x] Write the failing property test CP6 in `test/evidence/pbt/source.pbt.ts` for `sliceSourceLines` (R2.1, N6).
- [x] Write the failing tests in `test/evidence/history.test.ts`:
  - `logL` on a repository where `git log -L` fails (a mocked `runGit` rejection, and a real repo with `GIT_CALL_TIMEOUT_MS=1`) throws `HistoryError`, and empty output still returns `[]` (R8.1);
  - `isShallowRepo` is true for `git clone --depth 1 file://<3-commit repo>` and false for a full clone (R8.3);
  - `readLines` on a real repo returns line 7 of `legacy/tax.js` from a built crypt, cuts a 1,000-character line to 400, returns `[]` for a missing file, and returns at most 40 lines for a 60-line range (R2.1);
  - `buildLedger` with a mocked `cloneRepo` returning `shallow: true` passes `shallow: true` on, and returns `lines` frozen (R8.3).
- [x] Add CP7 to `test/ghost/pbt/persona.pbt.ts` (R2.2, N6).
- [x] Add tests to `test/server/first-seance.test.ts`:
  - the summon response has `lines`, `persona.author` equal to `mostFrequentAuthor(items)` and `shallow`, and parses with `SummonResponseSchema` (R2.1, R2.2, R8.3);
  - a `HistoryError` from `buildLedger` gives 422 `HISTORY_ERROR` with the fixed message (R8.1).
- [x] Add `readLines: vi.fn(async () => [])` to the `git.js` mocks in `test/evidence/ledger.test.ts` and `test/evidence/pbt/ledger.pbt.ts` (design.md §12.2).
- [x] In `src/evidence/git.ts`, implement `SOURCE_MAX_LINES`, `SOURCE_MAX_CHARS`, `sliceSourceLines`, `readLines`, `isShallowRepo`, `shallow` on `ResolvedRepo`, the `maxBuffer` option on `runGit`, and `logL` throwing `HistoryError` (design.md §5.1–§5.3).
- [x] In `src/evidence/ledger.ts`, read the lines before cleanup and return `lines` and `shallow` (design.md §5.4).
- [x] In `src/ghost/persona.ts`, rename `deriveMostFrequentAuthor` to `mostFrequentAuthor` and export it. `buildPrompt` calls it. The prompt text is unchanged, so check the two `--hash-only` hashes again (R2.2).
- [x] In `src/ghost/schema.ts`, add `SourceLineSchema`, the optional `lines` and `shallow` on `LedgerResultSchema`, and the new `SummonResponseSchema` (design.md §7). In `src/server.ts`, add `sample` to `SessionEntry` and the three summon fields (design.md §3.2).
- [x] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R2.1, R2.2, R8.1, R8.3, N3, N6.

---

## T3 — Recorded answers (server and script)

- [ ] Write the failing tests in `test/ghost/recordings.test.ts`:
  - `recordingTargetFor` for each sample's default range and each chip question, and `null` for another file, range, question or repository (R7.8);
  - `loadRecording` returns `null` for a missing file, and `null` plus `console.warn` for invalid JSON, a schema failure, and a file whose target fields differ from its key (R7.9);
  - `recordAnswers({ outDir: tmp, client: <scripted> })` writes exactly eight files named by `recordingKey`, each valid under `RecordingSchema`, with `model === MODEL_ID` and `ledgerShas` equal to the sample ledger's short hashes (R7.1);
  - the command line, run with `npx tsx scripts/record-answers.ts` and no key, exits 1 with the design.md §6.4 message and writes nothing, and `--keys-only` prints eight keys without a model call (R7.2).
- [ ] Write the failing property tests CP9 and CP10 in `test/ghost/pbt/recordings.pbt.ts`, and CP8 in `test/server/recorded.pbt.ts` (R7.1, R7.6, R7.8, N6).
- [ ] Add tests to `test/server/first-seance.test.ts`, with sessions summoned from built samples and a temp `RECORDINGS_DIR` filled by `recordAnswers`:
  - each of `MODEL_CONFIG`, `MODEL_BUSY`, `TIMEOUT` and `CONFIG_ERROR` on a chip question serves the recording with `recorded: true` and the live ward's verdict (R7.3, R7.6);
  - the same for `/api/exorcise` with the recorded plan and a live score (R7.4);
  - no recording for a free question, for `LLM_ERROR`, for a non-default range of `crypt`, for a GitHub session, or when the file is missing; these give the T1 errors (R7.8, R7.9);
  - live answers carry `recorded: false`, and `/api/ward` has no `recorded` (R7.5).
- [ ] Write the failing tests in `test/server/recorded-limits.test.ts` (it sets `MAX_MODEL_CALLS_PER_DAY=1` and `RATE_LIMIT_MAX=2` before the server loads) (R7.7):
  - with no key, ten recorded asks leave the limiter's per-client and daily counters untouched, and a later free question with a key set still gets its slot;
  - with the daily cap used up, a chip question gets the recording and a free question gets today's 429 body and `Retry-After`;
  - with the per-client limit used up, a chip question gets today's 429, not the recording.
- [ ] Implement `src/ghost/recordings.ts` per design.md §6.1–§6.3, and add `recorded` to the two answer response schemas (design.md §7).
- [ ] Implement `scripts/record-answers.ts` per design.md §6.4, with the header saying that a human with a real key runs it and never edits the output.
- [ ] Write `recordings/README.md` per design.md §6.5, with the eight keys from `--keys-only`. Do not add any `*.json` recording.
- [ ] In `src/server.ts`, implement `AppEnv`, the `onDaily` hook on `limitBy`, `modelGate`, `recordingForRequest`, `recordedAnswer`, `reportMeta`, `toExorciseResponse` and the two handlers (design.md §3.4). Confirm that `test/server/ratelimit.test.ts` passes unchanged and that `git diff 3486e14 -- src/ratelimit.ts` is empty (R7.7, N2).
- [ ] Document `RECORDINGS_DIR` in `.env.example`. Add `recordings/` to `.prettierignore`, as `test/fixtures/` already is, so the recorded files stay byte-for-byte as the script wrote them.
- [ ] Run `npm test`, `npm run typecheck` and `npm run lint`; all green. With no shipped recordings yet, the fallback is simply unavailable in production until T9.

Covers: R7.1–R7.9, N3, N6, N7.

---

## T4 — The shared DOM harness

- [ ] Move the setup of `test/ui/dom.test.ts` into `test/e2e/harness.ts` with the API in design.md §10.1: `buildSamples`, `openPage` (with `proxy`, `nodeTimers` and `onSummon`), `until` polling with `setImmediate`, `norm`, `REASONS`, and the scripted `CryptClient` and `DownClient` (design.md §10.2) (R11.1).
- [ ] Rewrite `test/ui/dom.test.ts` to use the harness, with no change to its assertions in this task. It must pass against the unchanged page, which shows the move preserved behaviour.
- [ ] Add a smoke test in `test/e2e/harness.test.ts` with the design.md §10.1 header: open the page, check that `#summon-form` exists, summon `crypt`, and see its ledger rows. Check that Node's global `fetch` was never called (R11.2). The health checks come in T5, when the page starts making that call.
- [ ] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R11.1, R11.2.

---

## T5 — The sleepy host (page)

- [ ] Write the failing property tests CP4 (`shouldRetry`) and CP5 (`waitInWords`) in `test/ui/pbt/first-seance.pbt.ts`, extracting the functions from `public/app.js` as `test/ui/pbt/ui.pbt.ts` does (R5.4, R5.5, R10.2, N6).
- [ ] Write the failing `test/e2e/wake.test.ts`, flow 4 of design.md §10.3, including the case where our own JSON 503 `BUSY` is not retried (R5.4–R5.6, R11.3).
- [ ] Add to `test/e2e/harness.test.ts`:
  - the first request after load is `GET /api/health`;
  - with `samples: ['crypt']` (possessed not built), the `possessed` option is removed from `#repo-list`;
  - with `model: false`, `#model-note` is shown with the R5.2 text (R5.2);
  - a 429 JSON body with `Retry-After: 300`, returned by the harness `proxy` for `/api/summon`, shows its message followed by "Try again in 5 minutes." (R10.2);
  - a summon of a remote URL, held open by a `proxy` promise that resolves later with a crafted summon body, shows `REMOTE_TEXT` in `#summon-status` and "1 second so far" in `#summon-elapsed` after one second (fake timers), and clears it when the summon ends (R10.4).
- [ ] In `public/app.js`, implement `RETRY_DELAYS_MS`, `WAKE_TEXT`, `NET_FAIL`, `proxyFail`, `shouldRetry`, `wait`, the new `api(path, body, opts)`, `waitInWords`, `wake()`, `REMOTE_TEXT` and `startElapsed()` (design.md §8.2–§8.5). Callers pass `summon-status`, `ask-status` and `exorcise-status`. The plant path passes `ask-status` until T7 adds `#ward-status` (R5.3–R5.7, R10.2, R10.4).
- [ ] In `public/index.html`, add `#summon-elapsed` and `#model-note` (design.md §8.9). In `public/styles.css`, add `#summon-elapsed:empty` (design.md §8.10).
- [ ] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R5.2–R5.7 (R5.7 for summon, ask and exorcise), R10.2, R10.4, R11.3 (flow 4), N6.

---

## T6 — Hero, the line in question, and pasted URLs (page)

- [ ] Write the failing property tests CP1–CP3 for `normaliseRepoInput` in `test/ui/pbt/first-seance.pbt.ts` (R9.1–R9.3, N6).
- [ ] Write the failing static tests in `test/ui/first-seance.test.ts`:
  - the R1.1–R1.3 copy is exact, the page contains neither "any line" nor "any repository", and the visible words in `#summon` number at most 85 (R1.1–R1.5);
  - `#source`, `#h-source`, `#source-meta`, `#source-lines`, `#crypt-shallow`, `#repo-note` exist with their attributes from design.md §8.9;
  - `app.js` has no `ghostName` and never reads `voice` for the name (R2.4);
  - the three `GITHUB_URL_RE` definitions are byte-identical to `3486e14` (R9.6).
- [ ] Write the failing DOM checks in `test/e2e/harness.test.ts`. Where a state cannot come from the real samples, the harness `proxy` returns a crafted `/api/summon` body:
  - after summoning `crypt`, `#source-lines` shows line 7 with `value` 7 and `#source-meta` the R2.3 text, and `#ghost-name` is `${persona.author}, speaking only from the commits.` (R2.3, R2.4);
  - a crafted body with `lines: []` shows "The text of these lines could not be read.";
  - a form range of 41 lines with a crafted body of 40 lines shows " Showing the first 40 lines." (R2.3);
  - a crafted body with no items shows "No commits touched these lines." in `#crypt-meta`, the R8.2 text in `#summon-status`, and "Speaks only from the commits." in `#ghost-name` (R2.4, R8.2);
  - a crafted body with `shallow: true` shows `#crypt-shallow` (R8.4);
  - pasting `https://github.com/o/r/blob/main/src/a.ts#L10-L20` into `#repo` and firing `change` fills `https://github.com/o/r`, `src/a.ts`, 10 and 20, and shows the R9.3 note; a tree link fills the folder and the R9.4 note (R9.3–R9.5);
  - a file typed as `/legacy/tax.js` is sent as `legacy/tax.js` (R9.5).
- [ ] In `public/index.html`, apply the R1 copy, `#source`, `.seance-col`, `#crypt-shallow` and `#repo-note` (design.md §8.9).
- [ ] In `public/app.js`, implement `normaliseRepoInput`, the `#repo` change handler, the `validate()` changes, `sourceMeta`, `renderSource`, the `#ghost-name` rule, the empty and shallow crypt states, and delete `ghostName` (design.md §8.1, §8.5, §8.8) (R2.3, R2.4, R8.2, R8.4, R9.1–R9.5).
- [ ] In `public/styles.css`, add `.lede`, `.seance-col` and `.source-lines` (design.md §8.10).
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast`; all green.

Covers: R1.1–R1.5, R2.3, R2.4, R8.2, R8.4, R9.1–R9.6, N4, N6.

---

## T7 — The guided path, planted claims and the accessibility fixes (page)

- [ ] Write the failing flow tests `test/e2e/crypt.test.ts`, `test/e2e/possessed.test.ts`, `test/e2e/recorded.test.ts` and `test/e2e/session.test.ts`, flows 1, 2, 3 and 5 of design.md §10.3, each with the design.md §10.1 header (R11.2, R11.3).
- [ ] Add to `test/ui/first-seance.test.ts`:
  - the guide's structure, ids, classes and copy from design.md §8.9 and §9;
  - `CHIP_QUESTIONS` in `app.js` deep-equals `SAMPLE_QUESTIONS` plus `OTHER_QUESTIONS` from `src/ghost/recordings.ts`;
  - `#q` has no `required` and the R3.9 placeholder;
  - no element has a positive `tabindex`;
  - every guide button is a `<button type="button">`;
  - `.plant-presets` sits inside `#guide-step-ward`, not inside `#plant`;
  - `#copy-report-btn` has `hidden` and no `disabled`;
  - `#verified-counter` and `#ex-verified` carry no `aria-live`, and the tally `el()` call carries no `role`, `aria-live` or `aria-atomic`;
  - no new `innerHTML` in `app.js`;
  - the CSS rules of design.md §8.10 for C12 and C14 exist (R3.1–R3.9, R10.1, R12.1, R12.3, R12.5, R12.6, N4).
- [ ] Add to the flow tests, where they fit:
  - an empty ask shows `#q-err` with the R3.8 text, sets `aria-invalid` and `aria-describedby` on `#q`, moves focus to `#q` and sends nothing, and typing clears it (R3.8);
  - a verified memory claim has the "Verified" label, and a lit row contains "Cited in the latest answer" (R12.7);
  - a ghost turn's `.turn-q` starts with a `.visually-hidden` "You asked: " (R12.8);
  - "Misquote a real commit" and "Blame the wrong author" each send at once, fill the manual form, and are refused with F9 and F11 (R3.3);
  - a second planted claim after the first leaves `state.lastReport` untouched, which shows as an unchanged copied report (R4.1);
  - `#exorcise-status` keeps the R12.3 text after the request ends (R12.3);
  - after a summon, `#summon-status` reads the R12.4 text and focus is on `#h-guide` (R12.4).
- [ ] Update `test/ui/dom.test.ts` and `test/ui/spooky-ui.test.ts` as design.md §12.2 lists: the counter after a planted claim, presets that send at once, the inverted P10 live-region checks, P11's location, and the copy button as `hidden` (N5).
- [ ] In `public/index.html`, add `#guide` with its three steps, `#ward-status`, `#q-err` and `#ex-recorded`. Move `.plant-presets`, `#exorcise-btn` (text "Start the exorcism") and `#exorcise-status` into the guide. Drop `required` from `#q`, the live attributes from `#verified-counter` and `#ex-verified`, and `disabled` from `#copy-report-btn` in favour of `hidden`. Set the `#plant` help text (design.md §8.9).
- [ ] In `public/app.js`, implement `CHIP_QUESTIONS`, `chipQuestions`, `sampleFor`, `renderGuide`, `setDone`, `presetClaim`, `askQuestion`, `plant`, `endSeance`, `openSeance`, `showQError` and `clearQError`. Change `renderAnswer` (planted guard, labels, recorded label, tally without live attributes), `claimNode` ("Verified"), `lightRows` (hidden text) and the exorcise handler (status text, `#ex-recorded`, `setDone`) (design.md §8.5–§8.8) (R3, R4, R7.10, R10.1, R10.3, R12).
- [ ] In `public/styles.css`, add the guide, chip, done, recorded, planted, C12 and C14 rules (design.md §8.10). In `public/tokens.css`, add the row `text: --color-accent | bg: --color-paper-3` and run `npm run contrast` (R12.9, N4).
- [ ] Read every new UI string against design.md §9 and confirm that none claims the ward checks names outside the ledger, months or days, or the meaning of a sentence.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast`; all green.

Covers: R3.1–R3.9, R4.1–R4.4, R5.7 (ward), R7.10, R10.1, R10.3, R11.2, R11.3 (flows 1, 2, 3, 5), R12.1–R12.9, N4, N5.

---

## T8 — The possessed ghost

No model is called in this task, by the code or by its tests. The scripted answer comes from `src/ghost/possessed-ghost.ts` only (R13.12, N7).

- [ ] Write the failing tests in `test/ghost/possessed-ghost.test.ts` per design.md §16.8:
  - on the possessed default ledger, `possessedAnswer` returns the five claims of the design.md §16.2 table in the order A1–A5, with `voice: 'scripted'`, and the A1 and A2 citations have no `quote` key (R13.2);
  - `verify` on it gives no verified claim, the four rejected claims with their R13.6 reasons, and the A4 silence claim (R13.6);
  - it returns `null` on the crypt ledger, on the possessed ledger for `auth/throttle.js` line 1 (after asserting it holds fewer than seven items), and on the default ledger with one item removed or one item duplicated (R13.2);
  - for each attack, `WorstCaseClient`'s claims deep-equal that attack's claims inside `possessedAnswer` (R13.3);
  - the module's source has no `node:` import, no `llm.js` import, no `Date` and no `Math.random` (R13.1).
- [ ] Write the failing property test CP12 in `test/ghost/pbt/possessed-ghost.pbt.ts` (R13.1, R13.2, N6).
- [ ] Write the failing tests in `test/server/possess.test.ts` per design.md §16.8:
  - the 200 response parses with `PossessResponseSchema`, has `scripted: true`, has no `sessionId` or `recorded` key, has the R13.6 buckets, reasons and tally, and apart from `scripted` deep-equals the `/api/ward` response for the same claims (R13.4–R13.6);
  - a crypt session and possessed sessions for line 1 and for lines 1 to 7 give 400 `NOT_POSSESSED` with the exact message (R13.4);
  - an unknown or missing `sessionId` and a body that is not JSON give the `/api/ward` 404 `SESSION_NOT_FOUND` body; a body over 64 KB gives 413 with `wardLimiter.size()` still 0 (R13.4);
  - after five possess calls, `modelLimiter.size()` is 0, `wardLimiter.size()` is 1, the injected model client was never called, and the route logged nothing (R13.4, R13.12);
  - `/api/ward`, `/api/ask` and `/api/exorcise` responses have no `scripted` key (R13.5).
- [ ] Write the failing `test/server/possess-limits.test.ts` (it sets `WARD_RATE_LIMIT_MAX=3`, `RATE_LIMIT_MAX=1`, `MAX_MODEL_CALLS_PER_DAY=1` and an empty `RECORDINGS_DIR` before the server loads): three possess calls give 200 and the fourth the ward limiter's 429, and one ask afterwards still gets 200, then a second ask gets the model limiter's 429 (R13.4).
- [ ] Extend `test/e2e/possessed.test.ts` with steps 6–10 of flow 2 and `test/e2e/crypt.test.ts` with step 10 of flow 1 (design.md §10.3). Add `F9` to `REASONS` in `test/e2e/harness.ts` (design.md §10.1) (R13.7–R13.10, R13.13).
- [ ] Add to `test/ui/first-seance.test.ts`: `#possess-btn` is a `<button type="button">` with `hidden` and the exact R13.7 text, and is the first button in `#guide-step-ward`; `app.js` contains the R13.8 label verbatim, and `/api/possess` appears only in `possess()` (R13.7, R13.8, R13.12).
- [ ] Implement `src/ghost/possessed-ghost.ts` per design.md §16.2, moving `SUBJECTS` and `ATTACKS` out of `test/adversarial/worst-case-client.ts` verbatim (R13.1, R13.2).
- [ ] Refactor `test/adversarial/worst-case-client.ts` per design.md §16.3. Confirm that `test/adversarial/` passes and that `git diff 3486e14 -- test/adversarial/possessed.test.ts test/adversarial/self-quote.test.ts` is empty (R13.3).
- [ ] In `src/ghost/schema.ts`, add `PossessRequestSchema` and `PossessResponseSchema`. In `src/server.ts`, add the ward limiter on `/api/possess`, `isPossessedDefault`, `NOT_POSSESSED_MESSAGE` and the route (design.md §16.4) (R13.4, R13.5, N3).
- [ ] In `public/index.html`, add `#possess-btn` (design.md §16.5). In `public/app.js`, add `SCRIPTED_LABEL`, `possess()`, `scriptedStatus()`, the `#possess-btn` line in `renderGuide`, and the `scripted` option of `renderAnswer` (design.md §16.5, §16.6). In `public/styles.css`, add `.lab.scripted` to the `.lab.recorded` rule (R13.7–R13.11).
- [ ] Read every new string against design.md §9 and §16.7. Confirm that the label says the answer is scripted and that no model was called, and that no string suggests a model produced it (R13.12).
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast`; all green. Confirm `git diff 3486e14 -- src/ghost/verifier.ts src/ratelimit.ts test/server/ratelimit.test.ts` is empty (N2).

Covers: R11.3 (flow 2 steps 6–10, flow 1 step 10), R12.9 (`#possess-btn`), R13.1–R13.13, N2, N3, N4, N6.

---

## T9 — Record the answers

This task needs a real `ANTHROPIC_API_KEY`. **The human runs the recording.** The agent does not call the model, and nobody edits a recording by hand (R7.2, N7).

- [ ] Write `test/recordings.test.ts` per design.md §12.1. It fails because `recordings/` holds no `*.json` yet. Do not commit it skipped.
- [ ] Human: run `npx tsx scripts/record-answers.ts --keys-only` and check that the keys match `recordings/README.md`. Then run `ANTHROPIC_API_KEY=… npx tsx scripts/record-answers.ts` and commit the eight files as written.
- [ ] Human, optional: read the logged tallies. A recorded answer the ward strikes is shown struck. That is honest, and no reason to record again.
- [ ] Run `npm test`, `npm run typecheck` and `npm run lint`; all green, with `test/recordings.test.ts` passing on the shipped files.

Covers: R7.1, R7.2, N7.

---

## T10 — Final verification

- [ ] Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast`; all green.
- [ ] Check that `git diff 3486e14 -- src/ghost/verifier.ts src/ratelimit.ts test/server/ratelimit.test.ts Dockerfile render.yaml` is empty (N2, out of scope).
- [ ] Compare `dependencies` and `devDependencies` in `package.json` with `3486e14`; nothing added (N1).
- [ ] Search `test/` for `it.skip`, `describe.skip` and `.only`; none added by this spec remain.
- [ ] Confirm `npm run lint` reports no `@typescript-eslint/no-explicit-any` in the changed files under `src/` and `scripts/` (N3).
- [ ] Human, in a real browser: at 1280x800 the headline, lede and Summon button are visible without scrolling. With the server stopped and restarted while the page is open, Summon shows the wake-up text and then completes. Tab through the guide in order, with a visible focus ring. On `possessed`, "Let a possessed ghost answer" shows the scripted label and the struck claims. Add screenshots to `docs/screens/` (R1.6, R13.8, N4).
- [ ] Check that every requirement id R1.1–R1.6, R2.1–R2.4, R3.1–R3.9, R4.1–R4.4, R5.1–R5.7, R6.1–R6.5, R7.1–R7.10, R8.1–R8.4, R9.1–R9.6, R10.1–R10.5, R11.1–R11.3, R12.1–R12.9, R13.1–R13.13 and N1–N8 appears in at least one ticked task above, using the traceability table below.

Covers: R1.6, R10.5 (re-check: no reason string changed, since `verifier.ts` is untouched), N1–N5, N8, and the traceability check.

---

## Traceability

| Requirement | Task |
| --- | --- |
| R1.1 | T6 |
| R1.2 | T6 |
| R1.3 | T6 |
| R1.4 | T6 |
| R1.5 | T6 |
| R1.6 | T10 (human, browser) |
| R2.1 | T2 |
| R2.2 | T2 |
| R2.3 | T6 |
| R2.4 | T6 |
| R3.1 | T7 |
| R3.2 | T7 |
| R3.3 | T7 |
| R3.4 | T7 |
| R3.5 | T7 |
| R3.6 | T7 |
| R3.7 | T7 |
| R3.8 | T7 |
| R3.9 | T7 |
| R4.1 | T7 |
| R4.2 | T7 |
| R4.3 | T7 |
| R4.4 | T7 |
| R5.1 | T1 |
| R5.2 | T5 |
| R5.3 | T5 |
| R5.4 | T5 |
| R5.5 | T5 |
| R5.6 | T5 |
| R5.7 | T5 (summon, ask, exorcise), T7 (ward) |
| R6.1 | T1 |
| R6.2 | T1 |
| R6.3 | T1 |
| R6.4 | T1 |
| R6.5 | T1 |
| R7.1 | T3 (format, script), T9 (shipped files) |
| R7.2 | T3 (script refusal, header, README), T9 (human run) |
| R7.3 | T3 |
| R7.4 | T3 |
| R7.5 | T3 |
| R7.6 | T3 |
| R7.7 | T3 |
| R7.8 | T3 |
| R7.9 | T3 |
| R7.10 | T7 |
| R8.1 | T2 |
| R8.2 | T6 |
| R8.3 | T2 |
| R8.4 | T6 |
| R9.1 | T6 |
| R9.2 | T6 |
| R9.3 | T6 |
| R9.4 | T6 |
| R9.5 | T6 |
| R9.6 | T6 |
| R10.1 | T7 |
| R10.2 | T5 |
| R10.3 | T7 |
| R10.4 | T5 |
| R10.5 | T10 |
| R11.1 | T4 |
| R11.2 | T4, T7 |
| R11.3 | T5 (flow 4), T7 (flows 1, 2, 3, 5), T8 (flow 2 steps 6–10, flow 1 step 10) |
| R12.1 | T7 |
| R12.2 | T7 |
| R12.3 | T7 |
| R12.4 | T7 |
| R12.5 | T7 |
| R12.6 | T7 |
| R12.7 | T7 |
| R12.8 | T7 |
| R12.9 | T7, T8 (`#possess-btn`) |
| R13.1 | T8 |
| R13.2 | T8 |
| R13.3 | T8 |
| R13.4 | T8 |
| R13.5 | T8 |
| R13.6 | T8 |
| R13.7 | T8 |
| R13.8 | T8, T10 (human, browser) |
| R13.9 | T8 |
| R13.10 | T8 |
| R13.11 | T8 |
| R13.12 | T8 |
| R13.13 | T8 |
| N1 | T10 |
| N2 | every task, T10 |
| N3 | T1, T2, T3, T8, T10 |
| N4 | T6, T7, T8, T10 |
| N5 | T1, T2, T7, T10 |
| N6 | T1, T2, T3, T5, T6, T8 |
| N7 | T3, T9 |
| N8 | every task, T10 |
