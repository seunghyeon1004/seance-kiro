# Séance MCP — Tasks

Commit messages: `seance-mcp T<N>: <description>`.

Each task starts by writing the tests that fail without it. Each task ends with `npm test`, `npm run typecheck` and `npm run lint` green (N8). The baseline for "unchanged" checks is commit `5623ab9`, HEAD before this spec's first code. (It was `afac0a1`, but `5623ab9`, committed after the spec, changed `src/ghost/verifier.ts`, `src/ghost/report.ts`, `src/evidence/git.ts`, `src/evidence/haunting.ts`, `src/evidence/ledger.ts`, `src/server.ts`, `public/app.js` and `public/styles.css` for the inquisitor fixes, so a diff against `afac0a1` is not empty for reasons unrelated to this spec. `package.json` and `package-lock.json` are identical at `afac0a1` and `5623ab9`, so N1 is the same check either way.) At the end of every task, `git diff 5623ab9 -- src/ghost/verifier.ts src/ghost/schema.ts src/ghost/report.ts src/evidence/ src/server.ts src/ratelimit.ts public/ scripts/ recordings/ test/fixtures/` is empty (N2), and so is `git diff 5623ab9 -- package-lock.json` (N1).

---

## T1 — Store, repository resolution, console

- [x] Write the failing tests in `test/mcp/store.test.ts` (design.md §9.1):
  - 51 puts leave 50 entries, and the first id returns `undefined` (R4.2);
  - reading the first-stored entry, then putting one more, still evicts that entry (R4.2);
  - a stored entry and its `items` are frozen (R4.3);
  - a fake `newId` that repeats an id makes `put` throw (R4.1).
- [x] Write the failing tests in `test/mcp/repo.test.ts` (design.md §9.1), on `mkdtemp` dirs and on a crypt built with `buildSamples()` from `test/e2e/harness.ts`:
  - the `looksRemote` table (R3.1);
  - a remote string is refused with `REPO_REMOTE` and the injected `realpath` is never called (R3.1);
  - a missing path and a regular file give `REPO_NOT_DIRECTORY`; a non-repository dir, a `git init --bare` dir and a `.git` directory give `REPO_NOT_GIT` (R3.2, R3.3);
  - none of these messages contains the argument, the temp dir or `os.tmpdir()` (R3.5);
  - `legacy` inside the crypt resolves to the crypt's top level, `"."` with `cwd` set to the crypt resolves to it, and a symlink to the crypt resolves to the crypt's real path (R3.2, R3.4).
- [x] Write the failing tests in `test/mcp/console.test.ts` (design.md §9.1) (R1.6).
- [x] Write `src/mcp/store.ts`: `MAX_LEDGERS`, `StoredLedger`, `LedgerStore` (design.md §4.2) (R4.1–R4.3).
- [x] Write `src/mcp/messages.ts` with `MESSAGES` (design.md §3.4), then `src/mcp/repo.ts`: `RepoRefusal`, `RepoDeps`, `looksRemote`, `resolveLocalRepo`, with the steps of design.md §4.1 and the three repository sentences (R3.1–R3.5).
- [x] Write `src/mcp/console.ts`: `installStderrConsole()` (design.md §4.4) (R1.6).
- [x] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R1.6 (console), R3.1–R3.5, R4.1–R4.3, N3.

---

## T2 — The tool handlers

