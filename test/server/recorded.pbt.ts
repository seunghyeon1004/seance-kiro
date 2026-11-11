/**
 * first-seance T3 — CP8, recordings are re-checked (R7.6, N6).
 *
 * For any ledger and any recorded claims, recordedAnswer(…) minus `recorded` deep-equals the
 * live builder toAnswerResponse(ledger, verify(ledger.items, answer), …), and every claim it
 * shows as verified passes an independent oracle of the ward's two citation invariants.
 *
 * The generators follow the ward-hardening CP generators (test/ghost/pbt/verifier.hardening.pbt.ts),
 * copied in small form because that file's arbitraries are not exported.
 * fast-check: 1,000 runs; FAST_CHECK_SEED honoured.
 */

import { describe, expect, vi, beforeAll, afterAll } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { __test } from '../../src/server.js';
import { verify } from '../../src/ghost/verifier.js';
import { renderWardReport } from '../../src/ghost/report.js';
import { HUNK_UI_CHARS } from '../../src/ghost/schema.js';
import type { EvidenceItem, LedgerResult } from '../../src/ghost/schema.js';
import type { AskRecording } from '../../src/ghost/recordings.js';
import { MODEL_ID } from '../../src/ghost/llm.js';

const SEED = process.env['FAST_CHECK_SEED']
  ? parseInt(process.env['FAST_CHECK_SEED'], 10)
  : undefined;
const fcParams: fc.Parameters<unknown> = {
  numRuns: 1000,
  ...(SEED !== undefined ? { seed: SEED } : {}),
};

let info: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterAll(() => {
  info.mockRestore();
});

type Field = 'subject' | 'body' | 'hunk';
const FIELDS: readonly Field[] = ['subject', 'body', 'hunk'];
const fieldText = (i: EvidenceItem, f: Field): string =>
  f === 'hunk' ? i.hunk.slice(0, HUNK_UI_CHARS) : i[f];

const SHA_POOL = ['abc1234', 'def5678', '0123abc', 'fedcba9'] as const;
const AUTHORS = ['Ada Lovelace', 'Grace Hopper', 'Ann'] as const;
const WORDS = [
  'wait',
  'for',
  'the',
  'vendor',
  'returns',
  '429',
  '2019',
  '2021',
  'Ada Lovelace',
  'Ann',
  'sleep(3000);',
  '\n',
] as const;

const wordsArb = (max: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...WORDS), { maxLength: max }).map((a) => a.join(' '));
const fieldArb = fc.oneof(
  { weight: 4, arbitrary: wordsArb(12) },
  { weight: 1, arbitrary: fc.string({ maxLength: 40 }) },
);

const itemArb: fc.Arbitrary<EvidenceItem> = fc
  .record({
    shortSha: fc.constantFrom(...SHA_POOL),
    author: fc.constantFrom(...AUTHORS),
    year: fc.integer({ min: 2015, max: 2024 }),
    subject: fieldArb,
    body: fieldArb,
    hunk: fieldArb,
    suspiciousMessage: fc.boolean(),
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
    suspiciousMessage: r.suspiciousMessage,
  }));

const ledgerArb = fc
  .array(itemArb, { minLength: 1, maxLength: 5 })
  .map((items) => items.map((it, i) => ({ ...it, id: `E${i + 1}` })));

function quoteArb(ledger: readonly EvidenceItem[]): fc.Arbitrary<string | undefined> {
  const slice = fc
    .tuple(
      fc.constantFrom(...ledger),
      fc.constantFrom(...FIELDS),
      fc.nat(),
      fc.integer({ min: 0, max: 40 }),
    )
    .map(([it, f, s, n]) => {
      const t = fieldText(it, f);
      const start = t.length === 0 ? 0 : s % t.length;
      return t.slice(start, start + n);
    });
  return fc.oneof(
    { weight: 6, arbitrary: slice },
    { weight: 1, arbitrary: fc.string({ maxLength: 30 }) },
    { weight: 1, arbitrary: fc.constant(undefined) },
  );
}

