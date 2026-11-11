# Séance MCP — Tasks

Commit messages: `seance-mcp T<N>: <description>`.

Each task starts by writing the tests that fail without it. Each task ends with `npm test`, `npm run typecheck` and `npm run lint` green (N8). The baseline for "unchanged" checks is commit `afac0a1`. At the end of every task, `git diff afac0a1 -- src/ghost/verifier.ts src/ghost/schema.ts src/ghost/report.ts src/evidence/ src/server.ts src/ratelimit.ts public/ scripts/ recordings/ test/fixtures/` is empty (N2), and so is `git diff afac0a1 -- package-lock.json` (N1).

---

## T1 — Store, repository resolution, console

- [ ] Write the failing tests in `test/mcp/store.test.ts` (design.md §9.1):
  - 51 puts leave 50 entries, and the first id returns `undefined` (R4.2);
  - reading the first-stored entry, then putting one more, still evicts that entry (R4.2);
  - a stored entry and its `items` are frozen (R4.3);
  - a fake `newId` that repeats an id makes `put` throw (R4.1).
- [ ] Write the failing tests in `test/mcp/repo.test.ts` (design.md §9.1), on `mkdtemp` dirs and on a crypt built with `buildSamples()` from `test/e2e/harness.ts`:
  - the `looksRemote` table (R3.1);
  - a remote string is refused with `REPO_REMOTE` and the injected `realpath` is never called (R3.1);
  - a missing path and a regular file give `REPO_NOT_DIRECTORY`; a non-repository dir, a `git init --bare` dir and a `.git` directory give `REPO_NOT_GIT` (R3.2, R3.3);
  - none of these messages contains the argument, the temp dir or `os.tmpdir()` (R3.5);
  - `legacy` inside the crypt resolves to the crypt's top level, `"."` with `cwd` set to the crypt resolves to it, and a symlink to the crypt resolves to the crypt's real path (R3.2, R3.4).
- [ ] Write the failing tests in `test/mcp/console.test.ts` (design.md §9.1) (R1.6).
- [ ] Write `src/mcp/store.ts`: `MAX_LEDGERS`, `StoredLedger`, `LedgerStore` (design.md §4.2) (R4.1–R4.3).
- [ ] Write `src/mcp/messages.ts` with `MESSAGES` (design.md §3.4), then `src/mcp/repo.ts`: `RepoRefusal`, `RepoDeps`, `looksRemote`, `resolveLocalRepo`, with the steps of design.md §4.1 and the three repository sentences (R3.1–R3.5).
- [ ] Write `src/mcp/console.ts`: `installStderrConsole()` (design.md §4.4) (R1.6).
- [ ] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R1.6 (console), R3.1–R3.5, R4.1–R4.3, N3.

---

## T2 — The tool handlers

- [ ] Write the failing tests in `test/mcp/tools.test.ts` (design.md §9.1), on samples built with `buildSamples()` into a temp dir and removed afterwards:
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
- [ ] Write the failing property tests MCP1–MCP9 in `test/mcp/pbt/tools.pbt.ts`, with the generators of design.md §8 in `test/mcp/pbt/arbitraries.ts` (R2.2, R2.4, R2.5, R3.1, R3.5, R4.1–R4.3, R5.2–R5.7, R7.1, R7.3, N4).
- [ ] Complete `src/mcp/tools.ts`: the constants, input shapes and output shapes of design.md §3.2 and §3.3, the descriptions of §3.5, `ToolOutcome`, `ToolDeps`, `summonTool`, `verifyTool`, `hauntingMapTool`, `toSummonItem`, `toVerifyResult` and `toToolMessage` (design.md §4.3). Import `verify` and `renderWardReport` and call them as they are; do not copy or wrap their logic (R5.2, R5.6).
- [ ] Read `src/mcp/tools.ts` and confirm that no claim field is read before `verify()` runs, and that nothing adds a claim to `verified` (R5.6).
- [ ] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R2.1–R2.6, R4.4, R5.1–R5.7, R6.1–R6.3, R7.1 (shapes), R7.3, R8.3, R11.1, R11.2, N3, N4, N5.

---

## T3 — The stdio server and its registration

- [ ] Write the failing tests in `test/mcp/app.test.ts` over `InMemoryTransport.createLinkedPair()` and `Client` (design.md §9.1):
  - `listTools` names exactly the three tools, with the titles, the annotations of design.md §3.6 and an `outputSchema` each (R1.3, R1.4);
  - the descriptions of `seance_summon` and `seance_verify` contain `UNTRUSTED_SENTENCE`, and the summon description says what `suspicious: true` means (R8.1, R8.2);
  - the published input schemas have the `required` lists, the `kind` enum and `maxItems: 50` of design.md §3.2 (R5.1);
  - a successful call has one text item whose JSON equals `structuredContent` (R7.1); a refused call has `isError: true`, one text item and no `structuredContent` (R7.2);
  - `startLine: "7"` gives `isError` with text starting `MCP error -32602: Input validation error` and no `"\n    at "` (R7.4);
  - a `seance_verify` payload over `MAX_TOOL_INPUT_ELEMENTS` is refused before the handler runs (spy) (R1.8);
  - `getServerCapabilities()` has `tools` and neither `resources` nor `prompts` (R1.3);
  - `SERVER_VERSION` equals `package.json` `version`.