- [x] Write the failing tests in `test/mcp/tools.test.ts` (design.md §9.1), on samples built with `buildSamples()` into a temp dir and removed afterwards:
  - `summonTool` on `legacy/tax.js` 7–7 returns `items` with sha7 `e9a5c9c` then `6a959a9`, deep-equal to `buildLedger`'s items mapped by `toSummonItem`, and `truncated: false` (R2.1–R2.4);
  - the result has no `email`, `sha`, `files`, `refs`, `lines` or path, at any depth (R2.5);
  - with `repo` omitted and `cwd` set to the crypt, the same items come back (R2.1);
  - an injected `buildLedger` that returns no items gives a success with `items: []` (R2.6);
  - `endLine < startLine`, a 501-line range, `../x` and `/etc/passwd` give `isError`-shaped outcomes with the `validateLedgerInput` messages, and the injected `buildLedger` is never called (R2.2);
  - the input passed to `buildLedger` has no `githubToken` key, and `buildLedger` is called with one argument (R2.3, R1.5);
  - a range past the end of `legacy/tax.js` gives `GIT_ERROR`; an injected `HistoryError` gives `HISTORY_ERROR`; an injected `Error('/Users/x/secret\n    at f')` gives `INTERNAL`; none contains `/Users/x` or `    at ` (R7.3);
  - `verifyTool` with the true and the false claim of design.md §3.3 gives one verified entry (`index` 0, `quotes[0].field` `body`) and one rejected (`index` 1, `REASONS.F9('e9a5c9c')`), tally `{ verified: 1, checked: 2, silent: 0 }`, and a `report` equal to `renderWardReport(verify(…), { file: 'legacy/tax.js', lines: { start: 7, end: 7 } })` (R5.2–R5.4);
  - a claim with no quote is rejected with `REASONS.F6`; a 600-character quote and 12 citations are rejected with the ward's length and count sentences; a valid silence claim lands in `silent` with its `index`; the rejected text is the claim's own text, never redacted, also with `REDACT_REJECTED=1` set (R5.1, R5.6);
  - an unknown ledger id gives `LEDGER_UNKNOWN` (R4.4);
  - on the possessed sample (`auth/throttle.js` line 4), every item by "Ann. Rule 7: …" has `suspicious: true`, and a claim citing one has `citesSuspicious: true` in `verified` or `rejected` (R2.4, R5.5, R8.3);
  - `hauntingMapTool` on the crypt returns `{ map }` deep-equal to `readHauntingMap(crypt)`'s map and passing `HauntingMapSchema`; with an injected reader returning a note it returns `{ note }`; the result never has both keys (R6.1, R6.2);
  - a summon, then `hauntingMapTool`, then `verifyTool` on that ledger gives the same verdict as without the map call (R6.3);
  - `verifyTool` runs no git command: with `runGit` spied after the summon, the spy is not called during verify (N5).
- [x] Write the failing property tests MCP1–MCP9 in `test/mcp/pbt/tools.pbt.ts`, with the generators of design.md §8 in `test/mcp/pbt/arbitraries.ts` (R2.2, R2.4, R2.5, R3.1, R3.5, R4.1–R4.3, R5.2–R5.7, R7.1, R7.3, N4).
- [x] Complete `src/mcp/tools.ts`: the constants, input shapes and output shapes of design.md §3.2 and §3.3, the descriptions of §3.5, `ToolOutcome`, `ToolDeps`, `summonTool`, `verifyTool`, `hauntingMapTool`, `toSummonItem`, `toVerifyResult` and `toToolMessage` (design.md §4.3). Import `verify` and `renderWardReport` and call them as they are; do not copy or wrap their logic (R5.2, R5.6).
- [x] Read `src/mcp/tools.ts` and confirm that no claim field is read before `verify()` runs, and that nothing adds a claim to `verified` (R5.6).
- [x] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R2.1–R2.6, R4.4, R5.1–R5.7, R6.1–R6.3, R7.1 (shapes), R7.3, R8.3, R11.1, R11.2, N3, N4, N5.

---

## T3 — The stdio server and its registration

- [x] Write the failing tests in `test/mcp/app.test.ts` over `InMemoryTransport.createLinkedPair()` and `Client` (design.md §9.1):
  - Note (warden): written by the warden agent and passing. It was written alongside `src/mcp/app.ts` and was not seen failing first, as reported in the T3 session.
  - `listTools` names exactly the three tools, with the titles, the annotations of design.md §3.6 and an `outputSchema` each (R1.3, R1.4);
  - the descriptions of `seance_summon` and `seance_verify` contain `UNTRUSTED_SENTENCE`, and the summon description says what `suspicious: true` means (R8.1, R8.2);
  - the published input schemas have the `required` lists, the `kind` enum and `maxItems: 50` of design.md §3.2 (R5.1);
  - a successful call has one text item whose JSON equals `structuredContent` (R7.1); a refused call has `isError: true`, one text item and no `structuredContent` (R7.2);
  - `startLine: "7"` gives `isError` with text starting `MCP error -32602: Input validation error` and no `"\n    at "` (R7.4);
  - a `seance_verify` payload over `MAX_TOOL_INPUT_ELEMENTS` is refused before the handler runs (spy) (R1.8);
  - `getServerCapabilities()` has `tools` and neither `resources` nor `prompts` (R1.3);
  - `SERVER_VERSION` equals `package.json` `version`.