function claimArb(ledger: readonly EvidenceItem[]): fc.Arbitrary<unknown> {
  const citation = fc
    .tuple(
      fc.oneof(
        { weight: 5, arbitrary: fc.constantFrom(...SHA_POOL) },
        { weight: 1, arbitrary: fc.constant('9999999') },
      ),
      quoteArb(ledger),
    )
    .map(([sha7, quote]) => (quote === undefined ? { sha7 } : { sha7, quote }));
  const checked = fc.record({
    kind: fc.constantFrom('memory', 'speculation'),
    text: wordsArb(6).map((t) => (t === '' ? 'x' : t)),
    citations: fc.array(citation, { minLength: 1, maxLength: 3 }),
  });
  const silence = fc.record({
    kind: fc.constant('silence'),
    text: wordsArb(6).map((t) => (t === '' ? 'x' : t)),
    citations: fc.constant([]),
    silenceReason: fc.oneof(fc.constant('Who chose it?'), fc.constant('')),
  });
  const junk = fc.oneof(fc.constant(null), fc.constant(42), fc.constant({ kind: 'x' }));
  return fc.oneof(
    { weight: 6, arbitrary: checked },
    { weight: 2, arbitrary: silence },
    { weight: 1, arbitrary: junk },
  );
}

const caseArb = ledgerArb.chain((items) =>
  fc.record({
    items: fc.constant(items),
    claims: fc.array(claimArb(items), { minLength: 1, maxLength: 6 }),
    ranged: fc.boolean(),
  }),
);

describe('CP8 — recordings are re-checked by the live ward (R7.6)', () => {
  test.prop([caseArb], fcParams)(
    'recordedAnswer equals the live builder over verify(), plus recorded: true',
    ({ items, claims, ranged }) => {
      const ledger: LedgerResult = {
        items: items.map((i) => Object.freeze(i)),
        truncated: false,
        buildDurationMs: 0,
      };
      const entry = {
        ledger,
        expiresAt: 0,
        sample: 'crypt' as const,
        ...(ranged ? { file: 'legacy/tax.js', startLine: 7, endLine: 7 } : {}),
      };
      const answer = { claims, voice: 'recorded voice', sessionId: 'recording' };
      const rec: AskRecording = {
        kind: 'ask',
        sample: 'crypt',
        file: 'legacy/tax.js',
        startLine: 7,
        endLine: 7,
        question: 'Why is there a three second wait here?',
        model: MODEL_ID,
        recordedAt: '2026-11-11T12:00:00.000Z',
        ledgerShas: items.map((i) => i.shortSha),
        answer,
      };
      const sid = 'live-session';

      const { recorded, ...rest } = __test.recordedAnswer(
        entry,
        sid,
        rec,
        'model-failure',
      );
      expect(recorded).toBe(true);

      const result = verify(ledger.items, answer);
      const live = __test.toAnswerResponse(
        ledger,
        result,
        answer.voice,
        renderWardReport(result, __test.reportMeta(entry)),
        sid,
      );
      expect(rest).toEqual(live);
      expect(rest.tally).toEqual({
        verified: result.verified.length,
        checked: result.verified.length + result.rejected.length,
        silent: result.silent.length,
      });

      // Independent oracle: each verified citation names exactly one item and quotes one field of it
      for (const v of rest.verified) {
        for (const c of v.citations) {
          const cited = ledger.items.filter((i) => i.shortSha === c.sha7);
          expect(cited).toHaveLength(1);
          const item = cited[0]!;
          expect(FIELDS.some((f) => fieldText(item, f).includes(c.quote))).toBe(true);
        }
      }
      // A silence claim is never verified
      for (const v of rest.verified) {
        expect(['memory', 'speculation']).toContain(v.kind);
      }
    },
  );
});
