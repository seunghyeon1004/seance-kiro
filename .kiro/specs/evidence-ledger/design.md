# Evidence Ledger — Design

## 1. Overview

The Evidence Ledger is a pure, deterministic pipeline: git subprocess calls → structured parsing
→ optional GitHub enrichment → immutable array of `EvidenceItem` values. No LLM, no async shared
state. Each call to `buildLedger` is fully independent.

```
caller
  │
  ▼
buildLedger(input)          ← ledger.ts — orchestrates the pipeline
  │
  ├─ validateInput()         ← Zod schema, path-traversal check, range check
  ├─ resolveRepo()           ← local path or clone (git.ts)
  ├─ runBlame()              ← git.ts  → RawBlameEntry[]
  ├─ runLogL()               ← git.ts  → RawCommit[]
  ├─ deduplicateCommits()    ← by full SHA
  ├─ mapLineRanges()         ← refs.ts → per-commit [start, end]
  ├─ fetchHunks()            ← git.ts  → hunk strings
  ├─ parseRefs()             ← refs.ts → string[]
  ├─ enrichGitHub()          ← github.ts (optional, non-blocking)
  ├─ flagSuspiciousMessages()← refs.ts
  ├─ assembleItems()         ← assign ids E1…En, apply size caps
  └─ freeze & return         ← immutable LedgerResult
```

---

## 2. Module responsibilities

### `src/evidence/git.ts`

