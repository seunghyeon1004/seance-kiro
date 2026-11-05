# Evidence Ledger — Implementation Tasks

Tasks are ordered so that each one builds on the previous. Complete them top to bottom.
Each task references the requirement numbers it satisfies.
Commit messages must use the format `evidence-ledger T<N>: <description>`.

---

## T1 — Project scaffold and shared types

- [x] Initialise `package.json` with Node 20 engine field, `"type": "module"`, and dependencies:
      `hono`, `zod`, `execa`, `typescript`, `vitest`, `@fast-check/vitest`, `fast-check`,
      `@anthropic-ai/sdk`, `eslint`, `prettier`.
- [x] Add `tsconfig.json` with `strict: true`, `noImplicitAny: true`, `target: "ES2022"`,
      `module: "NodeNext"`.
- [x] Add `npm` scripts: `build`, `dev`, `test`, `lint`, `typecheck`.
- [x] Create `src/ghost/schema.ts` with `EvidenceItemSchema`, `EvidenceItem`, `LedgerResultSchema`,
      `LedgerResult`; export from `src/evidence/ledger.ts` as re-exports.
- [x] Create the `SeanceError` base class and the four derived error classes
      (`ValidationError`, `GitError`, `CloneError`, `SsrfError`) in `src/errors.ts`.

Satisfies: R12.2, R12.3 (type foundations); prerequisite for all other tasks.

---

## T2 — Input validation (`src/evidence/ledger.ts` — validation layer only)

- [x] Define `LedgerInputSchema` (Zod): `repoUrl` (string), `file` (string), `startLine` (≥1),
      `endLine` (≥ startLine, ≤ startLine + 499), optional `githubToken`.
- [x] Add path-traversal guard: reject if `file` contains `..` or is absolute.
- [x] Export `validateLedgerInput(raw: unknown): LedgerInput`; throw `ValidationError` on failure.
- [x] Add URL allowlist check for GitHub URLs (regex `^https://github\.com/[\w.-]+/[\w.-]+(\.git)?$`);
      throw `ValidationError` for any other value in `repoUrl`.
- [x] Write unit tests in `test/evidence/ledger.test.ts` covering: valid input passes; bad line
      range rejects; path traversal rejects; non-GitHub URL rejects; missing fields reject.

Satisfies: R9.1, R9.2, R9.3, R8.1.

---

## T3 — git subprocess wrapper (`src/evidence/git.ts`)

- [x] Resolve the `git` binary path at module load time; throw at import if absent.
- [x] Implement a `runGit(args: string[], cwd: string, timeoutMs?: number): Promise<string>` helper
      using `execa` with `stdio: ['pipe','pipe','pipe']` and a configurable timeout
      (default `GIT_CALL_TIMEOUT_MS` env var, fallback 10 000 ms); throw `GitError` on
      non-zero exit or timeout.
- [x] Implement `blame(repo, file, start, end)`: calls `git blame --porcelain -L start,end file`
      and returns `RawBlameEntry[]`.
- [x] Implement `logL(repo, file, start, end)`: calls
      `git log -L start,end:file --follow --format=fuller` and returns `RawCommit[]`.
- [x] Implement `showHunk(repo, sha, file, start, end)`: calls `git show` and returns the raw
      unified-diff hunk string; returns `""` on failure (logs error).
- [x] Implement `changedFiles(repo, sha)`: calls `git show --name-only --format=` and returns
      `string[]`.
- [x] Write unit tests in `test/evidence/git.test.ts` using spies on `runGit`: verify argument
      arrays are correct; verify timeout is enforced; verify `GitError` is thrown on non-zero exit.

Satisfies: R1.1, R1.2, R1.3, R2.1, R2.2, R2.3, R4.2, R4.3, R9.4, R12.1.

---

## T4 — Reference parsing and line-range mapping (`src/evidence/refs.ts`)

