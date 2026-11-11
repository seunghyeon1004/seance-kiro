/**
 * ward-hardening T1 — property tests for the hardened verifier (design.md §12, CP1–CP9).
 *
 * CP1 no quote, no verify          (R1.3, R1.4, R9.4)
 * CP2 one field                    (R1.5, R2.1, R9.4)
 * CP3 unique membership            (R1.7)
 * CP4 only stricter than d738258   (R1.10)
 * CP5 year                         (R3.1)
 * CP6 author                       (R3.2)
 * CP7 partition                    (R1.8, R4.1)
 * CP8 score                        (R4.4)
 * CP9 pure (verifier half)         (N2)
 *
 * fast-check: 1 000 runs per property; fixed seed via FAST_CHECK_SEED env var.
 */

import { describe, expect, it } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { z } from 'zod';
import { verify } from '../../../src/ghost/verifier.js';
import { HUNK_UI_CHARS } from '../../../src/ghost/schema.js';
import type { EvidenceItem, VerifierResult } from '../../../src/ghost/schema.js';
import { verify as legacyVerify } from './legacy-verifier.js';

// ---------------------------------------------------------------------------
// fast-check configuration
// ---------------------------------------------------------------------------

const SEED = process.env['FAST_CHECK_SEED']
  ? parseInt(process.env['FAST_CHECK_SEED'], 10)
  : undefined;

const fcParams: fc.Parameters<unknown> = {
  numRuns: 1_000,
  ...(SEED !== undefined ? { seed: SEED } : {}),
};

// ---------------------------------------------------------------------------
// Test oracles (independent of the implementation)
// ---------------------------------------------------------------------------

type Field = 'subject' | 'body' | 'hunk';
const FIELDS: readonly Field[] = ['subject', 'body', 'hunk'];

function fieldText(item: EvidenceItem, f: Field): string {
  return f === 'hunk' ? item.hunk.slice(0, HUNK_UI_CHARS) : item[f];
}

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

/** Start positions of whole-word occurrences of `name` in `s`. */
function wholeWordAt(s: string, name: string): number[] {
  const out: number[] = [];
  for (let p = s.indexOf(name); p !== -1; p = s.indexOf(name, p + 1)) {
    if (!isWordChar(s[p - 1]) && !isWordChar(s[p + name.length])) out.push(p);
  }
  return out;
}

/** Authors named in `text` as whole words, ignoring occurrences covered by a longer named author. */
function namedAuthors(text: string, authors: readonly string[]): string[] {
  const named: string[] = [];
  for (const a of authors) {
    const covered = (p: number): boolean =>
      authors.some(
        (b) =>
          b.length > a.length &&
          wholeWordAt(text, b).some((q) => q <= p && p + a.length <= q + b.length),
      );
    if (wholeWordAt(text, a).some((p) => !covered(p))) named.push(a);
  }
  return named;
}

function itemsBySha(ledger: readonly EvidenceItem[], sha7: string): EvidenceItem[] {
  return ledger.filter((i) => i.shortSha === sha7);
}

function indexesOf(r: VerifierResult): number[] {
  return [
    ...r.verified.map((v) => v.index),
    ...r.rejected.map((x) => x.index),
    ...r.silent.map((s) => s.index),
  ];
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const AUTHORS = ['Ada Lovelace', 'Ada', 'Grace Hopper', 'Ann', 'Linus'] as const;
const SHA_POOL = [
  'abc1234',
  'def5678',
  '0123abc',
  'fedcba9',
  '1111111',
  '2222222',
  '3333333',
  '4444444',
] as const;
const WORDS = [
  'wait',
  'for',
  'the',
  'vendor',
  'returns',
  '429',
  'retry',
  'queue',
  '2019',
  '2021',
  '1999',
  '12019',
  'Ada',
  'Ada Lovelace',
  'Grace Hopper',
  'Ann',
  "Ann's",
  'Annual',
  'sleep(3000);',
  '\n',
  '',
] as const;

const wordsArb = (max: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...WORDS), { maxLength: max }).map((a) => a.join(' '));

const fieldArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: wordsArb(12) },
  { weight: 1, arbitrary: fc.string({ maxLength: 60 }) },
);

const hunkArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fieldArb },
  { weight: 1, arbitrary: fieldArb.map((f) => 'h'.repeat(HUNK_UI_CHARS - 4) + f) },
);

