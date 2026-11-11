# Haunting Map — Tasks

Commit messages: `haunting-map T<N>: <description>`.

Each task starts by writing the tests that fail without it. Each task ends with `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast` green (N6). Tests that assert changed behaviour (design.md §11.2) change in the same task as the code they cover, and the commit message names them. The baseline for "unchanged" checks is commit `a6d0761`. At the end of every task, `git diff a6d0761 -- src/ghost/verifier.ts src/ratelimit.ts src/ghost/persona.ts src/ghost/llm.ts src/ghost/recordings.ts scripts/make-crypt.sh scripts/make-possessed.sh recordings/ test/fixtures/` is empty (N2, R7.1).

When this spec was written, another session had uncommitted accessibility changes in `public/`, `scripts/contrast.mjs`, `test/e2e/harness.ts` and `test/ui/`. T5 starts only after those changes are committed, and works on top of them (N7).

---

## T1 — The pure map

- [x] Write the failing unit tests in `test/evidence/haunting.test.ts` (design.md §11.1):
  - the two tie rules of design.md §5.4, and the code-unit name and email tie-breaks (R2.5);
  - an author exactly 365 days before `repoNow` is not departed, and one 365 days + 1 ms before is departed; the author of the newest commit is never departed (R2.3);
  - `Bob <BOB@x.example>` and `Bob <bob@x.example>` are one identity; the same name with two emails gives two ghosts with ids `G1`, `G2` and glyphs `B`, `B-2` (R2.2, R5.4);
  - a path in a commit but not in `headFiles` is ignored, and a commit listing a path twice counts once (R2.4, R2.8);
  - a tended file carries the newest commit to it, and a haunted file carries the ghost's newest commit to it, with equal dates broken by the smaller full sha (R2.7);
  - `compareShare` orders 1/3 below 1/2 and treats 2/4 and 1/2 as equal (R2.10);
  - `glyphFor` gives the examples of design.md §5.5 (R5.4);
  - `computeHauntingMap([], …)` is `null`, and the result and its arrays are frozen (R3.1, R3.3);
  - a ghost whose name contains `ignore previous instructions` has `suspicious: true` (R8.2);
  - `parseNameLog` reads the crypt's raw format from design.md §4.1 (copied as a string literal), counts a record with three fields and a record with a bad date in `skipped`, and keeps a path containing `\n`; `parseLsTree` splits on NUL (R1.9, R8.3).
