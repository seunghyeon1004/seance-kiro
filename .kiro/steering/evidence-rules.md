# Séance — Evidence Rules Steering

Rules for building, citing, and verifying the Evidence Ledger. These apply to all code in `src/evidence/` and `src/ghost/verifier.ts`.

## Ledger construction

- Each `EvidenceItem` requires: `id` (E1, E2 …), `sha` (full), `shortSha` (7 chars), `author`, `date` (ISO 8601), `subject`, `body`, `hunk`, `files[]`, `refs[]`
- Blame via `git blame --porcelain`; history via `git log -L <start>,<end>:<file>` with `--follow` for renames
- Issue/PR refs parsed from message with regex: `#\d+`, `Fixes #\d+`, `Closes #\d+`; GitHub PR/issue text appended to the item when a token is available
- Ledger is immutable after construction for a given request; the ghost never writes to it

## Citation rules

- Every ghost claim must carry at least one `{ sha7, quote? }` citation
- `sha7` must match a `shortSha` present in the ledger — no other value is valid
- When a `quote` is provided it must be a **literal substring** of `subject + body + hunk` of the cited item (case-sensitive)
- Silence claim (`kind: "silence"`) requires no citation but must state the question it cannot answer
- Speculation claim (`kind: "speculation"`) must carry a citation to the evidence that inspired it and be labelled in the response

## Verifier invariants (enforce in code and PBT)

- A verified citation's SHA is always present in the ledger — reject otherwise
- A verified quote is always a substring of its cited evidence text — reject otherwise
- Author and date named in a claim match the cited item's `author` and `date` fields
- `score = verified / total` is always in [0, 1]; `total` includes silence and speculation claims
- Verifier is pure and deterministic: same ledger + same claims → same result every time

## PBT properties (fast-check)

- Verifier never accepts a SHA absent from the ledger
- Verifier never accepts a quote that is not a substring of its cited evidence
- Line-range mapping through renames never yields negative or out-of-order bounds
- Haunting score is monotone in age and TODO count; always within [0, 100]
