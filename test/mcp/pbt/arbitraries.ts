/**
 * seance-mcp T2 — generators for the MCP property tests (design.md §8).
 *
 * Ledgers of 0 to 8 items whose short hashes come from a pool of 5 (so some are shared),
 * fields of up to 6,000 characters from a small alphabet with digits, spaces, newlines and
 * years, authors from a pool whose names may appear in the text, and random suspicious flags.
 * Claims: 0 to 12 per call, valid and invalid ones mixed.
 */

import * as fc from 'fast-check';
import type { EvidenceItem } from '../../../src/ghost/schema.js';

export const SEED = process.env['FAST_CHECK_SEED']
  ? parseInt(process.env['FAST_CHECK_SEED'], 10)
  : undefined;

export const fcParams: fc.Parameters<unknown> = {
  numRuns: 200,
  ...(SEED !== undefined ? { seed: SEED } : {}),
};

export const SHA_POOL = ['e9a5c9c', '6a959a9', 'c2685ed', '0123abc', 'fedcba9'] as const;
export const ABSENT_SHA = 'aaaaaaa';
export const AUTHORS = [
  'Dmitri Volkov',
  'Tom Haskell',
  'Priya Ramanathan',
  'Wren',
] as const;

/** Small alphabet, so substrings repeat across fields and items. */
const CHUNKS = [
  'a',
  'b',
  'c',
  ' ',
  '\n',
  '0',
  '7',
  '2019',
  '2020',
  '1999',
  'vendor ',
  '429 ',
  'Dmitri Volkov',
  'Wren',
  'TODO ',
];

/** Text of up to about `max` characters drawn from CHUNKS. */
export const textArb = (max: number): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(...CHUNKS), { maxLength: Math.ceil(max / 4) })
    .map((cs) => cs.join('').slice(0, max));

const longTextArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: textArb(400) },
  { weight: 1, arbitrary: textArb(6000) },
);

const dateArb: fc.Arbitrary<string> = fc
  .integer({ min: Date.UTC(1990, 0, 1), max: Date.UTC(2030, 0, 1) })
  .map((ms) => new Date(ms).toISOString());

export const itemArb = (n: number): fc.Arbitrary<EvidenceItem> =>
  fc
    .record({
      shortSha: fc.constantFrom(...SHA_POOL),
      tail: fc.hexaString({ minLength: 33, maxLength: 33 }),
      author: fc.constantFrom(...AUTHORS),
      date: dateArb,
      subject: textArb(200),
      body: longTextArb,
      hunk: longTextArb,
      suspiciousMessage: fc.boolean(),
    })
    .map((r) => ({
      id: `E${n + 1}`,
      sha: `${r.shortSha}${r.tail.toLowerCase()}`,
      shortSha: r.shortSha,
      author: r.author,
      email: 'someone@example.com',
      date: r.date,
      subject: r.subject,
      body: r.body,
      hunk: r.hunk,
      files: ['legacy/tax.js'],
      refs: [],
      suspiciousMessage: r.suspiciousMessage,
    }));

export const ledgerArb: fc.Arbitrary<EvidenceItem[]> = fc
  .integer({ min: 0, max: 8 })
  .chain((len) => fc.tuple(...Array.from({ length: len }, (_, i) => itemArb(i))))
  .map((items) => [...items]);

export interface CitationIn {
  sha7: string;
  quote?: string;
}
export interface ClaimIn {
  kind: 'memory' | 'speculation' | 'silence';
  text: string;
  citations: CitationIn[];
  silenceReason?: string;
}

const FIELDS = ['subject', 'body', 'hunk'] as const;

/** A quote cut from one field of an item, across two fields, or past 4,000 hunk characters. */
function quoteArb(items: readonly EvidenceItem[]): fc.Arbitrary<CitationIn> {
  if (items.length === 0) {
    return fc.record({ sha7: fc.constantFrom(...SHA_POOL), quote: textArb(40) });
  }
  return fc
    .record({
      i: fc.nat({ max: items.length - 1 }),
      field: fc.constantFrom(...FIELDS),
      mode: fc.constantFrom('one', 'one', 'one', 'across', 'pastHunk'),
      start: fc.nat({ max: 6000 }),
      len: fc.integer({ min: 0, max: 520 }),
    })
    .map(({ i, field, mode, start, len }) => {
      const item = items[i] as EvidenceItem;
      let source: string;
      if (mode === 'across') source = `${item.subject}${item.body}`;
      else if (mode === 'pastHunk') source = item.hunk.slice(3990);
      else source = field === 'hunk' ? item.hunk.slice(0, 4000) : item[field];
      const s = source.length === 0 ? 0 : start % source.length;
      return { sha7: item.shortSha, quote: source.slice(s, s + len) };
    });
}

const claimTextArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant('The record says so.'),
  textArb(120).filter((t) => t.length > 0),
  fc.constantFrom(
    'Dmitri Volkov added the delay in 2020.',
    'Wren wrote it in 1999.',
    'Tom Haskell renamed the variables.',
  ),
);

/** Valid-looking and invalid claims for a given ledger. */
export function claimArb(items: readonly EvidenceItem[]): fc.Arbitrary<ClaimIn> {
  const cite = quoteArb(items);
  const checked = fc.record({
    kind: fc.constantFrom('memory' as const, 'speculation' as const),
    text: claimTextArb,
    citations: fc.array(cite, { minLength: 1, maxLength: 3 }),
  });
  const silence = fc.record({
    kind: fc.constant('silence' as const),
    text: fc.constant('The record is silent on why.'),
    citations: fc.constant([]),
    silenceReason: fc.constant('Why was it written?'),
  });
  const noQuote = cite.map((c) => ({
    kind: 'memory' as const,
    text: 'The record says so.',
    citations: [{ sha7: c.sha7 }],
  }));
  const shortQuote = cite.map((c) => ({
    kind: 'memory' as const,
    text: 'The record says so.',
    citations: [{ sha7: c.sha7, quote: (c.quote ?? '').slice(0, 5) }],
  }));
  const unknownSha = cite.map((c) => ({
    kind: 'memory' as const,
    text: 'The record says so.',
    citations: [{ sha7: ABSENT_SHA, quote: c.quote ?? 'twelve chars' }],
  }));
  const tooMany = cite.map((c) => ({
    kind: 'memory' as const,
    text: 'The record says so.',
    citations: Array.from({ length: 11 }, () => c),
  }));
  const silenceWithCitations = cite.map((c) => ({
    kind: 'silence' as const,
    text: 'The record is silent.',
    citations: [c],
    silenceReason: 'Why?',
  }));
  return fc.oneof(
    { weight: 6, arbitrary: checked },
    { weight: 2, arbitrary: silence },
    { weight: 1, arbitrary: noQuote },
    { weight: 1, arbitrary: shortQuote },
    { weight: 1, arbitrary: unknownSha },
    { weight: 1, arbitrary: tooMany },
    { weight: 1, arbitrary: silenceWithCitations },
  );
}

export const ledgerAndClaimsArb: fc.Arbitrary<{
  items: EvidenceItem[];
  claims: ClaimIn[];
}> = ledgerArb.chain((items) =>
  fc
    .array(claimArb(items), { minLength: 0, maxLength: 12 })
    .map((claims) => ({ items, claims })),
);

/** A random absolute path, as an error message might carry it. */
export const absPathArb: fc.Arbitrary<string> = fc
  .array(fc.stringMatching(/^[a-z0-9_-]{1,12}$/), { minLength: 2, maxLength: 5 })
  .map((parts) => `/Users/${parts.join('/')}`);

/** `scheme://…` and `user@host:path` forms. */
export const remoteArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(
      fc.stringMatching(/^[A-Za-z][A-Za-z0-9+.-]{0,8}$/),
      fc.string({ maxLength: 30 }),
    )
    .map(([scheme, rest]) => `${scheme}://${rest}`),
  fc
    .tuple(
      fc.stringMatching(/^[A-Za-z0-9_.-]{1,10}$/),
      fc.stringMatching(/^[A-Za-z0-9_.-]{1,12}$/),
      fc.string({ maxLength: 30 }),
    )
    .map(([user, host, p]) => `${user}@${host}:${p}`),
);

/** A file argument containing `..` or starting with `/`. */
export const badFileArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(fc.string({ maxLength: 20 }), fc.string({ maxLength: 20 }))
    .map(([a, b]) => `${a}..${b}`),
  fc.string({ maxLength: 30 }).map((s) => `/${s}`),
);