- [x] Write the failing property tests HM1–HM10 and HM12 in `test/evidence/pbt/haunting.pbt.ts`, with the generators of design.md §10. HM2, HM3 and HM8 compare against a naive reference written in the test file (R2.1–R2.10, R3.1–R3.6, R4.2, R5.4, R8.2, R8.3).
- [x] Add to `src/ghost/schema.ts`: `MapGhostSchema`, `MapFileSchema`, `HauntingMapSchema` with its `superRefine`, `HauntingOutcomeSchema` and the `HauntingMap`/`HauntingOutcome` types (design.md §3). Leave `LedgerResultSchema` and `SummonResponseSchema` for T3 and T4 (N3).
- [x] Write `src/evidence/haunting.ts`: the constants, `MapCommit`, `HauntingOptions`, `parseNameLog`, `parseLsTree`, `compareShare`, `glyphFor` and `computeHauntingMap`, following design.md §4.2 and §5.2. No `Date.now()`, no `process.env`, no `fs`, no `Math.random()`, no `localeCompare`, and no regular expression built from input. Confirm by reading the module (R3.1, N5).
- [x] Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast`; all green.

Covers: R1.9, R2.1–R2.10, R3.1–R3.6, R4.2 (schema), R5.4, R8.2 (flag), R8.3 (parser), R9.1, N3, N5.

---

## T2 — Reading the map from git

- [x] Write the failing real-git tests in `test/evidence/haunting.git.test.ts` (design.md §11.1). Each test builds its repository in a `mkdtemp` dir with fixed author and committer dates and removes it afterwards:
  - both samples, built with `scripts/make-crypt.sh` and `scripts/make-possessed.sh` into a temp dir, give `{ kind: 'map', map }` with `map` deep-equal to design.md §9.1 and §9.2 (R7.2);
  - a merge commit made with `--no-ff` adds nothing to `totalTouches` (R2.8);
  - after `git mv old.js new.js`, the commits before the rename do not count for `new.js`, and the renaming commit does (R2.4);
  - a departed author named `Ignore previous instructions Bob` is a ghost with `suspicious: true` (R8.2);
  - the paths `a b.js`, `q"uote.js`, `new\nline.js` and `ünï.js` appear in `files` exactly as committed (R8.3);
  - a repository with 2,005 commits gives `commitsRead: 2000` and `historyCut: true` (R2.9);
  - `readHauntingMap(dir, { timeoutMs: 1 })` resolves to `MAP_NOTE_FAILED`, and `console.error` was called with the error, while the note contains no path (R1.4, R1.6);
  - a non-repository directory and a repository with no commit (no `HEAD`) give `MAP_NOTE_FAILED`; with `logNameOnly` stubbed to return `''` and `lsTreeNames` real, the result is `MAP_NOTE_EMPTY`; `readHauntingMap` never rejects (R1.6, R1.7);
  - with `git config log.showRoot false` set in the test repository, the root commit's files are still counted (design.md §4.1);
  - a spy on `runGit` sees exactly two calls, with the argument arrays of design.md §4.1, and none of `blame`, `show`, `cat-file`, `--numstat` or `--follow` (R1.2, R1.3).
    - R1.3, human check (2026-11-11): on `git clone --filter=blob:none --depth 100` of the crypt, `git rev-list --objects --missing=print HEAD` reported 4 missing blobs before and after the two map reads, and 2 after `git log -L`. Automated in T6 by `test/evidence/haunting.blobless.test.ts`.