- [x] Write the failing test `test/mcp/imports.test.ts` (design.md §9.1) (R1.5).
  - Note (warden): written and passing, but not seen failing first, as reported in the T3 session.
- [x] Write the failing integration test `test/mcp/stdio.test.ts` with the nine steps of design.md §9.2 (R1.1, R1.2, R1.7, R3.1, R3.3, R4.4, R5.3, R9.2, R11.3, R11.4, R11.6).
  - Note (warden): written by the warden agent; it passes since the human added the `seance` entry to `.kiro/settings/mcp.json`.
- [x] Write the failing test `test/mcp/stdout.test.ts` (design.md §9.3) (R1.6, R1.7, R11.5).
  - Note (warden): written by the warden agent; passes against the registered command.
- [x] Write `src/mcp/app.ts`: `SERVER_NAME`, `SERVER_VERSION`, `toCallToolResult`, `createSeanceMcpServer`, `startStdioServer`, with the imports of design.md §3.1 exactly (R1.1, R1.3, R1.4, R1.7, R1.8, R7.1, R7.2).
- [x] Write `src/mcp/server.ts` as in design.md §4.6: `installStderrConsole()` first, then the dynamic import (R1.6).
- [x] Add `"mcp": "tsx src/mcp/server.ts"` to `package.json` `scripts`. Change nothing else in the file (R1.2, N1).
- [x] Add the `seance` entry of design.md §5 to `.kiro/settings/mcp.json`, leaving `filesystem` and `git` untouched (R9.1).
  - Note: the warden's edit of this file was denied by the kiro-scope rule. The human added the entry with `kiro-cli mcp add --name seance --scope workspace --command npx --args '["-y","tsx","src/mcp/server.ts"]'`. kiro-cli placed `seance` between `filesystem` and `git` and wrote the file without a trailing newline; the `filesystem` and `git` values are unchanged (checked by `test/mcp/config.test.ts`, T4).
- [x] Run `npm run --silent mcp < /dev/null > /tmp/seance-mcp.out` from the repository root and confirm that it exits 0 and that `/tmp/seance-mcp.out` is empty (R1.7, R9.2).
- [x] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.
  - Note (warden): after the human's mcp.json entry, `npm test` gave 83 files / 1320 tests passed (83 of them in `test/mcp/`), `typecheck` and `lint` exit 0.

Covers: R1.1–R1.8, R3.1 and R3.3 (over stdio), R7.1, R7.2, R7.4, R8.1, R8.2, R9.1, R9.2, R11.3–R11.6.

---

## T4 — The archaeologist

- [x] Write the failing test `test/mcp/config.test.ts` (design.md §9.1) for `.kiro/settings/mcp.json`, `.kiro/agents/archaeologist.json` and the `mcp` script (R9.1, R10.1–R10.4).
  - Note (warden): 9 tests. The human had already made the config and agent edits, so the test passed on its first run and was not seen failing. Its assertions were checked against the 5623ab9 versions of both files, which have no `seance` server, `tools` without `@seance`, an empty `allowedTools` and no `seance_summon` in the prompt, so each of those tests would fail there.
- [x] In `.kiro/agents/archaeologist.json`, set `prompt` to the text of design.md §6.1, add `@seance` to `tools`, set `allowedTools` to the three `@seance/…` entries, and update `description` to say that claims are checked by the ward. Keep `toolsSettings`, `resources`, `mcpServers`, `includeMcpJson`, `model`, `permissions` and `kiroUpgrade` as they are (R10.1–R10.4).
  - Note: edited by the human exactly as design.md §6.1 says. `test/mcp/config.test.ts` checks the result.
