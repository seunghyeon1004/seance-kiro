/**
 * first-seance T3 — CP9 (eligibility) and CP10 (key) for recorded answers (R7.1, R7.8, N6).
 *
 * fast-check: 1,000 runs per property; FAST_CHECK_SEED honoured.
 */

import { describe, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  OTHER_QUESTIONS,
  SAMPLE_QUESTIONS,
  SAMPLE_RANGES,
  recordingKey,
  recordingTargetFor,
} from '../../../src/ghost/recordings.js';
import type { RecordingTarget, SampleName } from '../../../src/ghost/recordings.js';

const SEED = process.env['FAST_CHECK_SEED']
  ? parseInt(process.env['FAST_CHECK_SEED'], 10)
  : undefined;
const fcParams: fc.Parameters<unknown> = {
  numRuns: 1000,
  ...(SEED !== undefined ? { seed: SEED } : {}),
};

const SAMPLES: readonly SampleName[] = ['crypt', 'possessed'];
const ALL_CHIPS = [...SAMPLE_QUESTIONS.crypt, ...SAMPLE_QUESTIONS.possessed];

const sampleArb = fc.option(fc.constantFrom(...SAMPLES), { nil: undefined });
const fileArb = fc.option(
  fc.oneof(
    fc.constantFrom(
      SAMPLE_RANGES.crypt.file,
      SAMPLE_RANGES.possessed.file,
      'legacy/invoice.js',
      'legacy/tax.js ',
    ),
    fc.string({ maxLength: 20 }),
  ),
  { nil: undefined },
);
const lineArb = fc.option(fc.integer({ min: -1, max: 9 }), { nil: undefined });
const questionArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...ALL_CHIPS, ...OTHER_QUESTIONS) },
  {
    weight: 1,
    arbitrary: fc.constantFrom(...ALL_CHIPS).map((q) => q.toUpperCase()),
  },
  { weight: 1, arbitrary: fc.constantFrom(...ALL_CHIPS).map((q) => q + ' ') },
  { weight: 1, arbitrary: fc.fullUnicodeString({ maxLength: 40 }) },
  { weight: 1, arbitrary: fc.constantFrom(undefined, null, 7, ['x'], {}) },
);

/** Mostly near the defaults, so both outcomes are common. */
const entryArb = fc.oneof(
  fc.record(
    { sample: sampleArb, file: fileArb, startLine: lineArb, endLine: lineArb },
    { requiredKeys: [] },
  ),
  fc
    .tuple(fc.constantFrom(...SAMPLES), fc.constantFrom(...SAMPLES))
    .map(([sample, rangeOf]) => ({ sample, ...SAMPLE_RANGES[rangeOf] })),
);

describe('CP9 — eligibility (R7.8)', () => {
  test.prop(
    [entryArb, fc.constantFrom('ask' as const, 'exorcise' as const), questionArb],
    fcParams,
  )(
    'a target only for a sample session with its default range and (for ask) its chip question',
    (entry, kind, question) => {
      const t = recordingTargetFor(entry, kind, question);
      const s = entry.sample;
      const d = s === undefined ? undefined : SAMPLE_RANGES[s];
      const eligible =
        s !== undefined &&
        d !== undefined &&
        entry.file === d.file &&
        entry.startLine === d.startLine &&
        entry.endLine === d.endLine &&
        (kind === 'exorcise' ||
          (typeof question === 'string' && SAMPLE_QUESTIONS[s].includes(question)));
      expect(t !== null).toBe(eligible);
      if (t !== null && s !== undefined && d !== undefined) {
        expect(t).toEqual({
          kind,
          sample: s,
          file: d.file,
          startLine: d.startLine,
          endLine: d.endLine,
          question: kind === 'ask' ? question : '',
        });
      }
    },
  );
});

const targetArb: fc.Arbitrary<RecordingTarget> = fc.record({
  kind: fc.constantFrom('ask' as const, 'exorcise' as const),
  sample: fc.constantFrom(...SAMPLES),
  file: fc.oneof(
    fc.constantFrom('legacy/tax.js', 'auth/throttle.js'),
    fc.string({ maxLength: 12 }),
  ),
  startLine: fc.integer({ min: 1, max: 50 }),
  endLine: fc.integer({ min: 1, max: 50 }),
  question: fc.oneof(
    fc.constantFrom('', '","', '\\', ...ALL_CHIPS),
    fc.fullUnicodeString({ maxLength: 16 }),
  ),
});

const fields = (t: RecordingTarget): string =>
  JSON.stringify([t.kind, t.sample, t.file, t.startLine, t.endLine, t.question]);

describe('CP10 — key (R7.1)', () => {
  test.prop([targetArb], fcParams)(
    'deterministic, 16 lowercase hex characters, and independent of extra keys',
    (t) => {
      const k = recordingKey(t);
      expect(k).toMatch(/^[0-9a-f]{16}$/);
      expect(recordingKey({ ...t })).toBe(k);
      const withExtra = { ...t, extra: 'ignored' } as RecordingTarget;
      expect(recordingKey(withExtra)).toBe(k);
    },
  );

  test.prop(
    [fc.uniqueArray(targetArb, { minLength: 500, maxLength: 500, selector: fields })],
    fcParams,
  )('differs for any two distinct targets in a set of 500', (targets) => {
    const keys = new Set(targets.map(recordingKey));
    expect(keys.size).toBe(targets.length);
  });
});