- [x] Add `logNameOnly`, `lsTreeNames`, `MAP_LOG_MAX_BYTES` and `MAP_TREE_MAX_BYTES` to `src/evidence/git.ts`, using the existing `runGit` (design.md §4.1). Existing functions do not change.
- [x] Write `src/evidence/haunting.read.ts`: `HAUNTING_TIMEOUT_MS`, `MAP_NOTE_FAILED`, `MAP_NOTE_EMPTY` and `readHauntingMap`, following design.md §4.3. The two git calls run with `Promise.all`, and every error path resolves to the failed note after `console.error` (R1.2–R1.4, R1.6, R1.7).
- [x] Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast`; all green.

Covers: R1.2–R1.4, R1.6, R1.7, R2.4, R2.8, R2.9 (real git), R7.2, R8.2, R8.3, R9.2.

---

## T3 — Whole-file input and the ledger options

- [x] Write the failing tests in `test/evidence/whole-file.test.ts` (design.md §11.1), on a crypt built into a temp dir and on purpose-built repositories:
  - `buildLedger({ repoUrl, file: 'legacy/vendor.js', wholeFile: true })` returns `range: { startLine: 1, endLine: 13 }` and the items `e9a5c9c` and `dcb8969` (R6.4);
  - a 700-line file gives `range` 1–500 (R6.4);
  - an empty file throws `ValidationError` with `WHOLE_FILE_EMPTY`; a directory (`legacy`), a missing path and a 6 MB file throw `ValidationError` with `WHOLE_FILE_UNREADABLE`; neither message contains the path (R6.5);
  - `validateWholeFileInput` refuses `../x`, `/etc/passwd` and a non-GitHub URL before any git call, and `LedgerInputSchema`'s existing tests still pass unchanged (R6.3);
  - `buildLedger` without options returns no `haunting`, and a spy on `runGit` sees no `log --name-only` and no `ls-tree` (design.md §6.2);
  - `buildLedger(…, { hauntingMap: true })` on the crypt returns `haunting.kind === 'map'` and `items` deep-equal to the call without options (R4.4);
  - with `readHauntingMap` mocked to resolve after the ledger fails with `HistoryError`, `cleanup` runs only after it settled (R1.8);
  - `buildLedger` with `{ hauntingMap: true }` starts `readHauntingMap` before its first `blame` call (R1.5).
- [x] Write the failing property test HM11 in `test/evidence/pbt/whole-file.pbt.ts` (R6.4).
- [x] In `src/evidence/ledger.input.ts`, extract `FileSchema` and `checkRemoteUrl` with no change in behaviour or messages, then add `WholeFileInputSchema`, `WholeFileInput` and `validateWholeFileInput` (design.md §6.1) (R6.3).
- [x] In `src/evidence/git.ts`, add `WHOLE_FILE_MAX_LINES`, `countLines` and `lineCountAtHead` (`git cat-file blob HEAD:<file>`, 5 MB cap) (design.md §6.2) (R6.4).
- [x] In `src/ghost/schema.ts`, add the optional `range` and `haunting` fields to `LedgerResultSchema` (design.md §3).
- [x] In `src/evidence/ledger.ts`, add `BuildLedgerOptions`, accept `LedgerInput | WholeFileInput`, and implement design.md §6.2 steps 1–5: start the reader after the clone, compute the whole-file range, build the ledger for `range`, return `range` and `haunting`, and await the reader before `cleanup()` in `finally` (R1.1, R1.5, R1.8, R4.3, R6.4, R6.5).
- [x] Confirm the fixture hashes did not move: `npx tsx scripts/record-plan-fixture.ts --hash-only` prints `464f2680` and `npx tsx scripts/record-plan-fixture.ts --ghost --hash-only` prints `b0b2564e` (R7.3).
- [x] Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast`; all green.

Covers: R1.1, R1.5, R1.8, R4.3 (ledger), R4.4 (ledger), R6.3–R6.5, R7.3, N3.

---

## T4 — The summon route

- [x] Write the failing tests in `test/server/haunting.test.ts` (design.md §11.1), with `CRYPT_DIR` and `POSSESSED_DIR` pointing at samples built into a temp dir, and the limiters and clone pool reset before each test:
  - `POST /api/summon` for the crypt default returns `map` deep-equal to design.md §9.1, `range` `{ startLine: 7, endLine: 7 }` and no `mapNote`, and passes `SummonResponseSchema` (R4.1–R4.3, R7.2);
  - with `readHauntingMap` mocked to resolve to `MAP_NOTE_FAILED`, and separately with it mocked to throw, the summon is 200 with `mapNote` equal to `MAP_NOTE_FAILED`, no `map`, and `items` deep-equal to an unmocked summon's (R1.6, R4.1);
  - `{ repoUrl: 'crypt', file: 'legacy/vendor.js', wholeFile: true }` returns `range` 1–13, 2 items and `lines` of length 13 (R6.4);
  - `wholeFile` on `legacy/missing.js` returns 400 `VALIDATION_ERROR` with `WHOLE_FILE_UNREADABLE` (R6.5);
  - `wholeFile: true` with `startLine` returns 400 with "Send a line range or wholeFile, not both."; a body with neither form, and one with only `startLine`, return 400 with "Send a line range (startLine and endLine) or wholeFile: true." (R6.2);
  - `wholeFile` with `file: '../x'` returns 400 without calling `buildLedger` (spy) (R6.3);
  - the 21st whole-file summon from one client returns 429 `RATE_LIMITED` with `Retry-After`, and `modelLimiter` is unchanged (R6.6);
  - the stored session's ledger has no `haunting` key, and its `file`, `startLine` and `endLine` are the whole-file range (R4.4);
  - after a crypt summon, `/api/ask` with a capturing client sends `system` and `user` equal to `buildPrompt(session.ledger.items, question, sessionId)` for a ledger built by `buildLedger` without options (R4.4, R8.1).
