# Séance — Evidence Rules Steering

Rules for building, citing and verifying the Evidence Ledger. They apply to `src/evidence/`, `src/ghost/schema.ts` and `src/ghost/verifier.ts`. The code is the source of truth; keep this file in step with it.

## Ledger construction

- `EvidenceItem` (`EvidenceItemSchema`): `id` (`E1`, `E2` …), `sha` (40 lowercase hex), `shortSha` (7 lowercase hex), `author` (1–256), `email` (≤ 256), `date` (ISO 8601, normalised to UTC), `subject` (≤ 512), `body` (≤ 4096), `hunk`, `files[]`, `refs[]`, optional `pr { title, body }`, `suspiciousMessage`.
- `buildLedger` cuts `author` and `email` to 256, `subject` to 512 and `body` to 4096 characters; `isSuspicious` sees the full author, subject and body first.
- Blame: `git blame --porcelain -L<start>,<end> -- <file>`. History: `git log -L<start>,<end>:<file> --date=iso-strict --format=fuller`. `-L` follows renames itself; never add `--follow` or a pathspec to it.
- At most 50 items (the most recent are kept), hunks at most 512 KB combined. Items are frozen; the ghost never writes to the ledger.
- Refs: `Fix #n`, `Fixes #n`, `Close(s) #n`, `Resolve(s) #n` (keyword case-insensitive) and a bare `#n` after start, whitespace or punctuation. Only when an API client sends `githubToken` (the page does not), the first ref's title and body go into `item.pr`. Each GitHub request is bounded by `GITHUB_TIMEOUT_MS` (5000 ms) and none starts after a remote summon's deadline has passed. `pr` is not a quote field.

## Citation rules

- Memory and speculation claims carry 1 to 10 `{ sha7, quote }` citations; an answer has 1 to 50 claims.
- `sha7` is 7 lowercase hex and must be the `shortSha` of exactly one ledger item. A hash shared by two items is ambiguous and refused.
- **The quote is mandatory**: at least 8 characters after `trim()`, at most 500 untrimmed.
- The quote must be a literal, case-sensitive substring of **one** field of the cited item: `subject`, `body` or `hunk.slice(0, HUNK_UI_CHARS)` (4000). A quote spanning two fields, or past 4000 hunk characters, is refused.
- Silence claim: no citations, `text` and `silenceReason` each 1 to 300 characters. It goes into the `silent` bucket and is **never verified**.
- Speculation claim: checked exactly like memory; a verified one has `speculative: true` and the UI labels it "Speculation".

## Verifier invariants (enforce in code and PBT)

- Each claim is checked on its own; one bad claim never rejects another. The input is not mutated; the result is frozen.
- Quotes are compared raw and case-sensitively, never normalised.
- Years: every four-digit year 1970–2099 in the claim text (not touching another ASCII digit) must be the year of a cited item's `date` or appear in one of its quote fields.
- Authors: every ledger author named in the claim as a whole word must be the author of a cited item or appear as a whole word in one of its quote fields. Longer names are matched first; names outside the ledger, other casings, months and days are not checked. Matching uses `indexOf`, never a regex built from ledger or claim text.
- The year and author checks run on the raw text, then on two detection forms: the R11.4 form (the frozen `R11_4_IGNORABLE_RANGES` list, kept only so the ward never loosens; never extend it) and `detectionText()`, which removes every `\p{Default_Ignorable_Code_Point}` (a fixed Unicode property pattern, never built from input). Each form is: ignorables removed, NFKC, ignorables removed again, case kept. Each later pass only adds reasons.
- Stated limits: matching is case-sensitive (`alice` is not checked as `Alice`), and letters that only look alike across scripts (a Cyrillic `А` in `Alice`) are not detected. Neither is folded or mapped.
- The ward proves the citation and the quote, not the sentence. The label is "Citations verified"; nothing calls the sentence verified.
- `score = verified / (verified + rejected + silent)`, 1 with no claims, always in [0, 1]. The count uses N = verified, M = verified + rejected: "N of M claims passed the ward" in the report and in the UI.
- The verifier is pure and deterministic, and it only becomes stricter.

## PBT properties (fast-check)

- Never accepts a SHA absent from the ledger, or one shared by two items.
- Never accepts a citation without a quote, or a quote that is not a substring of one field of its cited item.
- Never puts a silence claim in `verified`.
- Never verifies a claim that the frozen copies `test/ghost/pbt/verifier-2026-11-11.ts`, `test/ghost/pbt/verifier-r11-4.ts` or `test/ghost/pbt/legacy-verifier.ts` (`d738258`) reject. Never edit those copies.
- Line-range mapping through renames never yields negative or out-of-order bounds.
- Haunting score is monotone in age and TODO count and stays within [0, 100].