- [x] Implement `parseRefs(text: string): string[]` with the five regex patterns
      (`#\d+`, `Fixes #\d+`, `Closes #\d+`, `Resolves #\d+`, `Fix #\d+`, case-insensitive prefix);
      deduplicate by reference number; order by first appearance.
- [x] Implement `isSuspicious(text: string): boolean` checking for known prompt-injection
      substrings (`ignore previous instructions`, `system:`, `<|`); patterns MUST be simple
      fixed-string or bounded-regex checks to avoid ReDoS.
- [x] Implement `mapLineRange(renames: RenameEvent[], original: LineRange): LineRange` as described
      in the design (walk commits newest-to-oldest, apply hunk offset, clamp, enforce order).
- [x] Write unit tests in `test/evidence/refs.test.ts`: all five ref patterns; deduplication;
      ordering; suspicious detection on known strings and benign messages.
- [x] Write PBT in `test/evidence/pbt/refs.pbt.ts`: - **P1** `mapLineRange` result always has `start >= 1` and `end >= start`. - **P2** `mapLineRange` is deterministic (same inputs → same output). - **P3** `parseRefs` result length ≤ unique ref count in input. - **P4** `parseRefs` completes in < 100 ms on 10 000-char input. - **P5** `isSuspicious` returns `true` for all known injection strings.

Satisfies: R3.1, R3.2, R3.3, R5.1, R5.2, R5.3, R11.3, and PBT properties P1–P5.

---

## T5 — GitHub enrichment (`src/evidence/github.ts`)

- [x] Implement `parseGitHubRemote(url: string): { owner: string; repo: string } | null` that
      extracts owner/repo from a `https://github.com/…` URL.
- [x] Implement `fetchGitHubRef(owner, repo, ref, token?)` using the native `fetch` API: - Build the API URL (`https://api.github.com/repos/<owner>/<repo>/issues/<n>` or `/pulls/<n>`);
      validate host is exactly `api.github.com` before calling — throw `SsrfError` if not. - Parse response with a Zod schema; return `{ title, body }` or `undefined` on any failure. - Check `X-RateLimit-Remaining`; skip call and return `undefined` when it is `"0"`.
- [x] All errors are caught internally and return `undefined`; never rethrow.
- [x] Write unit tests in `test/evidence/github.test.ts` using `vi.stubGlobal('fetch', …)`:
      success path; network error → undefined; rate-limit header → undefined; Zod parse fail →
      undefined; SSRF-redirected URL → `SsrfError` caught → undefined.

Satisfies: R6.1, R6.2, R6.3, R6.4.

---

## T6 — Remote clone lifecycle (`src/evidence/git.ts` — clone section)

- [x] Implement `cloneRepo(url: string): Promise<ResolvedRepo>` where
      `ResolvedRepo = { root: string; cleanup: () => Promise<void> }`.
- [x] Use a random UUID subdirectory under `os.tmpdir()`.
- [x] Apply `AbortController` with 30 s timeout; on abort: SIGKILL, then `cleanup()`.
- [x] Poll directory size with `du` every 2 s after clone starts; SIGKILL + cleanup + throw
      `CloneError` if working tree exceeds 200 MB.
- [x] Serialise concurrent clones for the same canonical URL using a `Map<string, Promise>` module-
      level cache; release the entry when the clone resolves or rejects.
- [x] Write unit tests: URL validation rejects non-GitHub; AbortController fires on simulated
      timeout; size-cap polling triggers `CloneError`.

Satisfies: R8.2, R8.3, R8.4.

---

## T7 — Ledger assembly (`src/evidence/ledger.ts` — full pipeline)

- [x] Implement `buildLedger(input: LedgerInput): Promise<LedgerResult>` orchestrating the full
      pipeline in the order shown in the design diagram.
