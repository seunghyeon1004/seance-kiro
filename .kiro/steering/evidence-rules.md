# Séance — Evidence Rules Steering

Rules for building, citing, and verifying the Evidence Ledger. These apply to all code in `src/evidence/` and `src/ghost/verifier.ts`.

## Ledger construction

- Each `EvidenceItem` requires: `id` (E1, E2 …), `sha` (full), `shortSha` (7 chars), `author`, `date` (ISO 8601), `subject`, `body`, `hunk`, `files[]`, `refs[]`
- Blame via `git blame --porcelain`; history via `git log -L <start>,<end>:<file>` with `--follow` for renames
- Issue/PR refs parsed from message with regex: `#\d+`, `Fixes #\d+`, `Closes #\d+`; GitHub PR/issue text appended to the item when a token is available
- Ledger is immutable after construction for a given request; the ghost never writes to it

## Citation rules

These follow the `ward-hardening` spec, which supersedes `ghost-verifier` R3.5 (score formula) and `ward-report` R1.4 (silence items in the verified list).

- Every memory and speculation claim carries 1 to 10 `{ sha7, quote }` citations. **The quote is mandatory**: 8 to 500 characters (at least 8 after `trim()`)
- `sha7` must match the `shortSha` of exactly one ledger item. A hash shared by two items is ambiguous and refused
- The quote must be a **literal, case-sensitive substring of one single field** of the cited item: `subject`, `body` or `hunk.slice(0, HUNK_UI_CHARS)`. A quote that only exists across two fields, or past the first 4000 hunk characters, is refused
- Silence claim (`kind: "silence"`) has no citations, a `silenceReason` naming the question it cannot answer, and at most 300 characters in `text` and in `silenceReason`. It goes into its own `silent` bucket and is **never verified**; the UI labels it as the ghost's words, not checked
- Speculation claim (`kind: "speculation"`) is cited and quoted like memory and labelled in the response

## Verifier invariants (enforce in code and PBT)

- A verified citation's SHA is the `shortSha` of exactly one ledger item — reject otherwise
- A verified quote is a substring of one field of its cited item — reject otherwise
- A year (1970–2099) named in a claim must be the UTC year of a cited item's `date` or appear in its fields; a ledger author named in a claim must have written a cited item or be named in it. Names outside the ledger, months and days are not checked
- `score = verified / (verified + rejected + silent)`, 1 when there are no claims, always in [0, 1]. "N of M claims verified" uses N = verified and M = verified + rejected
- The verifier only ever becomes stricter, and is pure and deterministic: same ledger + same claims → same result every time

## PBT properties (fast-check)

- Verifier never accepts a SHA absent from the ledger, or one shared by two items
- Verifier never accepts a citation without a quote, or a quote that is not a substring of one field of its cited evidence
- Verifier never puts a silence claim in `verified`
- Line-range mapping through renames never yields negative or out-of-order bounds
- Haunting score is monotone in age and TODO count; always within [0, 100]
