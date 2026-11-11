# Séance — Evidence Rules Steering

Rules for building, citing, and verifying the Evidence Ledger. These apply to all code in `src/evidence/` and `src/ghost/verifier.ts`.

## Ledger construction

- Each `EvidenceItem` requires: `id` (E1, E2 …), `sha` (full), `shortSha` (7 chars), `author`, `date` (ISO 8601), `subject`, `body`, `hunk`, `files[]`, `refs[]`
- Blame via `git blame --porcelain`; history via `git log -L <start>,<end>:<file>` with `--follow` for renames
- Issue/PR refs parsed from message with regex: `#\d+`, `Fixes #\d+`, `Closes #\d+`; GitHub PR/issue text appended to the item when a token is available
- Ledger is immutable after construction for a given request; the ghost never writes to it
- `author` and `email` are cut to 256 characters, `subject` to 512 and `body` to 4096

## Citation rules

These follow the `ward-hardening` spec, which supersedes `ghost-verifier` R3.5 (score formula) and `ward-report` R1.4 (silence items in the verified list).

- Every memory and speculation claim carries 1 to 10 `{ sha7, quote }` citations. **The quote is mandatory**: 8 to 500 characters (at least 8 after `trim()`)
- `sha7` must match the `shortSha` of exactly one ledger item. A hash shared by two items is ambiguous and refused
- The quote must be a **literal, case-sensitive substring of one single field** of the cited item: `subject`, `body` or `hunk.slice(0, HUNK_UI_CHARS)`. A quote that only exists across two fields, or past the first 4000 hunk characters, is refused
- Silence claim (`kind: "silence"`) has no citations, a `silenceReason` naming the question it cannot answer, and at most 300 characters in `text` and in `silenceReason`. It goes into its own `silent` bucket and is **never verified**; the UI labels it as the ghost's words, not checked
- Speculation claim (`kind: "speculation"`) is cited and quoted like memory and labelled in the response

## Verifier invariants (enforce in code and PBT)

- A verified citation's SHA is the `shortSha` of exactly one ledger item — reject otherwise
- A verified quote is a substring of one field of its cited item — reject otherwise. Quotes are compared raw and case-sensitively, never in a normalised form
- A year (1970–2099) named in a claim must be the UTC year of a cited item's `date` or appear in its fields; a ledger author named in a claim must have written a cited item or be named in it. Names outside the ledger, months and days are not checked
- The year and author checks run on the raw text and again on its detection form: NFKC with default-ignorable characters removed (U+00AD, U+034F, U+061C, U+115F, U+1160, U+17B4, U+17B5, U+180B–U+180F, U+200B–U+200F, U+202A–U+202E, U+2060–U+206F, U+3164, U+FE00–U+FE0F, U+FEFF, U+FFA0, U+E0000–U+E0FFF), on the claim, the ledger author names and the cited fields. Full-width digits name a year; a zero-width character inside a name does not hide it. The second pass only adds reasons (`ward-hardening` R11.4–R11.7)
- Matching stays case-sensitive: a name in another case (`alice` for `Alice`) is not checked, like a name outside the ledger. Letters that only look alike across scripts are not detected
- The ward proves the citation and the quote, not the sentence. Nothing in the UI or the report calls the sentence itself verified: the label is "Citations verified" (`ward-hardening` R11.1–R11.3)
- `score = verified / (verified + rejected + silent)`, 1 when there are no claims, always in [0, 1]. "N of M claims verified" uses N = verified and M = verified + rejected
- The verifier only ever becomes stricter, and is pure and deterministic: same ledger + same claims → same result every time

## PBT properties (fast-check)

- Verifier never accepts a SHA absent from the ledger, or one shared by two items
- Verifier never accepts a citation without a quote, or a quote that is not a substring of one field of its cited evidence
- Verifier never puts a silence claim in `verified`
- Verifier never verifies a claim the frozen verifier of 2026-11-11 rejects, or one the `d738258` verifier rejects
- Line-range mapping through renames never yields negative or out-of-order bounds
- Haunting score is monotone in age and TODO count; always within [0, 100]
