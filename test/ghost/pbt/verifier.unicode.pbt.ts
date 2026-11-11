/**
 * inquisitor review (2026-11-11), finding 4 — property tests for ward-hardening R11.4–R11.7.
 *
 * CP10 only stricter than 2026-11-11  (R11.7): every claim the frozen copy of the verifier
 *      from before this change rejects, the current verifier rejects too.
 * CP11 normalised year                (R11.4): every year in the normalised text of a verified
 *      claim is a cited item's UTC year or appears in a normalised cited field.
 * CP12 normalised author              (R11.4): every normalised ledger author named in the
 *      normalised text of a verified claim wrote a cited item or is named in one.
 * CP13 raw quotes                     (R11.5): every verified quote is a raw, case-sensitive
 *      substring of the named field.
 *
 * The generators mix full-width digits, zero-width and other default-ignorable characters,
 * decomposed letters and case changes into the ledger and the claims.
 * fast-check: 1 000 runs per property; fixed seed via FAST_CHECK_SEED env var.
 */

import { describe, expect, it } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { verify } from '../../../src/ghost/verifier.js';
import { HUNK_UI_CHARS } from '../../../src/ghost/schema.js';
import type { EvidenceItem } from '../../../src/ghost/schema.js';
import { verify as verify20261111 } from './verifier-2026-11-11.js';
import { verify as verifyR11_4 } from './verifier-r11-4.js';

const SEED = process.env['FAST_CHECK_SEED']
  ? parseInt(process.env['FAST_CHECK_SEED'], 10)
  : undefined;
const fcParams: fc.Parameters<unknown> = {
  numRuns: 1_000,
  ...(SEED !== undefined ? { seed: SEED } : {}),
};

// ---------------------------------------------------------------------------
// Oracles, written independently of src/ghost/verifier.ts
// ---------------------------------------------------------------------------

const IGNORABLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xe0000, 0xe0fff],
];

const ignorable = (cp: number): boolean =>
  IGNORABLE_RANGES.some(([a, b]) => cp >= a && cp <= b);

function strip(s: string): string {
  let out = '';
  for (const ch of s) if (!ignorable(ch.codePointAt(0) ?? 0)) out += ch;
  return out;
}

const norm = (s: string): string => strip(strip(s).normalize('NFKC'));

/** R12.1 oracle: the whole Default_Ignorable_Code_Point class (static property, u flag). */
const DI_RE = /^\p{Default_Ignorable_Code_Point}$/u;
function stripDI(s: string): string {
  let out = '';
  for (const ch of s) if (!DI_RE.test(ch)) out += ch;
  return out;
}
const normDI = (s: string): string => stripDI(stripDI(s).normalize('NFKC'));
const ALL_DI: readonly string[] = (() => {
  const out: string[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCodePoint(cp);
    if (DI_RE.test(ch)) out.push(ch);
  }
  return out;
})();

type Field = 'subject' | 'body' | 'hunk';
const FIELDS: readonly Field[] = ['subject', 'body', 'hunk'];
const fieldText = (item: EvidenceItem, f: Field): string =>
  f === 'hunk' ? item.hunk.slice(0, HUNK_UI_CHARS) : item[f];

function yearsIn(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 4 <= s.length; i++) {
    const y = s.slice(i, i + 4);
    if (!/^[0-9]{4}$/.test(y)) continue;
    const n = Number(y);
    if (n < 1970 || n > 2099) continue;
    if (/[0-9]/.test(s[i - 1] ?? '') || /[0-9]/.test(s[i + 4] ?? '')) continue;
    out.push(y);
  }
  return out;
}

const isWordChar = (ch: string | undefined): boolean =>
  ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

function wholeWordAt(s: string, name: string): number[] {
  const out: number[] = [];
  if (name.length === 0) return out;
  for (let p = s.indexOf(name); p !== -1; p = s.indexOf(name, p + 1)) {
    if (!isWordChar(s[p - 1]) && !isWordChar(s[p + name.length])) out.push(p);
  }
  return out;
}

