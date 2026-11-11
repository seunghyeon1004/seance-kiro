# Ward Report — Design

## Module

`src/ghost/report.ts`

```ts
export interface WardReportMeta {
  file?: string;
  lines?: { start: number; end: number };
}

export function escapeMd(text: string): string;
export function renderWardReport(result: VerifierResult, meta?: WardReportMeta): string;
```

- `escapeMd` replaces `\r\n`, `\r` and `\n` with a single space, then backslash-escapes `` ` ~ * _ [ ] < > | `` and a literal backslash. It is exported so the property tests can use it as an oracle.
- `renderWardReport` builds an array of lines and joins it with `\n`. Order: title, optional location line, count line, blank line, `## Verified` heading (`## Citations verified` since 2026-11-11, see below) and items (heading omitted when there are none), then `## Struck by the ward` and items when `rejected.length > 0`.
- The sha7 inside backticks is not escaped: `CitationSchema` already restricts it to 7 lowercase hex characters.

## Item formats

```
- [memory] Retry after 3 s — `a1b2c3d` "vendor returns 429"
- [silence] The record is silent. Reason: no commit mentions the timeout
- ~~Invented reason~~ — rejected: sha deadbee not in ledger
```

## API and UI (T3, not part of the first pass)

`POST /api/ask` and `POST /api/ward` gain a `report` string field built with `renderWardReport`. The ghost panel gets a "Copy ward report" button that writes `report` to the clipboard.

## Testing

- Unit tests in `test/ghost/report.test.ts` for each item format and for heading omission.
- Property tests in `test/ghost/pbt/report.pbt.ts`:
  - P1 (R1.2): the count line matches the input lengths for any generated `VerifierResult`.
  - P2 (R1.5): every rejected claim's escaped text appears between `~~` markers, and the struck heading appears iff `rejected.length > 0`.
  - P3 (R1.6): for any string, `escapeMd` output contains no newline and no unescaped structural character.
  - P4 (R1.7): rendering twice gives the same string and the input is unchanged (deep-equal to a structured clone).

## Note: inquisitor review (2026-11-11)

`ward-hardening` R11.1 renames the heading of the verified section to `## Citations verified`, because the ward proves each citation and quote, not the claim's sentence. The count line `**N of M claims verified**` and the limit line after it (`ward-hardening` R2.4) are unchanged, and so is what the ward accepts. `ward-hardening` R11.9 adds a third step to `escapeMd`: the bidi controls U+202A–U+202E and U+2066–U+2069 become the visible text `\u202E` and so on. Tests: `test/ghost/report.test.ts`, P5 in `test/ghost/pbt/report.pbt.ts`.

## Addendum: inquisitor second pass (2026-11-11)

R1.2 is superseded by R2.1: `renderWardReport` writes `**N of M claims passed the ward**`. N and M are computed as before, and silence claims stay out of both. `escapeMd` step 3 now matches `[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]` and writes each as `\u` plus four upper-case hex digits (`padStart(4, '0')`, so U+061C reads `\u061C`), R2.2. A zero-width space is not a bidi mark and is left as it was. The examples above that show the old count line describe the first pass. Tests: `test/ghost/report.test.ts`, P1 and P5 in `test/ghost/pbt/report.pbt.ts`, and every test that quotes the count line (`test/server/ask.test.ts`, `test/mcp/tools.test.ts`, `test/mcp/stdio.test.ts`, `test/ghost/schema.test.ts`).