- [ ] Write the failing test `test/mcp/imports.test.ts` (design.md §9.1) (R1.5).
- [ ] Write the failing integration test `test/mcp/stdio.test.ts` with the nine steps of design.md §9.2 (R1.1, R1.2, R1.7, R3.1, R3.3, R4.4, R5.3, R9.2, R11.3, R11.4, R11.6).
- [ ] Write the failing test `test/mcp/stdout.test.ts` (design.md §9.3) (R1.6, R1.7, R11.5).
- [ ] Write `src/mcp/app.ts`: `SERVER_NAME`, `SERVER_VERSION`, `toCallToolResult`, `createSeanceMcpServer`, `startStdioServer`, with the imports of design.md §3.1 exactly (R1.1, R1.3, R1.4, R1.7, R1.8, R7.1, R7.2).
- [ ] Write `src/mcp/server.ts` as in design.md §4.6: `installStderrConsole()` first, then the dynamic import (R1.6).
- [ ] Add `"mcp": "tsx src/mcp/server.ts"` to `package.json` `scripts`. Change nothing else in the file (R1.2, N1).
- [ ] Add the `seance` entry of design.md §5 to `.kiro/settings/mcp.json`, leaving `filesystem` and `git` untouched (R9.1).
- [ ] Run `npm run --silent mcp < /dev/null > /tmp/seance-mcp.out` from the repository root and confirm that it exits 0 and that `/tmp/seance-mcp.out` is empty (R1.7, R9.2).
- [ ] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R1.1–R1.8, R3.1 and R3.3 (over stdio), R7.1, R7.2, R7.4, R8.1, R8.2, R9.1, R9.2, R11.3–R11.6.

---

## T4 — The archaeologist

- [ ] Write the failing test `test/mcp/config.test.ts` (design.md §9.1) for `.kiro/settings/mcp.json`, `.kiro/agents/archaeologist.json` and the `mcp` script (R9.1, R10.1–R10.4).
- [ ] In `.kiro/agents/archaeologist.json`, set `prompt` to the text of design.md §6.1, add `@seance` to `tools`, set `allowedTools` to the three `@seance/…` entries, and update `description` to say that claims are checked by the ward. Keep `toolsSettings`, `resources`, `mcpServers`, `includeMcpJson`, `model`, `permissions` and `kiroUpgrade` as they are (R10.1–R10.4).
- [ ] Run `kiro-cli agent validate --path .kiro/agents/archaeologist.json` (Kiro CLI 3.2.0): exit 0 (R10.5).
- [ ] Run `kiro-cli mcp list workspace`: `seance` is listed under `archaeologist` (R10.5).
- [ ] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R10.1–R10.5.

---

## T5 — Documentation and a real run

- [ ] Add the section "Use the ward from your own agent" of design.md §7 to `README.md`. Check each statement in it against the code: the three tool names, the returned fields, the example verdicts (rerun them through `seance_verify` on the crypt), the command lines and the limits (R12.1, R12.2).
- [ ] Update `.kiro/README.md`: the `seance` row in the MCP table and the archaeologist paragraph (design.md §7) (R12.3).
- [ ] In a logged-in Kiro CLI 3.2.0 session in this repository, run `kiro-cli chat --no-interactive --agent archaeologist "Why does legacy/tax.js line 7 wait 3 seconds? Use data/crypt as the repo."` with the crypt built by `npm run crypt`, once with the default engine and once with `--v3`. Save both transcripts in `docs/kiro-evidence/seance-mcp-session.txt` and add a row to `docs/kiro-evidence/README.md`. Record for each run whether `@seance/seance_summon` and `@seance/seance_verify` were called without a permission denial, and whether the answer shows only verified claims as fact (R10.1, R10.4; design.md §6.2).
  - If a run denies the seance tools, record the denial message in `.kiro/README.md` under "What fires where" and leave the agent file as it is; the fix is a follow-up spec change, not part of this task.
- [ ] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.

Covers: R10.1, R10.4 (at run time), R12.1–R12.3.

---

## T6 — Final verification

- [ ] Run `npm test`, `npm run typecheck` and `npm run lint`; all green.
- [ ] Check that `git diff afac0a1 -- src/ghost/verifier.ts src/ghost/schema.ts src/ghost/report.ts src/evidence/ src/server.ts src/ratelimit.ts public/ scripts/ recordings/ test/fixtures/` is empty (N2).
- [ ] Compare `dependencies` and `devDependencies` in `package.json`, and `package-lock.json`, with `afac0a1`; nothing changed (N1).
- [ ] Search `test/mcp/` for `it.skip`, `describe.skip` and `.only`; none.
- [ ] Confirm that `npm run lint` reports no `@typescript-eslint/no-explicit-any` in `src/mcp/` (N3).
- [ ] Confirm that `src/mcp/` opens no port and writes no file: search it for `listen(`, `createServer`, `writeFile`, `appendFile` and `mkdtemp`; none (N7, R4.3).
- [ ] Check that every requirement id R1.1–R1.8, R2.1–R2.6, R3.1–R3.5, R4.1–R4.4, R5.1–R5.7, R6.1–R6.3, R7.1–R7.4, R8.1–R8.3, R9.1–R9.2, R10.1–R10.5, R11.1–R11.6, R12.1–R12.3 and N1–N8 appears in at least one ticked task above, using the traceability table below.

Covers: N1, N2, N3, N6 (by the cap arithmetic of design.md §3.3), N7, and the traceability check.

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
| N1 | T3, T6 |
| N2 | T6 (and every task's diff check) |
| N3 | T1, T2, T6 |
| N4 | T2 |
| N5 | T2 |
| N6 | T6 |
| N7 | T6 |
| N8 | every task |