const itemArb: fc.Arbitrary<EvidenceItem> = fc
  .record({
    shortSha: fc.constantFrom(...SHA_POOL),
    tail: fc.hexaString({ minLength: 33, maxLength: 33 }),
    author: fc.constantFrom(...AUTHORS),
    year: fc.integer({ min: 2015, max: 2024 }),
    subject: fieldArb,
    body: fieldArb,
    hunk: hunkArb,
    suspiciousMessage: fc.boolean(),
  })
  .map((r) => ({
    id: 'E1',
    sha: r.shortSha + r.tail.toLowerCase(),
    shortSha: r.shortSha,
    author: r.author,
    email: 'x@example.com',
    date: `${r.year}-06-15T12:00:00.000Z`,
    subject: r.subject,
    body: r.body,
    hunk: r.hunk,
    files: [],
    refs: [],
    suspiciousMessage: r.suspiciousMessage,
  }));

/** Ledgers of 1–6 items; shortShas come from a pool of 4, so duplicates are common (CP3). */
const ledgerArb: fc.Arbitrary<EvidenceItem[]> = fc
  .array(itemArb, { minLength: 1, maxLength: 6 })
  .map((items) => items.map((it, i) => ({ ...it, id: `E${i + 1}` })));

/** A quote drawn from the ledger in several ways, or none at all. */
function quoteArb(ledger: readonly EvidenceItem[]): fc.Arbitrary<string | undefined> {
  const item = fc.constantFrom(...ledger);
  const slice = fc
    .tuple(item, fc.constantFrom(...FIELDS), fc.nat(), fc.integer({ min: 0, max: 40 }))
    .map(([it, f, s, n]) => {
      const t = fieldText(it, f);
      const start = t.length === 0 ? 0 : s % t.length;
      return t.slice(start, start + n);
    });
  const across = fc
    .tuple(item, fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 20 }))
    .map(([it, a, b]) => it.subject.slice(-a) + ' ' + it.body.slice(0, b));
  return fc.oneof(
    { weight: 6, arbitrary: slice },
    { weight: 1, arbitrary: across },
    { weight: 1, arbitrary: fc.string({ maxLength: 30 }) },
    { weight: 1, arbitrary: fc.constant(undefined) },
    { weight: 1, arbitrary: fc.constant('q'.repeat(501)) },
  );
}

function sha7Arb(): fc.Arbitrary<string> {
  return fc.oneof(
    { weight: 5, arbitrary: fc.constantFrom(...SHA_POOL) },
    { weight: 1, arbitrary: fc.constant('9999999') },
  );
}

type RawCitation = { sha7: string; quote?: string };
type RawClaim = {
  kind: 'memory' | 'speculation' | 'silence';
  text: string;
  citations: RawCitation[];
  silenceReason?: string;
};

function citationArb(ledger: readonly EvidenceItem[]): fc.Arbitrary<RawCitation> {
  return fc
    .tuple(sha7Arb(), quoteArb(ledger))
    .map(([sha7, quote]) => (quote === undefined ? { sha7 } : { sha7, quote }));
}

const textArb: fc.Arbitrary<string> = wordsArb(8).map((t) => (t.length === 0 ? 'x' : t));

function checkedClaimArb(ledger: readonly EvidenceItem[]): fc.Arbitrary<RawClaim> {
  return fc.record({
    kind: fc.constantFrom('memory' as const, 'speculation' as const),
    text: textArb,
    citations: fc.oneof(
      {
        weight: 8,
        arbitrary: fc.array(citationArb(ledger), { minLength: 1, maxLength: 3 }),
      },
      {
        weight: 1,
        arbitrary: fc.array(citationArb(ledger), { minLength: 11, maxLength: 12 }),
      },
    ),
  });
}

/** A citation of a ledger item quoting 8–40 characters from one of its fields, when one is long enough. */
function goodCitationArb(ledger: readonly EvidenceItem[]): fc.Arbitrary<RawCitation> {
  return fc
    .tuple(
      fc.constantFrom(...ledger),
      fc.constantFrom(...FIELDS),
      fc.nat(),
      fc.integer({ min: 8, max: 40 }),
    )
    .map(([it, f, s, n]) => {
      const t = fieldText(it, f);
      const start = t.length <= n ? 0 : s % (t.length - n);
      return { sha7: it.shortSha, quote: t.slice(start, start + n) };
    });
}

function wellFormedClaimArb(ledger: readonly EvidenceItem[]): fc.Arbitrary<RawClaim> {
  return fc.record({
    kind: fc.constantFrom('memory' as const, 'speculation' as const),
    text: fc
      .oneof({ weight: 3, arbitrary: wordsArb(4) }, { weight: 1, arbitrary: textArb })
      .map((t) => (t.length === 0 ? 'x' : t)),
    citations: fc.array(goodCitationArb(ledger), { minLength: 1, maxLength: 2 }),
  });
}

