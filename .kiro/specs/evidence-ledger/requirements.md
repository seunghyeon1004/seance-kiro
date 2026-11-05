# Evidence Ledger — Requirements

Feature scope: deterministic extraction of git history for a file+line range into an immutable,
numbered Evidence Ledger. No LLM is involved in this feature; all outputs are derived solely from
`git` subprocess calls and optional GitHub REST lookups.

---

## Functional requirements

### R1 — Blame extraction

1. **R1.1** When the system receives a valid local repository path, a relative file path, and a
   line range `[start, end]` (1-indexed, inclusive), it SHALL run `git blame --porcelain` on that
   range and parse every commit boundary it contains.

2. **R1.2** The blame output SHALL be parsed with a Zod schema that rejects any field that does not
   conform to the expected types; a parse failure for an individual commit SHOULD log a warning and
   skip that commit rather than aborting the entire request.

3. **R1.3** The system SHALL NOT execute any code found in the cloned repository; it MUST only
   invoke `git` subprocess commands with hard-coded argument templates.

### R2 — Log-L history extraction

4. **R2.1** When blame extraction is complete, the system SHALL run `git log -L <start>,<end>:<file>
   --follow --format=fuller` to obtain the ordered commit history for the given line range,
   including renames.

5. **R2.2** The `--follow` flag SHALL be applied so that renames are tracked across the line-range
   history; the system SHALL update the file path used in subsequent commands when a rename is
   detected.

6. **R2.3** Each log entry SHALL include: full commit SHA, author name, author email, author date
   (ISO 8601), committer date, subject, body, and the diff hunk for the specified lines.

7. **R2.4** When `git log -L` returns no output for the requested range (empty file section or
   newly added lines with no prior history), the system SHALL return an empty ledger rather than
   an error.

### R3 — Line-range mapping

8. **R3.1** When a rename is detected in the `--follow` history, the system SHALL map the
   original `[start, end]` coordinates forward through each rename event so that each
   `EvidenceItem` records the line range as it appeared in the commit where the hunk was authored.

9. **R3.2** The mapped line range SHALL always satisfy `start >= 1` and `end >= start`; if a
   mapping would violate either invariant the system SHALL clamp to the nearest valid value and
   emit a warning.

10. **R3.3** Line-range mapping SHALL be a pure function with no side effects, enabling property-
    based testing.

### R4 — Commit metadata and diff hunk

11. **R4.1** For every distinct commit SHA surfaced by blame or log-L, the system SHALL produce
    exactly one `EvidenceItem`; duplicate SHAs MUST be deduplicated before ledger assembly.

12. **R4.2** Each `EvidenceItem` SHALL carry: `id` (sequential, "E1" … "En" in log order), `sha`
    (full 40-char hex), `shortSha` (first 7 chars of `sha`), `author` (display name), `email`,
    `date` (ISO 8601, author date), `subject` (first line of commit message), `body` (remainder of
    commit message, may be empty string), `hunk` (raw unified-diff hunk for the line range as a
    string), `files` (all files changed in the commit), and `refs` (parsed issue/PR references).

13. **R4.3** The `hunk` field SHALL be the raw text output from `git show` for the target file in
    that commit, constrained to the lines relevant to the requested range; if extraction fails for a
    single item the `hunk` field SHALL be an empty string and the error SHALL be logged.

### R5 — Issue and PR reference parsing

14. **R5.1** The system SHALL parse `subject + body` of every commit message for references
    matching the patterns `#\d+`, `Fixes #\d+`, `Closes #\d+`, `Resolves #\d+`, and
    `Fix #\d+` (case-insensitive for the keyword prefix).

15. **R5.2** All matched reference numbers SHALL be stored in `refs[]` as strings (e.g. `"#123"`),
    deduplicated, and ordered by first appearance in the message.

16. **R5.3** When parsing commit messages, the system SHALL treat all message text as untrusted
    data; regex parsing MUST NOT use `eval`, dynamic code generation, or ReDoS-susceptible
    patterns; all patterns SHALL be anchored or bounded so that pathological input cannot cause
    catastrophic backtracking.

### R6 — GitHub PR/issue text enrichment (optional)

17. **R6.1** When a GitHub API token is available (environment variable `GITHUB_TOKEN`) and the
    repository is a public GitHub repository, the system SHALL attempt to fetch the title and body
    of each referenced PR or issue via the GitHub REST API and attach it to the `EvidenceItem` as
    `pr: { title: string; body: string }`.

18. **R6.2** The GitHub enrichment MUST be non-blocking: a failure (network error, rate-limit,
    missing token, non-GitHub repo) SHALL log a warning and leave `pr` undefined; it MUST NOT
    cause the ledger construction to fail or throw.

