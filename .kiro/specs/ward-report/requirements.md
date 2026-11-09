# Ward Report — Requirements

Spec ID: `ward-report`
Depends on: `ghost-verifier` (`VerifierResult`, `ClaimSchema`, `CitationSchema`)

## Why

`POST /api/ask` and `POST /api/ward` return the ward's verdict as JSON, and the page shows it, but there is no way to take that verdict anywhere else. A reviewer who asks the ghost about a line wants to paste the answer, with what was struck and why, into a pull request or an issue. Today they would copy rendered HTML by hand and lose the struck-through state and the reasons.

## Scope

A pure, deterministic Markdown renderer for a `VerifierResult`, plus (later) a copy button in the UI. No new model calls, no new network access.

## Functional requirements

**R1.1** When the system receives a `VerifierResult`, it shall return a Markdown string produced by `renderWardReport(result, meta)` in `src/ghost/report.ts`.

**R1.2** The first line shall be `# Ward report` and the report shall contain the line `**N of M claims verified**`, where N is `result.verified.length` and M is `result.verified.length + result.rejected.length`.

**R1.3** If `meta.file` and `meta.lines` are provided, the report shall contain a line naming the file and the line range.

**R1.4** Each verified claim shall render as one list item: the claim kind in brackets (`[memory]`, `[speculation]`, `[silence]`), the claim text, then each citation as `` `sha7` `` followed by the quote in double quotes when one exists. A silence claim shall render its `silenceReason`.

**R1.5** Each rejected claim shall render as one list item under a `## Struck by the ward` heading, with the claim text wrapped in `~~` and the rejection reason after it. The heading shall be omitted when there are no rejected claims.

**R1.6** Claim text, quotes and reasons come from the model or the commit history and are untrusted. Before rendering, the renderer shall neutralise Markdown that could change the report's structure: newlines shall be replaced with spaces, and the characters `` ` ``, `~`, `*`, `_`, `[`, `]`, `<`, `>` and `|` shall be backslash-escaped.

**R1.7** The renderer shall be pure: the same input shall produce the same string, it shall not read the clock, the environment or the filesystem, and it shall not mutate its input.

## Non-functional requirements

**N1** No new dependencies.

**N2** Property-based tests (fast-check) cover R1.2, R1.5 and R1.6.

## Out of scope

HTML or PDF export, persisting reports on the server, signing reports.