- [x] Update the existing server tests listed in design.md §11.2 where they compare the whole summon body or assert Zod's `Required` message for a missing line (R6.2).
- [x] In `src/ghost/schema.ts`, add `range`, `map` and `mapNote` to `SummonResponseSchema`, with the refinement that `map` and `mapNote` never come together (R4.1).
- [x] In `src/server.ts`, implement design.md §6.3: the two-form `SummonRequestSchema`, `validateWholeFileInput` for the whole-file form, `buildLedger(…, { hauntingMap: true })`, `haunting` stripped before `rememberSession`, the session range, and the `range`, `map` and `mapNote` response fields. The limiters, the clone pool, `toHttpError`, `recordingTargetFor` and the other routes do not change (R4.1–R4.4, R6.2, R6.3, R6.6).
- [x] Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast`; all green. `git diff a6d0761 -- src/ratelimit.ts test/server/ratelimit.test.ts` is empty.

Covers: R1.6 (route), R4.1–R4.4, R6.2, R6.3, R6.6, R7.2 (route), R8.1 (prompt), R9.3.

---

## T5 — The page

Start from the committed a11y changes (see the note at the top).

- [x] Write the failing static tests in `test/ui/spooky-ui.test.ts` from design.md §11.4: the position, ids, heading and `#map-limit` copy of `#map-wrap`; `#map-living` closed; `--color-haunt` and the five contrast rows; the CSS rules for the fog, reduced motion, wrapping and the tile grid; no `transition: all`; no literal colour below the token block; no `innerHTML` in the map functions (R5.1, R5.2, R5.5, R5.8, R5.9, R8.1, N4).
- [x] Write the failing property tests in `test/ui/pbt/haunting-ui.pbt.ts`, extracting `commitsText`, `ghostLabel`, `mapMetaText` and `mapCutText` from `public/app.js` as the existing UI property tests do:
  - `commitsText(n, m)` uses "commit" only for `m === 1` (R5.11);
  - `ghostLabel` returns the warning wording, never the name, for a suspicious ghost (R8.2);
  - `mapCutText` contains the history, shallow and file-cap sentences exactly when they apply, in that order (R5.2).
- [x] Write the failing end-to-end test `test/e2e/haunting.test.ts`, with the five steps of design.md §11.3, using `buildSamples` and `openPage` from `test/e2e/harness.ts` and a `VendorClient` defined in the test file. The test makes no network call (R5.1, R5.3–R5.7, R5.10, R6.1, R6.7, R6.8, R8.2, R9.4, R9.5).
- [x] In `public/index.html`, add the `#map-wrap` block of design.md §7.1 inside `#seance`, after `.seance-in` and before `#exorcism-wrap` (R5.1).
- [x] In `public/app.js`, add `commitsText`, `ghostLabel`, `legendItem`, `mapTile`, `mapMetaText`, `mapCutText`, `renderMap` and `summonHere` (design.md §7.2), set `state.repoUrl` and `state.file` in `openSeance`, and call `renderMap(data, input.file)` there after the crypt is rendered. All text goes in with `textContent` or `el(…, { text })`. `--share` is set with `element.style.setProperty` (R5.1–R5.8, R5.10, R5.11, R6.1, R6.7, R6.8, R8.1, R8.2).
- [x] In `public/styles.css`, add the rules of design.md §7.4. In `public/tokens.css`, add `--color-haunt` and the five contrast rows of design.md §7.5, then run `npm run contrast` (R5.8, R5.9, N4).
- [x] Read every new UI string and confirm it is in sentence case, uses no emoji, joins no meta strings with middle dots, and claims nothing beyond design.md §5.3: no line-level ownership, no followed renames, no meaning (R2.11, N4).
  - Review note (by hand, 2026-11-11): Kiro reported that the page stated only three of R2.11's six limits. `#map-limit` now also says that merge commits are skipped, every path counts alike and `.mailmap` is not applied; design.md §7 and the static test were updated to the same sentence.