Owns all git subprocess invocations. Every call uses `execa` (or Node's `child_process.spawn`)
with argument arrays — never shell string interpolation. Returns typed, parsed results or throws
a `GitError`.

Key exported functions:

```ts
// Validate and normalise a local path or clone a remote URL; return the
// resolved absolute working-tree root.
resolveRepo(input: RepoInput): Promise<ResolvedRepo>

// Run git blame --porcelain on [start, end] of file; return raw entries.
blame(repo: string, file: string, start: number, end: number): Promise<RawBlameEntry[]>

// Run git log -L start,end:file --follow with fuller format; return raw commits.
logL(repo: string, file: string, start: number, end: number): Promise<RawCommit[]>

// Run git show <sha>:<file> filtered to the relevant hunk; return hunk string.
showHunk(repo: string, sha: string, file: string, start: number, end: number): Promise<string>

// Return the list of files changed in a commit.
changedFiles(repo: string, sha: string): Promise<string[]>
```

Subprocess constraints:

- Timeout: 10 000 ms per individual git call (configurable via `GIT_CALL_TIMEOUT_MS`).
- `stdio: ['pipe', 'pipe', 'pipe']` — stdout and stderr captured, never inherited.
- The git binary path is resolved once at startup with `which git`; if absent the module throws
  at import time.

### `src/evidence/refs.ts`

Pure functions for reference parsing and line-range mapping. No I/O, no side effects — fully unit-
and property-testable.

Key exported functions:

```ts
// Parse #NNN / Fixes #NNN / Closes #NNN / Resolves #NNN / Fix #NNN from text.
parseRefs(text: string): string[]

// Given the rename log from --follow, map an original [start, end] to the
// coordinates in the commit where the hunk was authored.
mapLineRange(renames: RenameEvent[], original: LineRange): LineRange

// Return true if the text contains a prompt-injection pattern.
isSuspicious(text: string): boolean
```

`RenameEvent` is `{ fromFile: string; toFile: string; commitSha: string; offset: number }`.
The `offset` represents the line-number delta caused by insertions/deletions before the range in
that commit, derived from the diff stat embedded in `git log --follow` output.

### `src/evidence/github.ts`

Wraps the GitHub REST API. Non-blocking — any error results in `undefined`, never throws.

```ts
// Fetch PR or issue title+body for a single ref like "#123".
// Returns undefined on any failure.
fetchGitHubRef(
  owner: string,
  repo: string,
  ref: string,
  token?: string
): Promise<{ title: string; body: string } | undefined>
```

SSRF guard: before any fetch, validate that the resolved URL host is exactly `api.github.com`.
Response body is parsed with a Zod schema; unknown fields are stripped.

Rate-limit handling: if the `X-RateLimit-Remaining` header is 0, log a warning and return
`undefined` without making the call.

### `src/evidence/ledger.ts`

Orchestrator. Exports a single public function:

```ts
buildLedger(input: LedgerInput): Promise<LedgerResult>
```

Where:

```ts
// Validated input (Zod schema enforced at entry)
type LedgerInput = {
  repoUrl: string; // local path or https://github.com/... URL
  file: string; // repo-relative path, no ".." segments
  startLine: number; // 1-indexed, inclusive
  endLine: number; // 1-indexed, inclusive, max startLine + 499
  githubToken?: string;
};

type LedgerResult = {
  items: ReadonlyArray<EvidenceItem>;
  truncated: boolean; // true when > 50 commits were capped
  buildDurationMs: number;
};
```

---

## 3. Data models

These types are defined in `src/ghost/schema.ts` and re-exported from `src/evidence/ledger.ts`.
They are the source of truth for the entire application.

```ts
// Zod schema (source of truth)
export const EvidenceItemSchema = z.object({
  id: z.string().regex(/^E\d+$/),
  sha: z
    .string()
    .length(40)
    .regex(/^[0-9a-f]+$/),
  shortSha: z
    .string()
    .length(7)
    .regex(/^[0-9a-f]+$/),
  author: z.string().min(1).max(256),
  email: z.string().email().max(256),
  date: z.string().datetime(), // ISO 8601
  subject: z.string().max(512),
  body: z.string().max(4096),
  hunk: z.string(),
  files: z.array(z.string()),
  refs: z.array(z.string()), // e.g. ["#42", "#99"]
  pr: z
    .object({
      title: z.string(),
      body: z.string(),
    })
    .optional(),
  suspiciousMessage: z.boolean().default(false),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
```

`LedgerResultSchema` wraps an array with `truncated` and `buildDurationMs`.

Internal (not exported outside `src/evidence/`):

```ts
type RawBlameEntry = {
  sha: string;
  author: string;
  email: string;
  date: string;
  summary: string;
  filename: string;
  lineStart: number;
  lineCount: number;
};

type RawCommit = {
  sha: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  body: string;
  renames: RenameEvent[];
};

type RenameEvent = {
  fromFile: string;
  toFile: string;
  commitSha: string;
  offset: number;
};
type LineRange = { start: number; end: number };
```

---

## 4. Error taxonomy

All errors extend a base `SeanceError` class with `{ code: string; message: string }`.

| Error class       | `code`             | When thrown                                                           |
| ----------------- | ------------------ | --------------------------------------------------------------------- |
| `ValidationError` | `VALIDATION_ERROR` | Invalid `LedgerInput` (Zod fail, path traversal, range out of bounds) |
| `GitError`        | `GIT_ERROR`        | git subprocess exits non-zero or times out                            |
| `CloneError`      | `CLONE_ERROR`      | Remote clone exceeds size or time cap                                 |
| `SsrfError`       | `SSRF_ERROR`       | URL resolves to a non-GitHub host                                     |
| `ParseError`      | `PARSE_ERROR`      | Internal: git output fails the Zod parse (logged, item skipped)       |

`ValidationError` and `SsrfError` are always re-thrown to the API layer.
`GitError` and `CloneError` are re-thrown.
`ParseError` is caught inside the pipeline and causes item-level skipping, not request failure.

---

## 5. Line-range mapping algorithm

The `--follow` flag causes `git log -L` to replay the rename chain. Each diff in the output may
contain context that shifts line numbers. The mapping algorithm:

1. Start with `current = { start, end }` (original coordinates in HEAD).
2. Walk commits from newest to oldest (as emitted by `git log`).
3. For each commit, extract the `@@ -a,b +c,d @@` hunk header.
   - If the original range overlaps the `+c,d` side, compute `offset = a - c`.
   - Apply `current.start -= offset; current.end -= offset`.
4. Clamp: `current.start = Math.max(1, current.start)`.
5. Enforce order: if `current.end < current.start` set `current.end = current.start`.
6. Record `mappedRange = { ...current }` for this commit's `EvidenceItem`.

This is a pure function (`mapLineRange`) — the same rename log + original range always yields
the same per-commit mappings.

---

## 6. Remote clone lifecycle

```
resolveRepo(url)
  │
  ├─ validate URL matches /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/
  ├─ mkdir -p /tmp/seance-<uuid>/
  ├─ git clone --filter=blob:none --depth 100 <url> <dir>
  │    ├─ SIGKILL after 30 s (AbortController)
  │    └─ poll du -s every 2 s; SIGKILL if > 200 MB
  ├─ return { root: dir, cleanup: () => rm -rf dir }
  └─ caller MUST call cleanup() in finally
```

Concurrent clones for the same canonical URL are serialised via an in-process `Map<url, Promise>`.

---

## 7. Testing strategy

### Unit tests (`test/evidence/`)

| File             | What is tested                                                              |
| ---------------- | --------------------------------------------------------------------------- |
| `refs.test.ts`   | `parseRefs` — all patterns; deduplication; ordering; malformed input        |
| `refs.test.ts`   | `isSuspicious` — known prompt-injection strings; benign messages            |
| `git.test.ts`    | subprocess argument construction (spy on `spawn`); timeout enforcement      |
| `ledger.test.ts` | `buildLedger` — happy path with fixture repo; empty range; > 50 commits cap |
| `ledger.test.ts` | size caps: total hunk > 512 KB → hunk truncated; body/subject length caps   |
| `github.test.ts` | fetch success; network error → undefined; SSRF rejection; Zod parse failure |

Unit tests mock git calls (as built: with `vi.mock`, not a `test/fixtures/git-outputs/` layer). One
integration test, `test/evidence/crypt.test.ts`, does spawn real git on a generated sample repository.

### Property-based tests (`test/evidence/pbt/`) — fast-check

These encode the invariants from the Evidence Rules steering file:

| Property                             | Generator                                                                                                    | Invariant                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| **P1** Line-range non-negative       | `fc.array(fc.record({ offset: fc.integer() }))` for rename events + `fc.tuple(fc.nat(), fc.nat())` for range | `result.start >= 1 && result.end >= result.start`         |
| **P2** Line-range determinism        | same inputs twice                                                                                            | `deepEqual(mapLineRange(r,o), mapLineRange(r,o))`         |
| **P3** Refs deduplication            | `fc.string()` repeated N times in a commit message                                                           | `parseRefs(text).length <= unique count`                  |
| **P4** Refs no ReDoS                 | `fc.string({ maxLength: 10_000 })`                                                                           | completes in < 100 ms                                     |
| **P5** Suspicious flag correct       | `fc.constantFrom(...injectionStrings)` embedded in random text                                               | `isSuspicious` returns `true`                             |
| **P6** Ledger item count cap         | synthetic git output with > 50 commits                                                                       | `items.length <= 50 && (count > 50 → truncated === true)` |
| **P7** `shortSha` is prefix of `sha` | any valid `EvidenceItem`                                                                                     | `item.sha.startsWith(item.shortSha)`                      |
| **P8** Date is valid ISO 8601        | any valid `EvidenceItem`                                                                                     | `!isNaN(Date.parse(item.date))`                           |

Fast-check configuration: 1 000 runs per property, seed fixed in CI (`--seed` flag via Vitest
config) for reproducibility.

### Integration smoke test

One test in `test/evidence/ledger.integration.ts` (skipped in CI unless `INTEGRATION=1`) runs
`buildLedger` against the bundled crypt sample repo, asserting at least one `EvidenceItem` is
returned with all required fields populated.