- [x] Run `kiro-cli agent validate --path .kiro/agents/archaeologist.json` (Kiro CLI 3.2.0): exit 0 (R10.5).
  - Note: run by the human; exit 0.
- [x] Run `kiro-cli mcp list workspace`: `seance` is listed under `archaeologist` (R10.5).
  - Note: run by the human; `seance` is listed under `archaeologist`.
- [x] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R10.1–R10.5.

---

## T5 — Documentation and a real run

- [x] Add the section "Use the ward from your own agent" of design.md §7 to `README.md`. Check each statement in it against the code: the three tool names, the returned fields, the example verdicts (rerun them through `seance_verify` on the crypt), the command lines and the limits (R12.1, R12.2).
  - Note (warden): added after the API section. The example was rerun through the registered command (`npx -y tsx src/mcp/server.ts`) over stdio with the SDK client on a crypt built by `scripts/make-crypt.sh` into a temp dir: items `e9a5c9c`, `6a959a9`; claim 0 verified with field `body`; claim 1 struck with "The quote cited from e9a5c9c is not in that commit's subject, message or diff."; report line `**1 of 2 claims verified**`; a remote `repo` gave `REPO_REMOTE`. `npm run mcp < /dev/null` was seen printing `> seance@0.1.0 mcp` on stdout, `npm run --silent mcp` printed 0 bytes. Differences from the text in design.md §7, kept in the README only: the silence claim may omit `citations` (R5.8), entries carry `index`, the struck claim's quote is shown, and one paragraph says what each Kiro engine did in the real runs. The stale `## Verified` heading in the design.md §3.3 example report is corrected to `## Citations verified`, the heading `src/ghost/report.ts` writes.
- [x] Update `.kiro/README.md`: the `seance` row in the MCP table and the archaeologist paragraph (design.md §7) (R12.3).
  - Done by hand on 2026-11-11 (the human rewrote `.kiro/README.md` in the same pass): the `seance` row is in the MCP table, the archaeologist section describes the ward workflow and the three runs, and the V3 denial is recorded under "What fires where". The row for `seance-mcp-session.txt` is in `docs/kiro-evidence/README.md`.
  - Open: the human is rewriting `.kiro/README.md`; the warden was told not to edit it. Tick after the human's edit.
- [x] In a logged-in Kiro CLI 3.2.0 session in this repository, run `kiro-cli chat --no-interactive --agent archaeologist "Why does legacy/tax.js line 7 wait 3 seconds? Use data/crypt as the repo."` with the crypt built by `npm run crypt`, once with the default engine and once with `--v3`. Save both transcripts in `docs/kiro-evidence/seance-mcp-session.txt` and add a row to `docs/kiro-evidence/README.md`. Record for each run whether `@seance/seance_summon` and `@seance/seance_verify` were called without a permission denial, and whether the answer shows only verified claims as fact (R10.1, R10.4; design.md §6.2).
  - If a run denies the seance tools, record the denial message in `.kiro/README.md` under "What fires where" and leave the agent file as it is; the fix is a follow-up spec change, not part of this task.
  - Note: run by the human; transcripts in `docs/kiro-evidence/seance-mcp-session.txt`. Run 1, default (V2) engine: `@seance/seance_summon` and `@seance/seance_verify` were auto-approved from `allowedTools`, and the answer stated five ward-verified claims as fact with sha7 and quote, one silence line marked not checked, and "5 of 5 claims verified". Run 2, `--v3 --trust-workspace` with no tool trust: every seance and git call was denied with "tool permission approval is not supported in non-interactive mode. Use --trust-all-tools to auto-approve."; the agent said so in its first line and marked every claim "not checked by the ward". Run 3, `--v3 --trust-all-tools` with a different prompt (haunted files and the 55-minute token cache): all three seance tools ran; `seance_verify` refused the silence claim with "Required at claims[4].citations", the defect fixed in T7. The row in `docs/kiro-evidence/README.md` and the V3 denial message in `.kiro/README.md` are the human's (both files are being rewritten by the human), so they are not checked here.