- [ ] Open the page in a browser at 320 px wide on the crypt and on a repository with long paths, and check that there is no horizontal scroll, that "Summon here" and "Tended by the living" are reachable by Tab with a visible focus ring, and that reduced motion removes the transition. If no browser is available, say so in the commit message, as `ward-hardening` T7 did (R5.9, R5.10).
- [x] Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast`; all green.

Covers: R2.11 (copy), R5.1–R5.11, R6.1, R6.7, R6.8, R8.1, R8.2 (UI), R9.4, R9.5, N4, N7.

---

## T6 — Final verification

- [x] Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast`; all green.
- [x] Check that `git diff a6d0761 -- src/ghost/verifier.ts src/ratelimit.ts src/ghost/persona.ts src/ghost/llm.ts src/ghost/recordings.ts scripts/make-crypt.sh scripts/make-possessed.sh recordings/ test/fixtures/` is empty (N2, R7.1).
- [x] Check that `npx tsx scripts/record-plan-fixture.ts --hash-only` prints `464f2680`, that `npx tsx scripts/record-plan-fixture.ts --ghost --hash-only` prints `b0b2564e`, and that `npx tsx scripts/record-answers.ts --keys-only` prints the eight keys listed in `recordings/README.md` (R7.3).
- [x] Compare `dependencies` and `devDependencies` in `package.json` with `a6d0761`; nothing added (N1).
- [x] Search `test/` for `it.skip`, `describe.skip` and `.only`; none added by this spec.
- [x] Confirm `npm run lint` reports no `@typescript-eslint/no-explicit-any` in the changed files under `src/` (N3).
- [x] Confirm that neither `src/ghost/persona.ts` nor `src/exorcism/plan.ts` imports `src/evidence/haunting.ts` or `src/evidence/haunting.read.ts` (R8.1).
- [x] Check that every requirement id R1.1–R1.9, R2.1–R2.11, R3.1–R3.6, R4.1–R4.4, R5.1–R5.11, R6.1–R6.8, R7.1–R7.3, R8.1–R8.3, R9.1–R9.5 and N1–N7 appears in at least one ticked task above, using the traceability table below.
- [x] R1.3 with real git: `test/evidence/haunting.blobless.test.ts` clones the crypt over file:// with `--filter=blob:none --depth 100` (`uploadpack.allowFilter` on the source, no network) and checks that `git rev-list --objects --missing=print HEAD` reports the same missing blobs before and after `readHauntingMap`, and fewer after `git log -L` as a control.

Covers: N1, N2, N3, R7.1, R7.3, R8.1 (re-check), and the traceability check.

---

## Traceability