const silenceArb: fc.Arbitrary<RawClaim> = fc.record({
  kind: fc.constant('silence' as const),
  text: fc.oneof(textArb, fc.constant('s'.repeat(301))),
  citations: fc.constant([]),
  silenceReason: fc.oneof(textArb, fc.constant(''), fc.constant('r'.repeat(301))),
});

function claimArb(ledger: readonly EvidenceItem[]): fc.Arbitrary<RawClaim> {
  return fc.oneof(
    { weight: 3, arbitrary: checkedClaimArb(ledger) },
    { weight: 3, arbitrary: wellFormedClaimArb(ledger) },
    { weight: 1, arbitrary: silenceArb },
  );
}

const junkArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.constant(42),
  fc.record({ kind: fc.string({ maxLength: 40 }), text: fc.string() }),
  fc.record({
    kind: fc.constant('memory'),
    text: fc.integer(),
    citations: fc.constant([]),
  }),
);

const caseArb = ledgerArb.chain((ledger) =>
  fc
    .array(claimArb(ledger), { minLength: 1, maxLength: 8 })
    .map((claims) => ({ ledger, claims })),
);

const caseWithJunkArb = ledgerArb.chain((ledger) =>
  fc
    .array(
      fc.oneof(
        { weight: 5, arbitrary: claimArb(ledger) },
        { weight: 1, arbitrary: junkArb },
      ),
      {
        minLength: 0,
        maxLength: 10,
      },
    )
    .map((claims) => ({ ledger, claims: claims as unknown[] })),
);

