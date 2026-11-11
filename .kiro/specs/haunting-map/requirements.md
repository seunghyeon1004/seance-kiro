# Haunting Map — Requirements

Spec ID: `haunting-map`
Depends on: `evidence-ledger` (`buildLedger`, `validateLedgerInput`, `runGit`, `isSuspicious`), `ward-hardening` (`createApp(deps)`, the summon limiter, the clone pool, `possessed`, the 64 KB body limit), `first-seance` (the summon response's `lines`, `persona` and `shallow`, the e2e harness in `test/e2e/harness.ts`), `spooky-ui`.
Input: `.kiro/steering/*.md`, `src/evidence/git.ts`, `src/evidence/ledger.ts`, `src/exorcism/score.ts`, `src/server.ts`, `public/*`, `scripts/make-crypt.sh`, `scripts/make-possessed.sh`, `test/e2e/`.

## Why

Séance answers questions about one line. A maintainer who inherits a repository has an earlier question: where does the knowledge live only with people who have left? Today Séance cannot answer it. The visitor has to guess which file to summon.

After a summon, the page shows "The haunting map": each file of the repository, the departed author who changed it most, and how much of its history that departed group wrote. Each tile has a "Summon here" button that opens the séance on that file. The map follows the product's core rule: no invented memory. It is computed from git history by a deterministic function. No model is called, every number on the map is a count of commits, and every tile names the commit it rests on.

The decisions behind each group of requirements:

- **A. One cheap read, inside the summon (R1).** Remote repositories are cloned with `--filter=blob:none`, and the clone is deleted when `buildLedger` returns. The map therefore has to be read while the clone exists, and it must not download blobs. One `git log --name-only` call gives every commit's author, date and changed paths from commits and trees alone. One `git ls-tree -r --name-only HEAD` gives the files that exist now. `--numstat` and per-file blame are left out, because both need blobs. The read is capped at 2,000 commits and 10 seconds. The map is an extra: if the read fails or runs out of time, the summon still succeeds and the page says plainly why there is no map.
- **B. Definitions relative to the repository (R2).** Every definition uses the repository's own newest author date (`repoNow`), never the wall clock. The same repository state therefore always gives the same map, today and next year. Fixtures, the e2e tests and the sample screenshots stay stable for the same reason. An author is a name plus a lower-cased email, so two people who share a name stay apart and one person's casing of their email does not split them. "Departed" means the author's last commit in the history read is more than 365 days before `repoNow`. A file is "haunted by" the departed author who touched it most. Ties go to the one who touched it most recently, then to the name in code-unit order, so the result never depends on input order. `share` is the fraction of a file's commits written by departed authors, shown as "N of M commits by ghosts". These are the only numbers on the map. Renames are not followed, merge commits are skipped, and binary or vendored paths are counted like any other file. The spec states each of these limits instead of hiding them.
  - This is deliberately not the exorcism's "gone" signal (`src/exorcism/score.ts`). That signal measures time from the wall clock, and asks whether the authors of these lines have been quiet for a year as of today. The map asks a reproducible question about the repository's own activity. The two can disagree. For example, in November 2026 the score counts Tom Haskell as gone, while the crypt's map counts him as living, because the crypt's newest commit is his.
- **C. One pure function (R3).** All the logic lives in `computeHauntingMap(commits, headFiles, opts)`, which reads no clock, no environment and no filesystem. A thin git reader feeds it. That split lets fast-check test the properties that matter (shares stay in [0, 1], a ghost always touched the file, shuffling the input changes nothing, a living author's commit never raises a share) and lets real git tests pin the exact maps of the two samples. The response is validated by a Zod schema, like every other boundary.
- **D. A section, not a new page (R5).** The map sits between the séance and the exorcism, where the visitor already is after a summon. It works without colour: each ghost has a text glyph made from their initials, and every tile states its numbers in words. Fog intensity follows `share` only as a second signal. The map content is shown only when a map exists. When the server sends a reason instead, the section shows its heading and that sentence, so the absence is explained rather than silent.
- **E. "Summon here" (R6).** A tile is useful only if the visitor can act on it. "Summon here" summons that file without asking for line numbers. The server reads the file's length at HEAD with one git call and uses lines 1 to min(length, 500), which is the existing range cap. It returns the range it used, so the page can show the truth. It is an ordinary summon: same validation, same summon limiter, same clone slot, same errors.
- **F. The samples are not touched (R7).** The crypt already gives a useful map: four haunted files, two ghosts, one file tended by the living, two ties decided by recency, and one departed author who haunts nothing. Its expected map is computed in design.md §9 from the scripts' fixed dates and checked against real git. Changing the crypt would add risk for no gain. The recorded fixtures (`464f2680`, `b0b2564e`) and the recordings are keyed by the crypt and possessed ledgers and prompts, so this spec changes no commit, no prompt and no recording.
- **G. Hostile repositories (R8).** Author names and paths come from the repository and are untrusted. They are inserted with `textContent` only, and the map never enters a model prompt. A departed author whose name trips the existing `isSuspicious` check is not printed as a name, which follows the persona rule of `first-seance` R2.5. The page shows the existing wording, "A ghost whose name tries to give orders", with the glyph to tell such ghosts apart.
- **H. Tests (R9).** Unit and property tests cover the pure function. Real git tests cover the reader on both samples and on purpose-built repositories (a merge, a rename, a hostile departed author, unusual paths). Server tests cover the map, its failure and `wholeFile`. A jsdom end-to-end flow covers summon, map, "Summon here" on another file, and the change in the crypt and the line view.

## Scope

- A new pure module `src/evidence/haunting.ts` and a new reader `src/evidence/haunting.read.ts`.
- New git helpers in `src/evidence/git.ts`, an optional options argument and two optional result fields in `buildLedger` (`src/evidence/ledger.ts`), a whole-file input schema in `src/evidence/ledger.input.ts`.
- New schemas in `src/ghost/schema.ts`.
- The `/api/summon` route in `src/server.ts`.
- `public/index.html`, `public/app.js`, `public/styles.css`, `public/tokens.css` (one new colour token and its contrast rows).
- New tests under `test/evidence/`, `test/evidence/pbt/`, `test/server/`, `test/ui/` and `test/e2e/`.
- No new dependency, no model call, no change to the verifier, the rate limiters, the prompts, the samples, the recordings or the fixtures.

## Functional requirements

### R1 Reading the history (decision A)

**R1.1** When `/api/summon` builds a ledger, the server shall read the haunting map from the same repository directory, after any clone has finished and before the clone is deleted.

**R1.2** The reader shall make exactly two git calls: one `git log` with `--no-merges`, `--name-only` and a limit of `MAP_MAX_COMMITS + 1` (2,001) commits on `HEAD`, and one `git ls-tree -r --name-only HEAD`. It shall pass `--no-renames`, `--no-mailmap` and `-z` as design.md §4.1 lists. It shall not pass `--numstat`, `--stat`, `--patch` or `--follow`, and shall not run `git blame`, `git show` or `git cat-file`.

**R1.3** The reader shall not cause a blob to be downloaded on a `--filter=blob:none` clone. Both calls read only commits and trees.

**R1.4** Each of the two calls shall have a timeout of `HAUNTING_TIMEOUT_MS` (10,000 ms) and an output cap from design.md §4.1. The two calls shall run at the same time, so the reader takes at most about 10 seconds.

**R1.5** The reader shall start as soon as the repository directory is ready, and run alongside the ledger's own git calls.

**R1.6** The reader shall never throw. When either call fails, times out, exceeds its output cap, or produces a map that fails `HauntingMapSchema`, the summon shall succeed with the same ledger as without the map, and the response shall carry no `map` and the `mapNote` "The haunting map could not be drawn: git could not read the history in time. The séance is not affected." The full error shall be logged with `console.error`. No path, command line or git stderr shall reach the response.

**R1.7** When the history read contains no commit after merges are skipped, the response shall carry no `map` and the `mapNote` "The haunting map needs at least one commit, and none was read."

**R1.8** A failure of the ledger itself (for example `HistoryError`, `GitError` or `CloneError`) shall produce the same error response as today. The reader shall have settled before the clone is deleted, whether the ledger succeeded or failed.

**R1.9** Each commit record from `git log` shall be parsed and validated with a Zod schema. A record that fails validation shall be skipped and counted in a log line, and shall not make the reader fail. _Amended by R12.1 (2026-11-11): one skipped record makes the reader return the R1.6 note instead of a map._

### R2 Definitions (decision B)

**R2.1** `repoNow` shall be the newest author date among the commits used for the map, as a UTC ISO 8601 string.

**R2.2** An author shall be identified by their name, exactly as git records it, together with their email lower-cased with `toLowerCase()`. The map shall display only the name. Emails shall not appear in the response.

**R2.3** An author shall be departed when `Date.parse(repoNow) − Date.parse(lastCommitDate) > DEPARTED_AFTER_DAYS × 86,400,000`, where `lastCommitDate` is the newest author date of that author's commits used for the map and `DEPARTED_AFTER_DAYS` is 365. The author of the commit dated `repoNow` is therefore never departed.

**R2.4** For each path listed by `git ls-tree` that at least one commit used for the map changed, `touches(author)` shall be the number of that author's commits whose changed paths include the path exactly. A commit that renamed a file shall count as a touch of the new path. Commits that changed the file under an earlier name shall not count. The map shall not follow renames.

**R2.5** The file shall be haunted by the departed author with the most touches. A tie shall go to the author whose newest commit to that file has the later date, then to the name that sorts first in UTF-16 code-unit order, then to the email that sorts first in that order. A file that no departed author touched shall be "tended by the living", with `hauntedBy: null`.

**R2.6** `departedTouches` shall be the number of the file's commits written by departed authors, and `totalTouches` the number of all its commits. The UI shall show them as "N of M commits by ghosts", and `share` shall mean `departedTouches / totalTouches`.

**R2.7** A haunted file shall carry the haunting ghost's newest commit to that file: its `sha7` (`lastSha7`) and its author date (`lastSeen`). A file tended by the living shall carry the newest commit to the file by anyone. Ties between commits with the same date shall go to the full sha that sorts first in code-unit order.

**R2.8** Merge commits shall be skipped. Binary files, vendored directories, generated files, submodule entries and symlinks shall be counted like any other path listed by `git ls-tree`. Paths listed in a commit but absent from `git ls-tree` shall be ignored.

**R2.9** When more than `MAP_MAX_COMMITS` (2,000) distinct commits are available, only the newest 2,000 by author date (ties broken by full sha in code-unit order) shall be used, and the map shall carry `historyCut: true`.

**R2.10** At most `MAP_MAX_FILES` (300) files shall be listed. When more files qualify, the files kept shall be those with the largest `share`, then the path that sorts first in code-unit order. The map shall carry `truncated: true` and `filesConsidered`, the number of files that qualified. Shares shall be compared exactly by cross-multiplication, not as floating-point numbers.

**R2.11** The UI and the design shall state these limits in plain words: renames are not followed, lines are not attributed one by one, merges are skipped, every path counts alike, `.mailmap` is not applied, and a shallow clone holds only its newest 100 commits.

### R3 The pure function (decision C)

**R3.1** `computeHauntingMap(commits, headFiles, opts)` in `src/evidence/haunting.ts` shall compute the whole map from its arguments. It shall read no clock, no environment variable, no file and no randomness, shall not mutate its input, and shall return a frozen result.

**R3.2** For the same commits and head files in any order, and with commits repeated by `sha`, the function shall return deep-equal results.

**R3.3** The function shall return `null` when no commit is given.

**R3.4** The map shall list `ghosts` only for departed authors who haunt at least one listed file. Each ghost shall carry an id `G1`, `G2`, … in list order, the name, a glyph (R5.4), `suspicious` (R8.2), `lastSeen` (the ghost's newest author date in the history used) and `files` (the number of listed files it haunts).

**R3.5** Ghosts shall be ordered by `files` descending, then `lastSeen` descending, then name, then email, in code-unit order.

**R3.6** `files` shall be ordered by ghost order, then by `share` descending, then by path in code-unit order, with files tended by the living last, by path. Each file shall carry `ghostId` (the haunting ghost's id, or `null`) and `hauntedBy` (that ghost's name, or `null`).

### R4 The API (decision C)

**R4.1** A successful `/api/summon` response shall carry either `map` (a `HauntingMap`, design.md §3) or `mapNote` (one of the sentences in R1.6 and R1.7), or neither when `buildLedger` returned no map outcome. It shall never carry both.

**R4.2** `map` shall pass `HauntingMapSchema` before it is sent. The fields `items`, `lines`, `persona`, `shallow`, `truncated`, `ledgerSize`, `buildDurationMs` and `sessionId` shall keep their current meaning and shape.

**R4.3** The response shall carry `range: { startLine, endLine }`, the line range the ledger was built for.

**R4.4** The map shall not be stored in the session. The ledger stored in the session, and therefore every prompt and every verification, shall be the same as without this spec.

### R5 The page (decision D)

**R5.1** After a summon whose response carries `map`, the page shall show the section "The haunting map" (`#map`), placed inside `#seance` after the séance columns and before the exorcism. When the response carries `mapNote`, the section shall show its heading and the note only. Otherwise the section shall stay hidden. A new summon shall replace the previous map completely.

**R5.2** The section shall show the copy in design.md §7.3: what the map was read from and what "ghost" means (`#map-meta`), its limits (`#map-limit`), and, when they apply, the history cut, the file cut and the shallow clone (`#map-cut`).

**R5.3** A legend (`#map-legend`) shall list each ghost in order: their glyph, their name, "Last seen <date>" and "Haunts N file(s)".

**R5.4** Each ghost's glyph shall be text made from their initials, as defined in design.md §5.5, and unique within the map. Colour shall never be the only way to tell ghosts apart.

**R5.5** Files shall be shown as tiles grouped by ghost, in ghost order, each group headed "Haunted by <name>". The files tended by the living shall come last, inside a `<details>` element that is closed by default, with the summary "Tended by the living (N file(s))".

**R5.6** Each tile shall show the path in monospace, wrapping at any character; "Haunted by <name>" with the glyph, or "Tended by the living"; "N of M commits by ghosts"; "Last seen <date>" for a haunted file or "Last changed <date>" for a tended one; "Commit <sha7>"; and a button "Summon here".

**R5.7** The tile of the file the séance is open on shall carry the text "You are here".

**R5.8** A tile's fog intensity may follow `share`, as a second signal next to the text only. The only motion shall be an opacity transition, removed under `prefers-reduced-motion: reduce`.

**R5.9** At a viewport width of 320 CSS pixels, the section shall not scroll horizontally, whatever the length of the paths and names.

**R5.10** The section shall be fully operable by keyboard. Tiles shall not be focusable. Each "Summon here" button and the `<summary>` shall be focusable, with the existing visible focus style, and each button's accessible name shall start with its visible label and name the path.

**R5.11** Dates shall use the page's existing UTC date format. Counts shall use the singular for one ("1 commit", "1 file").

### R6 Summon here (decision E)

**R6.1** "Summon here" shall send `POST /api/summon` with the repository of the open séance, the tile's path, `wholeFile: true`, the GitHub token field's value if it is not empty, and no line numbers.

**R6.2** The server shall accept a summon request with either both `startLine` and `endLine`, or `wholeFile: true` and neither, and shall refuse any other combination with 400 `VALIDATION_ERROR` and the message "Send a line range or wholeFile, not both." or "Send a line range (startLine and endLine) or wholeFile: true.".

**R6.3** A whole-file request shall pass the same file, repository and token checks as a range request (`validateLedgerInput` rules), before any git call.

**R6.4** For a whole-file request, the server shall read the file at `HEAD` with one git call, count its lines by the rule of `sliceSourceLines` (a final newline does not add a line), and build the ledger for lines 1 to min(count, 500).

**R6.5** When the path is not a file at `HEAD` (missing, a directory, a submodule, or a file over 5 MB), the response shall be 400 `VALIDATION_ERROR` with "Séance could not read that file in the latest commit. Check the path.". When the file has no line, the response shall be 400 `VALIDATION_ERROR` with "That file is empty in the latest commit, so there is no line to ask about.". Neither message shall contain the path.

**R6.6** A whole-file summon shall be limited by the summon limiter and take a clone slot exactly like any summon, and shall return a map like any summon.

**R6.7** After a successful "Summon here", the page shall open the séance on the returned range as a normal summon does: the line view, the crypt, the ghost's name, the guide, the counter and the map shall all show the new file. The file and line fields of the summon form shall be set to the path and the returned range.

**R6.8** While a summon is running, a second "Summon here" or summon shall not start. A failed "Summon here" shall show the server's message in `#map-err` and leave the open séance as it was.

### R7 The samples (decision F)

**R7.1** `scripts/make-crypt.sh` and `scripts/make-possessed.sh` shall not change.

**R7.2** The map of the crypt and of the possessed sample, read with real git from a fresh build by the scripts, shall deep-equal the expected maps in design.md §9.

**R7.3** The fixture prompt hashes printed by `npx tsx scripts/record-plan-fixture.ts --hash-only` (`464f2680`) and `--ghost --hash-only` (`b0b2564e`), and the recording keys printed by `npx tsx scripts/record-answers.ts --keys-only`, shall be unchanged.

### R8 Hostile repositories (decision G)

**R8.1** Author names and paths shall be inserted into the page with `textContent` only. The map shall never be passed to `buildPrompt`, `buildPlanPrompt` or any model call.

**R8.2** A ghost shall carry `suspicious: isSuspicious(name)`. For a suspicious ghost, the page shall show "A ghost whose name tries to give orders" (class `lab warn`) where the name would go, in the legend, in the group heading and on each tile, followed by the glyph in parentheses in the heading. The name shall not be printed anywhere in the section.

**R8.3** The reader shall handle any byte in a path or name that git can store, including spaces, quotes, newlines and non-ASCII characters, without quoting artefacts. A path that `validateLedgerInput` refuses (for example one containing `..`) shall still be shown, and its "Summon here" shall return the normal 400.

### R9 Tests (decision H)

**R9.1** Unit and property tests shall cover `computeHauntingMap` as listed in design.md §10.

**R9.2** Real git tests shall build both samples into a temp dir and assert R7.2. Further real git tests shall cover a merge commit (skipped), a rename (not followed), a departed author with a suspicious name, paths with spaces, quotes, a newline and non-ASCII characters, the commit cap and the timeout.

**R9.3** Server tests shall cover: the map present on a crypt summon; a failing or throwing reader leaving the summon at 200 with `mapNote` and no `map`; `wholeFile` on the crypt; the missing-file and empty-file messages; both forms at once; a 700-line file giving lines 1 to 500; the summon limiter counting whole-file summons; and an unchanged session ledger.

**R9.4** A jsdom end-to-end test in `test/e2e/` shall run: summon the crypt, see the map, press "Summon here" on `legacy/vendor.js`, see the crypt and the line view change, and ask the new ghost a question.

**R9.5** No test shall touch the network or set `ANTHROPIC_FIXTURE`.

## Non-functional requirements

**N1** No new dependency.

**N2** `src/ghost/verifier.ts`, `src/ratelimit.ts`, `src/ghost/persona.ts`, `src/ghost/llm.ts`, `src/ghost/recordings.ts`, `scripts/make-crypt.sh`, `scripts/make-possessed.sh`, `recordings/` and `test/fixtures/` shall not change.

**N3** TypeScript strict mode with no `any`. Zod validates the new request form, the git records and the map.

**N4** UI changes follow `.kiro/steering/ui-spooky.md`: tokens only, every new text and background pair in the contrast table of `public/tokens.css` and passing `npm run contrast`, no colour-only signal, no emoji as icons, labels in sentence case, no `transition: all`, no inline style in HTML (setting `element.style` from JS is allowed, as the signal bars do), and CSP `default-src 'self'` unchanged.

**N5** `computeHauntingMap` runs in time linear in the total number of (commit, path) pairs plus the sorting of files and ghosts.

**N6** Every task ends with `npm test`, `npm run typecheck`, `npm run lint` and `npm run contrast` green.

**N7** Another session is editing `public/` for accessibility fixes. The UI changes shall be made against the page's structure (`#seance`, `.seance-col`, `#exorcism-wrap`, `openSeance`), not against line numbers, and shall not undo that session's changes.

## Out of scope

- Line-level ownership (blame per line).
- Following renames.
- Time-travel views (the map at an earlier commit).
- Per-directory roll-ups.
- Any model use, and any use of the map in a prompt.
- Applying `.mailmap`, or merging one person's several emails.
- Special treatment of binary, vendored or generated files.
- Showing departed authors who haunt no listed file.

## Addendum: inquisitor review (2026-11-11)

Input: MEDIUM 5 of `docs/kiro-evidence/inquisitor-review-session.txt`. `parseNameLog` split the whole `git log` output on the record separator, and a path may legally contain that character, so a file name could start a second record and forge a commit, with an author and a sha of the attacker's choice, that touched a real file.

Decision: keep exactly two git calls (R1.2) and make the parse unambiguous. The obvious repair, "a header may begin only right after a NUL and must start with RS, a 40-hex sha and US", still leaves an ambiguity: with `-z` every path also begins right after a NUL, so a path that starts with RS, a sha and US is byte for byte a header. What a path can never be is empty: git ends each path with NUL, a path cannot contain NUL, and an empty path does not exist. So the format starts with `%x00`, every header follows an empty NUL-delimited token, and no sequence of paths can make one. No third git call is needed, and R1.2 is unchanged.

### R10 Inquisitor review (2026-11-11)

**R10.1** The map's `git log` call shall use `--format=%x00%x1e%H%x1f%an%x1f%ae%x1f%aI`. Its other arguments, and R1.2–R1.4, shall not change.

**R10.2** `parseNameLog` shall split the output on NUL into tokens and read a commit header only from the token directly after an empty token. A header shall begin with RS, a full sha of 40 or 64 lower-case hex characters and US; its four fields shall pass the record schema (R1.9). The tokens up to the next empty token shall be that commit's paths, with one leading newline removed from the first. A header that fails either check shall be skipped and counted, with its paths. A path containing RS, US, newlines or a whole fake header shall be read as a path, and shall never produce or remove a commit.

**R10.3** Tests shall show R10.2 with a real git repository holding a file named `a` RS, a 40-hex fake sha, US, a name, US, an email, US, a date (created with `git hash-object` and `git update-index --cacheinfo`), and with a property test over paths of arbitrary characters other than NUL, including fake headers, serialised as git emits them.

## Polish addendum (2026-11-11, re-audits)

Input: `docs/kiro-evidence/reaudit-layout-session.txt` (C6, C11, C12, S7) and `docs/kiro-evidence/reaudit-first-run-session.txt` (the map's "by ghosts", its limits sentence, the "Summon here" on the file already open, the token field). The page-wide requirements are first-seance R15; these are the map's share. The reader, the pure function and the API do not change.

Decisions: on this page "the ghost" is the persona that speaks, so the map counts commits "by departed authors"; the limits are kept but folded away; a tile does not offer to summon the file that is already open.

### R11 Polish (2026-11-11, re-audits)

**R11.1** The UI shall show `departedTouches` and `totalTouches` as "N of M commits by departed authors", with "commit" when M is 1. This amends R2.6 and R5.6. "Ghost" keeps its meaning in `#map-meta` and the legend.

**R11.2** The limits sentence of R5.2 shall sit in `<details class="map-limits" id="map-limit">`, closed, with the summary "What this map leaves out" and the sentence in a `<p class="meta">`. This amends R5.2.

**R11.3** The tile whose path is the open séance's file ("You are here") shall have no "Summon here" button. Every other tile keeps one. This amends R5.6 and R5.10.

**R11.4** "Summon here" shall not send `githubToken`; the page has no token field (first-seance R15.21). This amends R6.1.

**R11.5** `#map-status` and `#map-err` shall follow `#map-meta`, so a failed "Summon here" is reported near the top of the section, whichever tile was pressed (first-seance R15.6). R6.8 is otherwise unchanged.

**R11.6** The section shall have `margin-top: var(--space-2xl)`. `#map-note` shall be shown in a neutral style (rule border, paper-2 background), and an empty `#map-status` shall take no space (first-seance R15.12).

**R11.7** A ghost's name next to fixed copy shall be its own `<bdi>`: in "Haunted by <name>" (group headings and tiles) and the legend's `.map-name` (first-seance R15.17). Suspicious names are still never printed (R8.2).

## Addendum: inquisitor second pass (2026-11-11)

Input: the LOW finding of `docs/kiro-evidence/inquisitor-second-pass-session.txt`. Since R10 a path can no longer forge a commit, but author and email are still separated by US. A US inside either gives the header five fields, `parseNameLog` counts the record in `skipped`, and the reader drew the map from the other commits. A file such a commit touched could then be attributed to another author or shown as "Tended by the living".

Decision: until the identity fields have an unambiguous encoding, a map with a missing commit is not drawn. The fixed note says the map could not be drawn, and the séance is not affected (R1.6).

### R12 Inquisitor second pass (2026-11-11)

**R12.1** When `parseNameLog` reports `skipped > 0`, `readHauntingMap` shall return the R1.6 note ("The haunting map could not be drawn: git could not read the history in time. The séance is not affected.") and no map, and shall log the count to the server log only. This amends R1.9. A test shall show it with a real commit whose author name contains U+001F.