| Requirement | Task |
| --- | --- |
| R1.1 | T3 |
| R1.2 | T2 |
| R1.3 | T2 |
| R1.4 | T2 |
| R1.5 | T3 |
| R1.6 | T2 (reader), T4 (route) |
| R1.7 | T2 |
| R1.8 | T3 |
| R1.9 | T1 |
| R2.1 | T1 |
| R2.2 | T1 |
| R2.3 | T1 |
| R2.4 | T1, T2 (real git) |
| R2.5 | T1 |
| R2.6 | T1 |
| R2.7 | T1 |
| R2.8 | T1, T2 (real git) |
| R2.9 | T1, T2 (real git) |
| R2.10 | T1 |
| R2.11 | T5 (copy) |
| R3.1 | T1 |
| R3.2 | T1 |
| R3.3 | T1 |
| R3.4 | T1 |
| R3.5 | T1 |
| R3.6 | T1 |
| R4.1 | T4 |
| R4.2 | T1 (schema), T4 (route) |
| R4.3 | T3 (ledger), T4 (route) |
| R4.4 | T3 (ledger), T4 (session, prompt) |
| R5.1 | T5 |
| R5.2 | T5 |
| R5.3 | T5 |
| R5.4 | T1 (glyph), T5 (UI) |
| R5.5 | T5 |
| R5.6 | T5 |
| R5.7 | T5 |
| R5.8 | T5 |
| R5.9 | T5 |
| R5.10 | T5 |
| R5.11 | T5 |
| R6.1 | T5 |
| R6.2 | T4 |
| R6.3 | T3 (schema), T4 (route) |
| R6.4 | T3 |
| R6.5 | T3 |
| R6.6 | T4 |
| R6.7 | T5 |
| R6.8 | T5 |
| R7.1 | T6 (and every task's diff check) |
| R7.2 | T2 (reader), T4 (route) |
| R7.3 | T3, T6 |
| R8.1 | T4 (prompt), T5 (UI), T6 |
| R8.2 | T1 (flag), T2 (real git), T5 (UI) |
| R8.3 | T1 (parser), T2 (real git) |
| R9.1 | T1 |
| R9.2 | T2 |
| R9.3 | T4 |
| R9.4 | T5 |
| R9.5 | T5 (and every test file) |
| N1 | T6 |
| N2 | T6 (and every task's diff check) |
| N3 | T1, T3, T6 |
| N4 | T5 |
| N5 | T1 |
| N6 | every task |
| N7 | T5 |

---

## T7 — Inquisitor review (2026-11-11)

- [x] Write the failing tests: in `test/evidence/haunting.git.test.ts`, a real repository whose second commit adds a file named `a` RS, `f` × 40, US, `Mallory`, US, an email, US, a date, through `git hash-object` and `git update-index --cacheinfo` (no file on disk); the map reads 2 commits, names no ghost Mallory and credits every file to a real sha (it read 3 before). In `test/evidence/haunting.test.ts`, the exact bytes git emits with a fake header inside a path, at its start, after a newline, and as the last path, plus a malformed header and old-format output. In `test/evidence/pbt/haunting.pbt.ts`, HM10 over hostile paths. Move the parser literals and the argument-array check to the R10.1 format.
- [x] Change the format in `logNameOnly` and the parse in `parseNameLog` (R10.1, R10.2). The reader still makes exactly two git calls.
- [x] Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast`; all green.

Covers: R10.1–R10.3.

---

## T8 — Polish addendum (2026-11-11, re-audits)

Done together with first-seance T12; design.md §14.

- [x] Change the failing expectations first: "by departed authors" in `test/ui/pbt/haunting-ui.pbt.ts` and `test/e2e/haunting.test.ts`; no button on the "You are here" tile and step 5 on the crypt map in `test/e2e/haunting.test.ts`; the disclosure text in `test/ui/spooky-ui.test.ts`; the markup order, the disclosure and the rules in `test/ui/polish.test.ts`; the `<bdi>` names and the open-file tile in `test/e2e/polish.test.ts`.
- [x] Move `#map-status` and `#map-err` after `#map-meta` and fold `#map-limit` into `details.map-limits` in `public/index.html`. Change `commitsText`, `hauntedBy`, `legendItem`, `mapTile` and `summonHere` in `public/app.js`, and the map rules in `public/styles.css` (R11.1–R11.7).
- [x] Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast`; all green. The reader, `computeHauntingMap` and `/api/summon` are unchanged.

Covers: R11.1–R11.7.

---

## T9 — Addendum: inquisitor second pass (2026-11-11)

- [x] Write the failing test in `test/evidence/haunting.git.test.ts`: a real commit whose author contains U+001F; `readHauntingMap` returned a map without it. Return `MAP_NOTE_FAILED` from `readHauntingMap` when `skipped > 0` (R12.1). `npx vitest run test/evidence test/e2e/haunting.test.ts test/mcp` passes.

Covers: R12.1.