19. **R6.3** The system SHALL only contact `api.github.com`; any redirect or response that resolves
    to a different host SHALL be rejected (SSRF prevention).

20. **R6.4** GitHub API responses SHALL be parsed with a Zod schema; fields not matching the schema
    SHALL be discarded rather than causing a runtime error.

### R7 — Ledger assembly and immutability

21. **R7.1** The completed ledger SHALL be an ordered, read-only array of `EvidenceItem` objects,
    with items ordered from oldest to newest commit date.

22. **R7.2** The ledger SHALL be frozen (e.g. `Object.freeze` on the array and each item) before
    being returned to callers; any attempt to mutate it SHALL throw in strict mode.

23. **R7.3** The ledger SHALL be constructed for exactly one request; each call to `buildLedger`
    MUST return a fresh, independent ledger with no shared mutable state between calls.

### R8 — Remote repository support

24. **R8.1** When the input is a URL rather than a local path, the system SHALL accept only URLs
    matching `https://github.com/<owner>/<repo>(.git)?`; any other scheme or host SHALL be
    rejected with a validation error before any network call is made.

25. **R8.2** Remote repositories SHALL be cloned with `git clone --filter=blob:none --depth 100`
    into a system temporary directory; the clone MUST be deleted when the request completes
    (success or error).

26. **R8.3** The clone operation SHALL be subject to a configurable time cap (default 30 s) and a
    size cap on the working-tree (default 200 MB); exceeding either cap SHALL abort the clone,
    delete any partial data, and return a descriptive error to the caller.

27. **R8.4** Concurrent clone operations for the same URL SHALL be serialised or de-duplicated to
    prevent redundant network use.

### R9 — Input validation and error handling

28. **R9.1** All inputs to `buildLedger` (path/URL, file, line range) SHALL be validated with a
    Zod schema before any git subprocess is spawned; invalid inputs SHALL produce a typed
    `ValidationError` and MUST NOT reach the git layer.

29. **R9.2** Line range `start` and `end` SHALL be positive integers with `start <= end`; the
    maximum range width is 500 lines; inputs outside these bounds SHALL be rejected.

30. **R9.3** The file path parameter MUST NOT contain `..` sequences or absolute path segments
    after the repository root is resolved; the system SHALL reject path-traversal attempts with a
    `ValidationError`.

31. **R9.4** All git subprocess calls SHALL use argument arrays (never shell-interpolated strings)
    to prevent command injection; any argument derived from user input SHALL be validated against
    a safe-characters allowlist before being passed to the subprocess.

### R10 — Size and safety caps

32. **R10.1** The number of `EvidenceItem` objects in a single ledger SHALL be capped at 50; when
    the history contains more than 50 distinct commits the system SHALL retain the 50 most recent
    and attach a `truncated: true` flag to the ledger.

33. **R10.2** The total size of all `hunk` fields combined in one ledger SHALL not exceed 512 KB;
    items whose addition would exceed this limit SHALL have their `hunk` field replaced with an
    empty string.

34. **R10.3** Individual commit `body` fields SHALL be truncated to 4 096 characters; the `subject`
    field SHALL be truncated to 512 characters.

### R11 — Untrusted text handling

35. **R11.1** Commit messages (`subject`, `body`), diff hunks, author names, and GitHub PR/issue
    text SHALL be stored as plain strings and MUST NOT be interpreted as HTML, Markdown with
    active content, or executable code at any point in the evidence pipeline.

36. **R11.2** When ledger text is later forwarded to the LLM, callers SHALL wrap it in explicit
    delimiters and prefix it with an untrusted-data marker; this wrapping is the responsibility of
    the ghost layer, not the ledger.

37. **R11.3** The system SHALL detect and flag (but not remove) commit messages that contain
    substrings resembling prompt-injection patterns (e.g. `ignore previous instructions`,
    `system:`, `<|`) by setting `suspiciousMessage: true` on the relevant `EvidenceItem`; the
    final decision on how to handle such items is left to the caller.

---

## Non-functional requirements

38. **R12.1** Ledger construction for a local repository SHALL complete within 10 seconds for a
    line range of up to 500 lines with up to 50 commits of history (p95 on commodity hardware).

39. **R12.2** All public functions in `src/evidence/` SHALL be fully typed in TypeScript strict
    mode with no `any`; Zod schemas SHALL be co-located with the types they validate.

40. **R12.3** The ledger builder SHALL be deterministic: identical inputs (same repo state, same
    file, same line range) SHALL always produce ledgers with identical content (same items, same
    order, same field values).