- [x] Deduplicate commits by full SHA before assembling items (R4.1).
- [x] Assign sequential IDs `"E1"` … `"En"` ordered oldest-to-newest by author date (R7.1).
- [x] Apply size caps: - Cap item count at 50; set `truncated: true` when trimming (R10.1). - Cap combined hunk size at 512 KB; replace excess hunks with `""` (R10.2). - Truncate `body` to 4 096 chars and `subject` to 512 chars (R10.3).
- [x] Freeze ledger: `Object.freeze(items)` and `items.forEach(Object.freeze)` (R7.2).
- [x] Ensure `cleanup()` is called in a `finally` block for remote repos (R8.2).
- [x] Record `buildDurationMs` using `performance.now()`.
- [x] Write unit tests in `test/evidence/ledger.test.ts`: - Happy path with fixture git output → valid `LedgerResult`. - > 50 commits → `truncated === true`, `items.length === 50`. - Total hunk > 512 KB → excess items have `hunk === ""`. - `Object.freeze` prevents mutation (strict-mode throws). - `buildLedger` called twice with same input → two independent frozen arrays.

Satisfies: R4.1, R4.2, R7.1, R7.2, R7.3, R10.1, R10.2, R10.3, R11.1.

---

## T8 — Untrusted-text guards (`src/evidence/refs.ts` + `src/evidence/ledger.ts`)

- [x] Apply `isSuspicious` to `subject + " " + body` for every commit during assembly; set
      `suspiciousMessage: true` on the `EvidenceItem` when it returns `true`.
- [x] Add a unit test asserting that an item with a known injection string in `subject` gets
      `suspiciousMessage: true` in the assembled ledger.
- [x] Add a unit test asserting that the `items` array and each item are frozen (cannot be mutated
      without throwing).

Satisfies: R11.1, R11.2, R11.3.

---

## T9 — Property-based tests for the ledger (`test/evidence/pbt/ledger.pbt.ts`)

- [x] **P6** Generate synthetic `RawCommit` arrays of length > 50; assert assembled ledger has
      `items.length <= 50` and `truncated === true`.
- [x] **P7** Generate `EvidenceItem` via `fc.record(…)`; assert `item.sha.startsWith(item.shortSha)`.
- [x] **P8** Generate `EvidenceItem`; assert `!isNaN(Date.parse(item.date))`.
- [x] Configure fast-check: 1 000 runs per property; fixed seed via `FAST_CHECK_SEED` env var or
      Vitest global setup.

Satisfies: evidence-rules PBT properties P6–P8; R12.3 (determinism).

---

## T10 — Integration smoke test and crypt sample

- [x] Create `test/fixtures/crypt/` as a minimal git repository (init + 3 commits with known
      messages, one containing `Fixes #7`) for use in unit tests.
- [x] Write `test/evidence/ledger.integration.ts` (skipped unless `INTEGRATION=1`): call
      `buildLedger` against `test/fixtures/crypt/`; assert at least one `EvidenceItem` with all
      required fields.
- [x] Confirm `npm test` passes without `INTEGRATION=1` (no network, no real git on CI fixture
      path).

Satisfies: R1.1–R2.4 (end-to-end path through all extraction stages), R12.1 (timing assertion in
integration test).

---

## T11 — Lint, typecheck, and CI readiness

- [x] Add ESLint config (flat config `eslint.config.js`) with `@typescript-eslint/recommended`
      and `no-explicit-any` as an error.
- [x] Add Prettier config (`.prettierrc`) matching project style (2-space indent, single quotes,
      trailing commas).
- [x] Confirm `npm run typecheck` exits 0 (no `tsc --noEmit` errors).
- [x] Confirm `npm run lint` exits 0.
- [x] Confirm `npm test` exits 0 (all Vitest unit + PBT tests pass).
- [x] Add a `.env.example` listing `GITHUB_TOKEN`, `GIT_CALL_TIMEOUT_MS`, `CLONE_TIMEOUT_MS`,
      `CLONE_MAX_MB`, `INTEGRATION`.

Satisfies: R12.2, R9.4, and overall code-quality requirements from tech steering.