function namedAuthors(text: string, authors: readonly string[]): string[] {
  return authors.filter((a) =>
    wholeWordAt(text, a).some(
      (p) =>
        !authors.some(
          (b) =>
            b.length > a.length &&
            wholeWordAt(text, b).some((q) => q <= p && p + a.length <= q + b.length),
        ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const TRICKS = [
  '\u200B',
  '\u00AD',
  '\uFEFF',
  '\u2060',
  '\u{E0041}',
  '\uFE0F',
  '\u202E',
  // R12.1: outside the R11.4 list, inside the property
  '\u{1BCA0}',
  '\u{1D173}',
  '\uFFF0',
];
const AUTHORS = ['Alice', 'Bob', 'Jos\u00e9', 'Mal\u200Blory', 'Ａnn', 'Ann'] as const;
const SHA_POOL = ['abc1234', 'def5678', '0123abc', 'fedcba9', '1111111'] as const;
const WORDS = [
  'the',
  'vendor',
  'queue',
  'retry',
  '2020',
  '２０２０',
  '2021',
  '２０２３',
  '20\u200B22',
  '20\u{1D173}23',
  '20\u200B24\u{1BCA0}5',
  'Alice',
  'alice',
  'A\u200Blice',
  'A\u{1BCA0}lice',
  'Bob',
  'B\u00ADob',
  'B\u200Bob\u{1BCA0}by',
  'Jos\u00e9',
  'Jose\u0301',
  'Mallory',
  'Mal\u200Blory',
  'Ann',
  'Ａnn',
  "Ann's",
  '\u200B',
] as const;

const wordsArb = (max: number): fc.Arbitrary<string> =>
  fc
    .array(
      fc.oneof(
        { weight: 6, arbitrary: fc.constantFrom(...WORDS) },
        { weight: 1, arbitrary: fc.constantFrom(...TRICKS) },
      ),
      { maxLength: max },
    )
    .map((a) => a.join(' '));

const fieldArb = fc.oneof(
  { weight: 5, arbitrary: wordsArb(10) },
  { weight: 1, arbitrary: fc.string({ maxLength: 40, unit: 'grapheme' }) },
);

const itemArb: fc.Arbitrary<EvidenceItem> = fc
  .record({
    shortSha: fc.constantFrom(...SHA_POOL),
    author: fc.constantFrom(...AUTHORS),
    year: fc.integer({ min: 2019, max: 2024 }),
    subject: fieldArb,
    body: fieldArb,
    hunk: fieldArb,
  })
  .map((r) => ({
    id: 'E1',
    sha: r.shortSha + '0'.repeat(33),
    shortSha: r.shortSha,
    author: r.author,
    email: 'x@example.com',
    date: `${r.year}-06-15T12:00:00.000Z`,
    subject: r.subject,
    body: r.body,
    hunk: r.hunk,
    files: [],
    refs: [],
    suspiciousMessage: false,
  }));

const ledgerArb = fc
  .array(itemArb, { minLength: 1, maxLength: 5 })
  .map((items) => items.map((it, i) => ({ ...it, id: `E${i + 1}` })));

type RawClaim = {
  kind: 'memory' | 'speculation';
  text: string;
  citations: { sha7: string; quote: string }[];
};

function citationArb(ledger: readonly EvidenceItem[]): fc.Arbitrary<{
  sha7: string;
  quote: string;
}> {
  const good = fc
    .tuple(
      fc.constantFrom(...ledger),
      fc.constantFrom(...FIELDS),
      fc.nat(),
      fc.integer({ min: 8, max: 30 }),
    )
    .map(([it, f, s, n]) => {
      const t = fieldText(it, f);
      const start = t.length <= n ? 0 : s % (t.length - n);
      return { sha7: it.shortSha, quote: t.slice(start, start + n) };
    });
  const normalisedQuote = good.map((c) => ({ ...c, quote: norm(c.quote) }));
  return fc.oneof(
    { weight: 6, arbitrary: good },
    { weight: 1, arbitrary: normalisedQuote },
    {
      weight: 1,
      arbitrary: fc.record({
        sha7: fc.constantFrom(...SHA_POOL),
        quote: wordsArb(4),
      }),
    },
  );
}

const caseArb = ledgerArb.chain((ledger) =>
  fc
    .array(
      fc.record({
        kind: fc.constantFrom('memory' as const, 'speculation' as const),
        text: wordsArb(6).map((t) => (t.trim().length === 0 ? 'x' : t)),
        citations: fc.array(citationArb(ledger), { minLength: 1, maxLength: 2 }),
      }),
      { minLength: 1, maxLength: 6 },
    )
    .map((claims: RawClaim[]) => ({ ledger, claims })),
);

const citedItems = (ledger: readonly EvidenceItem[], c: RawClaim): EvidenceItem[] =>
  c.citations.flatMap((x) => ledger.filter((i) => i.shortSha === x.sha7));

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('generators reach the new checks', () => {
  it('a sample has verified claims and claims only the new checks reject', () => {
    const cases = fc.sample(caseArb, {
      numRuns: 500,
      ...(SEED !== undefined ? { seed: SEED } : {}),
    });
    let verified = 0;
    let newlyRejected = 0;
    for (const { ledger, claims } of cases) {
      const now = verify(ledger, { claims });
      const before = verify20261111(ledger, { claims });
      verified += now.verified.length;
      newlyRejected += before.verified.length - now.verified.length;
    }
    expect(verified).toBeGreaterThan(30);
    expect(newlyRejected).toBeGreaterThan(0);
  });
});

describe('CP10 — only stricter than the verifier of 2026-11-11 (R11.7)', () => {
  test.prop([caseArb], fcParams)(
    'every claim the frozen verifier rejects is rejected by the current one',
    ({ ledger, claims }) => {
      const before = verify20261111(ledger, { claims });
      const now = verify(ledger, { claims });
      const beforeRejected = new Set(before.rejected.map((r) => r.index));
      for (const v of now.verified) expect(beforeRejected.has(v.index)).toBe(false);
      for (const s of now.silent) expect(beforeRejected.has(s.index)).toBe(false);
    },
  );
});

describe('CP11 — normalised year (R11.4)', () => {
  test.prop([caseArb], fcParams)(
    'every year in the normalised text of a verified claim is supported by a cited item',
    ({ ledger, claims }) => {
      for (const v of verify(ledger, { claims }).verified) {
        const cited = citedItems(ledger, claims[v.index]!);
        for (const y of yearsIn(norm(v.claim.text))) {
          const ok = cited.some(
            (it) =>
              it.date.slice(0, 4) === y ||
              FIELDS.some((f) => yearsIn(norm(fieldText(it, f))).includes(y)),
          );
          expect(ok, `year ${y} in ${JSON.stringify(v.claim.text)}`).toBe(true);
        }
      }
    },
  );
});

describe('CP12 — normalised author (R11.4)', () => {
  test.prop([caseArb], fcParams)(
    'every normalised ledger author named in a verified claim is supported by a cited item',
    ({ ledger, claims }) => {
      const authors = [...new Set(ledger.map((i) => norm(i.author)))];
      for (const v of verify(ledger, { claims }).verified) {
        const cited = citedItems(ledger, claims[v.index]!);
        for (const a of namedAuthors(norm(v.claim.text), authors)) {
          const ok = cited.some(
            (it) =>
              norm(it.author) === a ||
              FIELDS.some((f) => wholeWordAt(norm(fieldText(it, f)), a).length > 0),
          );
          expect(ok, `author ${a} in ${JSON.stringify(v.claim.text)}`).toBe(true);
        }
      }
    },
  );
});

describe('CP13 — quotes stay raw (R11.5)', () => {
  test.prop([caseArb], fcParams)(
    'every verified quote is a raw, case-sensitive substring of the named field',
    ({ ledger, claims }) => {
      for (const v of verify(ledger, { claims }).verified) {
        for (const q of v.quotes) {
          const it = ledger.find((i) => i.shortSha === q.sha7)!;
          expect(fieldText(it, q.field).includes(q.quote)).toBe(true);
        }
      }
    },
  );
});

// ---------------------------------------------------------------------------
// inquisitor second pass (2026-11-11) — ward-hardening R12.1–R12.3
// ---------------------------------------------------------------------------

describe('CP14 — only stricter than the R11.4 verifier (R12.3)', () => {
  test.prop([caseArb], fcParams)(
    'every claim the frozen R11.4 verifier rejects is rejected by the current one',
    ({ ledger, claims }) => {
      const before = verifyR11_4(ledger, { claims });
      const now = verify(ledger, { claims });
      const beforeRejected = new Set(before.rejected.map((r) => r.index));
      for (const v of now.verified) expect(beforeRejected.has(v.index)).toBe(false);
      for (const s of now.silent) expect(beforeRejected.has(s.index)).toBe(false);
    },
  );

  it('the generators reach claims only the R12.1 form rejects', () => {
    const cases = fc.sample(caseArb, {
      numRuns: 500,
      ...(SEED !== undefined ? { seed: SEED } : {}),
    });
    let newlyRejected = 0;
    for (const { ledger, claims } of cases) {
      newlyRejected +=
        verifyR11_4(ledger, { claims }).verified.length -
        verify(ledger, { claims }).verified.length;
    }
    expect(newlyRejected).toBeGreaterThan(0);
  });
});

describe('CP15 — the property form: years and authors (R12.1)', () => {
  test.prop([caseArb], fcParams)(
    'every year and ledger author in the property form of a verified claim is supported',
    ({ ledger, claims }) => {
      const authors = [...new Set(ledger.map((i) => normDI(i.author)))];
      for (const v of verify(ledger, { claims }).verified) {
        const cited = citedItems(ledger, claims[v.index]!);
        const t = normDI(v.claim.text);
        for (const y of yearsIn(t)) {
          const ok = cited.some(
            (it) =>
              it.date.slice(0, 4) === y ||
              FIELDS.some((f) => yearsIn(normDI(fieldText(it, f))).includes(y)),
          );
          expect(ok, `year ${y} in ${JSON.stringify(v.claim.text)}`).toBe(true);
        }
        for (const a of namedAuthors(t, authors)) {
          const ok = cited.some(
            (it) =>
              normDI(it.author) === a ||
              FIELDS.some((f) => wholeWordAt(normDI(fieldText(it, f)), a).length > 0),
          );
          expect(ok, `author ${a} in ${JSON.stringify(v.claim.text)}`).toBe(true);
        }
      }
    },
  );
});

describe('CP16 — any default-ignorable code point inside a name or a year (R12.1)', () => {
  const alice: EvidenceItem = {
    id: 'E1',
    sha: 'def5678' + '0'.repeat(33),
    shortSha: 'def5678',
    author: 'Alice',
    email: 'a@example.com',
    date: '2024-01-01T00:00:00.000Z',
    subject: 'feat: the queue',
    body: '',
    hunk: '',
    files: [],
    refs: [],
    suspiciousMessage: false,
  };
  const bob: EvidenceItem = {
    ...alice,
    id: 'E2',
    sha: 'abc1234' + '0'.repeat(33),
    shortSha: 'abc1234',
    author: 'Bob',
    date: '2020-03-01T00:00:00.000Z',
    subject: 'fix: supported phrase',
  };
  test.prop(
    [
      fc.constantFrom(...ALL_DI),
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 1, max: 3 }),
      fc.boolean(),
    ],
    fcParams,
  )('is caught when only Bob’s 2020 commit is cited', (ch, at, yearAt, asYear) => {
    const text = asYear
      ? `Bob wrote this in ${'2024'.slice(0, yearAt)}${ch}${'2024'.slice(yearAt)}.`
      : `${'Alice'.slice(0, at)}${ch}${'Alice'.slice(at)} wrote this.`;
    const r = verify([alice, bob], {
      claims: [
        {
          kind: 'memory',
          text,
          citations: [{ sha7: 'abc1234', quote: 'supported phrase' }],
        },
      ],
    });
    expect(r.verified).toHaveLength(0);
    expect(r.rejected[0]?.reason).toContain(asYear ? 'the year 2024' : 'names Alice');
  });
});