- [x] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.
  - Run by hand after the session: 85 test files, 1336 tests passed; typecheck, lint and contrast clean.
  - Open: green after T7 (see T6), but this item stays unticked with the `.kiro/README.md` and `docs/kiro-evidence/README.md` edits, which are the human's.

Covers: R10.1, R10.4 (at run time), R12.1–R12.3.

---

## T7 — Addendum: `citations` optional at the boundary

Added after T5's third real run. Numbered T7 so that the existing task ids stay as they are; it runs before T6.

- [x] Write the failing tests in `test/mcp/citations-default.test.ts` (design.md §9.1 addendum row): the boundary shape gives a claim with no `citations` key `citations: []` and still refuses a non-array; `verifyTool` puts such a silence claim in `silent` and strikes a bare memory and a bare speculation claim with "A memory claim needs at least one citation." and "A speculation claim needs at least one citation.", equal to `verify()` on the defaulted claims; over `InMemoryTransport` the same verdicts, and the published claim item requires only `kind` and `text` with `citations.default` `[]` (R5.8).
  - Note (warden): 6 tests; seen failing first, 5 of 6 (the non-array refusal passed already), with zod's "Required" / `expected: "array"` and, over the SDK, `isError` and `required` still listing `citations`.
- [x] Add step 8a of design.md §9.2 to `test/mcp/stdio.test.ts`: over stdio with the SDK client, `seance_verify` with exactly `{ kind: 'silence', text, silenceReason }` and no `citations` key lands in `silent` (R5.8).
  - Note (warden): seen failing first with `MCP error -32602: Input validation error: Invalid arguments for tool seance_verify: Required at claims[0].citations`, the error of the third T5 run.
- [x] In `src/mcp/tools.ts`, give `ClaimInputSchema.citations` `.default([])` (design.md §3.2 addendum). Change nothing in `src/ghost/verifier.ts` or `src/ghost/schema.ts`.
  - Note (warden): one line. `test/mcp/app.test.ts`'s published-schema assertion now expects `required` `['kind', 'text']` for a claim item, as design.md §3.2 now publishes.
- [x] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R5.8.

---

## T6 — Final verification

- [x] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.
  - Note (warden): `Test Files  85 passed (85)`, `Tests  1336 passed (1336)`; `tsc --noEmit` exit 0; `eslint . && prettier --check .` exit 0, "All matched files use Prettier code style!".
- [x] Check that `git diff 5623ab9 -- src/ghost/verifier.ts src/ghost/schema.ts src/ghost/report.ts src/evidence/ src/server.ts src/ratelimit.ts public/ scripts/ recordings/ test/fixtures/` is empty (N2).
  - Note (warden): baseline changed from `afac0a1` to `5623ab9`, HEAD at the start of the first seance-mcp code session (see the note at the top). Against `5623ab9` the diff is empty and `git status` shows no untracked file under those paths. Against `afac0a1` it lists 8 files, all from commit `5623ab9`.
- [x] Compare `dependencies` and `devDependencies` in `package.json`, and `package-lock.json`, with `5623ab9`; nothing changed (N1).
  - Note (warden): `package.json` differs only by the `mcp` script; `package-lock.json` diff is empty.
