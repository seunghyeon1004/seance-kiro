/**
 * haunting-map T3 — HM11, the whole-file line count (design.md §10, R6.4).
 *
 * countLines follows the sliceSourceLines rule: "" has no line, and a final "\n" adds none.
 * The whole-file range is [1, min(n, 500)].
 */
import { describe, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  countLines,
  sliceSourceLines,
  WHOLE_FILE_MAX_LINES,
} from '../../../src/evidence/git.js';
import { wholeFileRange } from '../../../src/evidence/ledger.js';

const SEED = process.env['FAST_CHECK_SEED']
  ? parseInt(process.env['FAST_CHECK_SEED'], 10)
  : undefined;
const fcParams: fc.Parameters<unknown> = {
  numRuns: 1000,
  ...(SEED !== undefined ? { seed: SEED } : {}),
};

const textArb = fc.oneof(
  fc
    .tuple(
      fc.array(fc.oneof(fc.string({ maxLength: 20 }), fc.constant('')), {
        maxLength: 90,
      }),
      fc.constantFrom('\n', '\r\n'),
      fc.boolean(),
    )
    .map(([lines, eol, finalEol]) => lines.join(eol) + (finalEol ? eol : '')),
  fc.fullUnicodeString({ maxLength: 200 }),
);

describe('HM11 — lines (R6.4)', () => {
  test.prop([textArb], fcParams)('countLines agrees with sliceSourceLines', (text) => {
    expect(sliceSourceLines(text, 1, 40).length).toBe(Math.min(countLines(text), 40));
    expect(countLines(text) === 0).toBe(text === '');
  });

  test.prop([fc.integer({ min: 1, max: 100_000 })], fcParams)(
    'the whole-file range is [1, min(n, 500)]',
    (n) => {
      const r = wholeFileRange(n);
      expect(r.startLine).toBe(1);
      expect(r.endLine).toBe(Math.min(n, WHOLE_FILE_MAX_LINES));
      expect(r.endLine).toBeGreaterThanOrEqual(r.startLine);
      expect(r.endLine).toBeLessThanOrEqual(500);
    },
  );
});
