/**
 * first-seance T2 — CP6, the selected source lines (R2.1, N6).
 *
 * For any text and any 1 <= start <= end, sliceSourceLines returns at most 40 entries; the
 * `n` values are consecutive and start at `start`; every n <= end; every text has at most
 * 400 characters and is a prefix of the matching line of the input.
 */

import { describe, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { sliceSourceLines } from '../../../src/evidence/git.js';

const SEED = process.env['FAST_CHECK_SEED']
  ? parseInt(process.env['FAST_CHECK_SEED'], 10)
  : undefined;
const fcParams: fc.Parameters<unknown> = {
  numRuns: 1000,
  ...(SEED !== undefined ? { seed: SEED } : {}),
};

/** Lines of mixed length, joined with \n or \r\n, with or without a final newline. */
const lineArb = fc.oneof(
  fc.string({ maxLength: 30 }),
  fc.fullUnicodeString({ maxLength: 20 }),
  fc.string({ minLength: 390, maxLength: 900 }),
  fc.constant(''),
);
const textArb = fc.oneof(
  fc
    .tuple(
      fc.array(lineArb, { maxLength: 90 }),
      fc.constantFrom('\n', '\r\n'),
      fc.boolean(),
    )
    .map(([lines, eol, finalEol]) => lines.join(eol) + (finalEol ? eol : '')),
  fc.fullUnicodeString({ maxLength: 200 }),
);
const rangeArb = fc
  .tuple(fc.integer({ min: 1, max: 120 }), fc.integer({ min: 0, max: 120 }))
  .map(([start, len]) => ({ start, end: start + len }));

/** The input's lines, as the property reads them: split on \n, no extra line after a final \n. */
function inputLines(text: string): string[] {
  if (text === '') return [];
  const parts = text.split('\n');
  if (text.endsWith('\n')) parts.pop();
  return parts;
}

describe('CP6 — source lines (R2.1)', () => {
  test.prop([textArb, rangeArb], fcParams)(
    'bounded, consecutive from start, within the range, prefixes of the input lines',
    (text, { start, end }) => {
      const out = sliceSourceLines(text, start, end);
      const lines = inputLines(text);
      expect(out.length).toBeLessThanOrEqual(40);
      out.forEach((l, i) => {
        expect(l.n).toBe(start + i);
        expect(l.n).toBeLessThanOrEqual(end);
        expect(l.text.length).toBeLessThanOrEqual(400);
        const src = lines[l.n - 1];
        expect(src).toBeDefined();
        expect((src ?? '').startsWith(l.text)).toBe(true);
      });
      const expected = Math.max(0, Math.min(end, start + 39, lines.length) - start + 1);
      expect(out).toHaveLength(expected);
    },
  );

  test.prop([textArb, rangeArb], fcParams)('pure: same input, same output', (t, r) => {
    expect(sliceSourceLines(t, r.start, r.end)).toEqual(
      sliceSourceLines(t, r.start, r.end),
    );
  });

  test.prop(
    [fc.array(fc.string({ maxLength: 20 }), { minLength: 1, maxLength: 50 })],
    fcParams,
  )('a trailing \\r is removed from each line', (lines) => {
    const clean = lines.map((l) => l.replaceAll('\r', '').replaceAll('\n', ''));
    const out = sliceSourceLines(clean.map((l) => `${l}\r\n`).join(''), 1, clean.length);
    expect(out.map((l) => l.text)).toEqual(
      clean.slice(0, 40).map((l) => l.slice(0, 400)),
    );
  });
});