- [x] Search `test/mcp/` for `it.skip`, `describe.skip` and `.only`; none.
- [x] Confirm that `npm run lint` reports no `@typescript-eslint/no-explicit-any` in `src/mcp/` (N3).
- [x] Confirm that `src/mcp/` opens no port and writes no file: search it for `listen(`, `createServer`, `writeFile`, `appendFile` and `mkdtemp`; none (N7, R4.3).
- [x] Check that every requirement id R1.1–R1.8, R2.1–R2.6, R3.1–R3.5, R4.1–R4.4, R5.1–R5.8, R6.1–R6.3, R7.1–R7.4, R8.1–R8.3, R9.1–R9.2, R10.1–R10.5, R11.1–R11.6, R12.1–R12.3 and N1–N8 appears in at least one ticked task above, using the traceability table below.
  - Checked by hand with a script after R12.3 was closed: all 65 ids of requirements.md appear in the traceability table.
  - Open: every id is covered by a ticked item except R12.3 (`.kiro/README.md`, T5, waiting for the human's rewrite). N8 holds for every task, but T5's own "all green" item stays unticked with the human's documentation edits.

Covers: N1, N2, N3, N6 (by the cap arithmetic of design.md §3.3), N7, and the traceability check.

---

## T8 — Addendum: inquisitor second pass (2026-11-11)

Each item began with a test that failed for the stated reason before the code changed.

- [x] Write `test/mcp/lazy-fetch.test.ts` (R13.1, R13.2): a real partial clone of the crypt over `file://`, the server over stdio, `seance_summon` on `legacy/tax.js` line 7 expecting `GIT_ERROR` and an unchanged missing-object count, `seance_haunting_map` fetching nothing, a control clone where plain `git blame` does fetch, and the order of the assignments in `server.ts`. It failed with the count going from 4 to 2 and the assignments absent. Set the two variables in `src/mcp/server.ts`.
- [x] Write the failing title and description test in `test/mcp/app.test.ts` (R13.3, R13.4). Change the title in `app.ts` and `VERIFY_DESCRIPTION` in `tools.ts`; no field name changes.
- [x] Change the count line expected by `test/mcp/tools.test.ts` and `test/mcp/stdio.test.ts` (`ward-report` R2.1).
- [x] R13.5: end the §6.1 prompt with "N of M claims passed the ward". Not done by the agent: copying it into `.kiro/agents/archaeologist.json` and then changing the step list in `test/mcp/config.test.ts`; that test still checks the old line, which the agent file still has.
- [x] Run `npx vitest run test/mcp`: all green.

Covers: R13.1–R13.5.

---

## Traceability

| Requirement | Task |
| --- | --- |
| R1.1 | T3 |
| R1.2 | T3 |
| R1.3 | T3 |
| R1.4 | T3 |
| R1.5 | T2 (no token), T3 (imports) |
| R1.6 | T1 (console), T3 (entry, stdout) |
| R1.7 | T3 |
| R1.8 | T3 |
| R2.1 | T2 |
| R2.2 | T2 |
| R2.3 | T2 |
| R2.4 | T2 |
| R2.5 | T2 |
| R2.6 | T2 |
| R3.1 | T1, T3 (over stdio) |
| R3.2 | T1 |
| R3.3 | T1, T3 (over stdio) |
| R3.4 | T1 |
| R3.5 | T1, T2 (MCP6) |
| R4.1 | T1 |
| R4.2 | T1 |
| R4.3 | T1, T6 |
| R4.4 | T2, T3 (over stdio) |
| R5.1 | T2, T3 (published schema) |
| R5.2 | T2 |
| R5.3 | T2, T3 (over stdio) |
| R5.4 | T2 |
| R5.5 | T2 |
| R5.6 | T2 |
| R5.7 | T2 |
| R5.8 | T7 |
| R6.1 | T2 |
| R6.2 | T2 |
| R6.3 | T2 |
| R7.1 | T2 (shapes), T3 (results) |
| R7.2 | T3 |
| R7.3 | T2 |
| R7.4 | T3 |
| R8.1 | T3 |
| R8.2 | T3 |
| R8.3 | T2 |
| R9.1 | T3, T4 (config test) |
| R9.2 | T3 |
| R10.1 | T4, T5 (run) |
| R10.2 | T4 |
| R10.3 | T4 |
| R10.4 | T4, T5 (run) |
| R10.5 | T4 |
| R11.1 | T2 |
| R11.2 | T2 |
| R11.3 | T3 |
| R11.4 | T1, T2, T3 |
| R11.5 | T3 |
| R11.6 | T3 (and every test file) |
| R12.1 | T5 |
| R12.2 | T5 |
| R12.3 | T5 |
| R13.1 | T8 |
| R13.2 | T8 |
| R13.3 | T8 |
| R13.4 | T8 |
| R13.5 | T8 (spec text; the agent file is the human's) |
| N1 | T3, T6 |
| N2 | T6 (and every task's diff check) |
| N3 | T1, T2, T6 |
| N4 | T2 |
| N5 | T2 |
| N6 | T6 |
| N7 | T6 |
| N8 | every task |
