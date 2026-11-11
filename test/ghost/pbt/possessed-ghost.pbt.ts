/**
 * first-seance CP12 — the possessed ghost's lookup (design.md §11, R13.1, R13.2), with fast-check
 * (1,000 runs; FAST_CHECK_SEED honoured). Ledgers are generated like the ward-hardening item
 * generators, with any of the seven possessed subjects written into zero, one or two items.
 */
import { describe, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import type { EvidenceItem } from '../../../src/ghost/schema.js';
import {
  POSSESSED_SUBJECTS,
  possessedAnswer,
} from '../../../src/ghost/possessed-ghost.js';
import type { PossessedCommit } from '../../../src/ghost/possessed-ghost.js';

const SEED = process.env['FAST_CHECK_SEED']
  ? parseInt(process.env['FAST_CHECK_SEED'], 10)
  : undefined;
const params: fc.Parameters<unknown> = {
  numRuns: 1_000,
  ...(SEED !== undefined ? { seed: SEED } : {}),
};

const IDS = Object.keys(POSSESSED_SUBJECTS) as PossessedCommit[];

const textArb = fc.oneof(
  fc.string({ maxLength: 30 }),
  fc.fullUnicodeString({ maxLength: 20 }),
  fc.constantFrom(...Object.values(POSSESSED_SUBJECTS).map((s) => `${s} `)),
);

const itemArb = (subject: fc.Arbitrary<string>): fc.Arbitrary<EvidenceItem> =>
  fc
    .record({
      sha: fc.hexaString({ minLength: 40, maxLength: 40 }).map((s) => s.toLowerCase()),
      author: textArb,
      date: fc
        .date({ min: new Date('1990-01-01'), max: new Date('2030-01-01') })
        .map((d) => d.toISOString()),
      subject,
      body: textArb,
      hunk: textArb,
      suspiciousMessage: fc.boolean(),
    })
    .map((r) => ({
      id: 'E1',
      sha: r.sha,
      shortSha: r.sha.slice(0, 7),
      author: r.author,
      email: 'x@example.com',
      date: r.date,
      subject: r.subject,
      body: r.body,
      hunk: r.hunk,
      files: ['auth/throttle.js'],
      refs: [],
      suspiciousMessage: r.suspiciousMessage,
    }));

/** Other items, plus each possessed subject written 0, 1 or 2 times (mostly once). */
const ledgerArb: fc.Arbitrary<EvidenceItem[]> = fc
  .tuple(
    fc.array(itemArb(textArb), { maxLength: 5 }),
    fc.array(
      fc.oneof(
        { weight: 6, arbitrary: fc.constant(1) },
        { weight: 1, arbitrary: fc.constantFrom(0, 2) },
      ),
      {
        minLength: 7,
        maxLength: 7,
      },
    ),
    fc.array(itemArb(fc.constant('')), { minLength: 14, maxLength: 14 }),
    fc.integer({ min: 0, max: 1_000 }),
  )
  .map(([others, counts, slots, rot]) => {
    const possessed: EvidenceItem[] = [];
    let k = 0;
    counts.forEach((n, j) => {
      for (let t = 0; t < n; t++)
        possessed.push({ ...slots[k++]!, subject: POSSESSED_SUBJECTS[IDS[j]!] });
    });
    const all = [...others, ...possessed];
    const r = all.length ? rot % all.length : 0;
    return [...all.slice(r), ...all.slice(0, r)].map((it, i) => ({
      ...it,
      id: `E${i + 1}`,
    }));
  });

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    for (const v of Object.values(x)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
}

const ATTACK_COMMIT: Array<PossessedCommit | null> = ['P3', 'P2', 'P4', null, 'P1'];

describe('CP12 — the possessed ghost answers exactly when each subject is found once', () => {
  test.prop([ledgerArb], params)(
    'non-null iff every subject is the subject of exactly one item',
    (items) => {
      const ledger = deepFreeze({ items });
      const before = JSON.stringify(ledger);
      const once = IDS.every(
        (id) => items.filter((i) => i.subject === POSSESSED_SUBJECTS[id]).length === 1,
      );
      const a = possessedAnswer(ledger);
      expect(a !== null).toBe(once);
      expect(JSON.stringify(ledger)).toBe(before);
      if (a === null) return;

      const claims = a.claims as Array<{
        kind: string;
        citations: Array<Record<string, unknown>>;
      }>;
      expect(claims.map((c) => c.kind)).toEqual([
        'memory',
        'memory',
        'memory',
        'silence',
        'memory',
      ]);
      claims.forEach((c, k) => {
        const commit = ATTACK_COMMIT[k];
        if (commit === null || commit === undefined) {
          expect(c.citations).toEqual([]);
          return;
        }
        const item = items.find((i) => i.subject === POSSESSED_SUBJECTS[commit])!;
        expect(c.citations.map((x) => x['sha7'])).toEqual([item.shortSha]);
      });
      expect('quote' in claims[0]!.citations[0]!).toBe(false);
      expect('quote' in claims[1]!.citations[0]!).toBe(false);
      expect(possessedAnswer(ledger)).toEqual(a);
      expect(a.voice).toBe('scripted');
    },
  );
});