// The old GhostAnswerSchema (d738258), kept here so CP4 only feeds the legacy verifier what it accepted.
const OldCitation = z.object({
  sha7: z
    .string()
    .length(7)
    .regex(/^[0-9a-f]{7}$/),
  quote: z.string().min(1).optional(),
});
const OldClaim = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('memory'),
    text: z.string().min(1),
    citations: z.array(OldCitation).min(1),
  }),
  z.object({
    kind: z.literal('speculation'),
    text: z.string().min(1),
    citations: z.array(OldCitation).min(1),
  }),
  z.object({
    kind: z.literal('silence'),
    text: z.string().min(1),
    citations: z.array(OldCitation).length(0),
    silenceReason: z.string().min(1),
  }),
]);
const OldGhostAnswer = z.object({
  claims: z.array(OldClaim).min(1),
  voice: z.string().min(1),
  sessionId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Generator sanity: the properties above are not vacuous
// ---------------------------------------------------------------------------

describe('generators reach every bucket and the year and author checks', () => {
  it('a sample of generated cases has verified, rejected and silent claims', () => {
    const cases = fc.sample(caseArb, {
      numRuns: 500,
      ...(SEED !== undefined ? { seed: SEED } : {}),
    });
    let verified = 0;
    let silent = 0;
    let withYear = 0;
    let withAuthor = 0;
    const reasons = new Set<string>();
    for (const { ledger, claims } of cases) {
      const r = verify(ledger, { claims });
      verified += r.verified.length;
      silent += r.silent.length;
      withYear += r.verified.filter((v) => yearsIn(v.claim.text).length > 0).length;
      const authors = [...new Set(ledger.map((i) => i.author))];
      withAuthor += r.verified.filter(
        (v) => namedAuthors(v.claim.text, authors).length > 0,
      ).length;
      for (const x of r.rejected) reasons.add(x.reason.split(' ').slice(0, 3).join(' '));
    }
    expect(verified).toBeGreaterThan(50);
    expect(silent).toBeGreaterThan(10);
    expect(withYear).toBeGreaterThan(0);
    expect(withAuthor).toBeGreaterThan(0);
    expect(reasons.size).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// CP1 — No quote, no verify
// ---------------------------------------------------------------------------

describe('CP1 — no quote, no verify (R1.3, R1.4, R9.4)', () => {
  test.prop([caseArb], fcParams)(
    'a claim with a missing, too-short or too-long quote is never verified',
    ({ ledger, claims }) => {
      const result = verify(ledger, { claims });
      const verifiedIdx = new Set(result.verified.map((v) => v.index));
      claims.forEach((c, i) => {
        const bad = c.citations.some(
          (x) =>
            x.quote === undefined || x.quote.trim().length < 8 || x.quote.length > 500,
        );
        if (bad) expect(verifiedIdx.has(i)).toBe(false);
      });
    },
  );

  test.prop(
    [ledgerArb, textArb, fc.constantFrom('memory' as const, 'speculation' as const)],
    fcParams,
  )(
    'arbitrary text citing a real commit with no quote is never verified',
    (ledger, text, kind) => {
      const sha7 = ledger[0]!.shortSha;
      const result = verify(ledger, { claims: [{ kind, text, citations: [{ sha7 }] }] });
      expect(result.verified).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
    },
  );
});

// ---------------------------------------------------------------------------
// CP2 — One field
// ---------------------------------------------------------------------------

describe('CP2 — one field (R1.5, R2.1, R9.4)', () => {
  test.prop([caseArb], fcParams)(
    'every verified quote is a substring of the named field of its cited item',
    ({ ledger, claims }) => {
      const result = verify(ledger, { claims });
      for (const v of result.verified) {
        const raw = claims[v.index]!;
        expect(v.quotes).toHaveLength(raw.citations.length);
        v.quotes.forEach((q, j) => {
          expect(q.sha7).toBe(raw.citations[j]!.sha7);
          expect(q.quote).toBe(raw.citations[j]!.quote);
          const items = itemsBySha(ledger, q.sha7);
          expect(items).toHaveLength(1);
          expect(fieldText(items[0]!, q.field).includes(q.quote)).toBe(true);
        });
      }
    },
  );

  test.prop(
    [
      ledgerArb.chain((ledger) =>
        fc
          .tuple(
            fc.constantFrom(...ledger),
            fc.integer({ min: 1, max: 30 }),
            fc.integer({ min: 1, max: 30 }),
          )
          .map(([item, a, b]) => ({
            ledger,
            item,
            quote: item.subject.slice(-a) + item.body.slice(0, b),
          })),
      ),
    ],
    fcParams,
  )(
    'a quote joined across subject and body that is in no single field is rejected',
    ({ ledger, item, quote }) => {
      fc.pre(FIELDS.every((f) => !fieldText(item, f).includes(quote)));
      const result = verify(ledger, {
        claims: [
          { kind: 'memory', text: 'x', citations: [{ sha7: item.shortSha, quote }] },
        ],
      });
      expect(result.verified).toHaveLength(0);
    },
  );

  test.prop([ledgerArb, fc.string({ minLength: 8, maxLength: 40 })], fcParams)(
    'a quote that appears only past HUNK_UI_CHARS is rejected',
    (ledger, tail) => {
      const item = {
        ...ledger[0]!,
        subject: '',
        body: '',
        hunk: 'h'.repeat(HUNK_UI_CHARS) + tail,
      };
      fc.pre(!item.hunk.slice(0, HUNK_UI_CHARS).includes(tail));
      const result = verify([item], {
        claims: [
          {
            kind: 'memory',
            text: 'x',
            citations: [{ sha7: item.shortSha, quote: tail }],
          },
        ],
      });
      expect(result.verified).toHaveLength(0);
    },
  );
});

// ---------------------------------------------------------------------------
// CP3 — Unique membership
// ---------------------------------------------------------------------------

describe('CP3 — unique membership (R1.7)', () => {
  test.prop([caseArb], fcParams)(
    "every verified citation's sha7 is the shortSha of exactly one ledger item",
    ({ ledger, claims }) => {
      const result = verify(ledger, { claims });
      for (const v of result.verified) {
        for (const c of claims[v.index]!.citations) {
          expect(itemsBySha(ledger, c.sha7)).toHaveLength(1);
        }
      }
    },
  );
});

// ---------------------------------------------------------------------------
// CP4 — Only stricter than the verifier at d738258
// ---------------------------------------------------------------------------

describe('CP4 — only stricter (R1.10)', () => {
  test.prop([caseArb], fcParams)(
    'no claim the legacy verifier rejects is verified by the new one',
    ({ ledger, claims }) => {
      const parsed = OldGhostAnswer.safeParse({ claims, voice: 'v', sessionId: 's' });
      fc.pre(parsed.success);
      if (!parsed.success) return;
      const old = legacyVerify(ledger, parsed.data);
      const oldRejected = new Set(
        old.rejected.map((r) => parsed.data.claims.indexOf(r.claim)),
      );
      const result = verify(ledger, parsed.data);
      for (const v of result.verified) {
        expect(oldRejected.has(v.index)).toBe(false);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// CP5 — Year
// ---------------------------------------------------------------------------

describe('CP5 — year (R3.1)', () => {
  test.prop([caseArb], fcParams)(
    'every year in a verified claim is a cited item’s year or appears in its fields',
    ({ ledger, claims }) => {
      const result = verify(ledger, { claims });
      for (const v of result.verified) {
        const cited = claims[v.index]!.citations.flatMap((c) =>
          itemsBySha(ledger, c.sha7),
        );
        for (const y of yearsIn(v.claim.text)) {
          const ok = cited.some(
            (it) =>
              it.date.slice(0, 4) === y ||
              FIELDS.some((f) => yearsIn(fieldText(it, f)).includes(y)),
          );
          expect(ok).toBe(true);
        }
      }
    },
  );

  test.prop([caseArb, fc.integer({ min: 1970, max: 2099 })], fcParams)(
    'inserting an unsupported year into a verified claim makes it rejected',
    ({ ledger, claims }, year) => {
      const result = verify(ledger, { claims });
      const y = String(year);
      for (const v of result.verified) {
        const raw = claims[v.index]!;
        const cited = raw.citations.flatMap((c) => itemsBySha(ledger, c.sha7));
        const supported = cited.some(
          (it) =>
            it.date.slice(0, 4) === y ||
            FIELDS.some((f) => yearsIn(fieldText(it, f)).includes(y)),
        );
        if (supported) continue;
        const again = verify(ledger, {
          claims: [{ ...raw, text: `${raw.text} in ${y}.` }],
        });
        expect(again.verified).toHaveLength(0);
        expect(again.rejected[0]?.reason).toContain(`the year ${y}`);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// CP6 — Author
// ---------------------------------------------------------------------------

describe('CP6 — author (R3.2)', () => {
  test.prop([caseArb], fcParams)(
    'every ledger author named in a verified claim wrote a cited item or is named in one',
    ({ ledger, claims }) => {
      const authors = [...new Set(ledger.map((i) => i.author))];
      const result = verify(ledger, { claims });
      for (const v of result.verified) {
        const cited = claims[v.index]!.citations.flatMap((c) =>
          itemsBySha(ledger, c.sha7),
        );
        for (const a of namedAuthors(v.claim.text, authors)) {
          const ok = cited.some(
            (it) =>
              it.author === a ||
              FIELDS.some((f) => wholeWordAt(fieldText(it, f), a).length > 0),
          );
          expect(ok, `author ${a} in "${v.claim.text}"`).toBe(true);
        }
      }
    },
  );
});

// ---------------------------------------------------------------------------
// CP7 — Partition
// ---------------------------------------------------------------------------

describe('CP7 — partition (R1.8, R4.1)', () => {
  test.prop([caseWithJunkArb], fcParams)(
    'verified, rejected and silent hold each input index exactly once, in ascending order',
    ({ ledger, claims }) => {
      const result = verify(ledger, { claims });
      const all = indexesOf(result).sort((a, b) => a - b);
      expect(all).toEqual(claims.map((_, i) => i));
      for (const arr of [result.verified, result.rejected, result.silent]) {
        const idx = arr.map((x) => x.index);
        expect(idx).toEqual([...idx].sort((a, b) => a - b));
      }
      for (const v of result.verified) {
        expect(v.claim.kind).not.toBe('silence');
      }
    },
  );
});

// ---------------------------------------------------------------------------
// CP8 — Score
// ---------------------------------------------------------------------------

describe('CP8 — score (R4.4)', () => {
  test.prop([caseWithJunkArb], fcParams)(
    'score is verified / (verified + rejected + silent), 1 when empty, and in [0, 1]',
    ({ ledger, claims }) => {
      const r = verify(ledger, { claims });
      const total = r.verified.length + r.rejected.length + r.silent.length;
      expect(r.score).toBe(total === 0 ? 1 : r.verified.length / total);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    },
  );
});

// ---------------------------------------------------------------------------
// CP9 — Pure (verifier half)
// ---------------------------------------------------------------------------

describe('CP9 — pure (N2)', () => {
  test.prop([caseWithJunkArb], fcParams)(
    'two calls give deep-equal results and the input is unchanged',
    ({ ledger, claims }) => {
      const ledgerBefore = structuredClone(ledger);
      const claimsBefore = structuredClone(claims);
      const r1 = verify(ledger, { claims });
      const r2 = verify(ledger, { claims });
      expect(r1).toEqual(r2);
      expect(ledger).toEqual(ledgerBefore);
      expect(claims).toEqual(claimsBefore);
    },
  );
});
