/**
 * T3 — Property-based tests for computeScore (PS1–PS6).
 *
 * fast-check: 1 000 runs per property; fixed seed via FAST_CHECK_SEED env var.
 */

import { describe, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { computeScore } from '../../../src/exorcism/score.js';
import { verifyPlanClaims } from '../../../src/exorcism/plan.js';
import type {
  EvidenceItem,
  LedgerResult,
  RefactorPlan,
  ScoreInput,
  VerifiedRefactorPlan,
} from '../../../src/ghost/schema.js';

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
// Arbitraries
// ---------------------------------------------------------------------------

const sha40Arb: fc.Arbitrary<string> = fc
  .hexaString({ minLength: 40, maxLength: 40 })
  .map((s) => s.toLowerCase());

const iso8601Arb: fc.Arbitrary<string> = fc
  .date({
    min: new Date('2010-01-01T00:00:00.000Z'),
    max: new Date('2024-01-01T00:00:00.000Z'),
  })
  .map((d) => d.toISOString());

const evidenceItemArb: fc.Arbitrary<EvidenceItem> = fc
  .record({
    sha: sha40Arb,
    author: fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0),
    date: iso8601Arb,
    hunk: fc.string({ maxLength: 500 }),
    files: fc.array(fc.string({ minLength: 1, maxLength: 80 }), { maxLength: 5 }),
  })
  .map(({ sha, author, date, hunk, files }) => ({
    id: 'E1',
    sha,
    shortSha: sha.slice(0, 7),
    author,
    email: 'test@example.com',
    date,
    subject: 'some commit',
    body: '',
    hunk,
    files,
    refs: [],
    suspiciousMessage: false,
  }));

/** Ledger with 0–50 items */
const ledgerArb: fc.Arbitrary<LedgerResult> = fc
  .array(evidenceItemArb, { minLength: 0, maxLength: 50 })
  .map(
    (items): LedgerResult => ({
      items: items as unknown as readonly EvidenceItem[],
      truncated: false,
      buildDurationMs: 0,
    }),
  );

/** Non-empty ledger */
const nonEmptyLedgerArb: fc.Arbitrary<LedgerResult> = fc
  .array(evidenceItemArb, { minLength: 1, maxLength: 50 })
  .map(
    (items): LedgerResult => ({
      items: items as unknown as readonly EvidenceItem[],
      truncated: false,
      buildDurationMs: 0,
    }),
  );

const scoreInputArb: fc.Arbitrary<ScoreInput> = fc.record({
  authorGoneThresholdDays: fc.integer({ min: 1, max: 3650 }),
  nowMs: fc.integer({
    min: new Date('2024-01-01').getTime(),
    max: new Date('2030-01-01').getTime(),
  }),
});

// ---------------------------------------------------------------------------
// PS1 — Score bounds: score ∈ [0, 100]
// ---------------------------------------------------------------------------

describe('PS1 — Score bounds', () => {
  test.prop(
    [ledgerArb.chain((ledger) => scoreInputArb.map((input) => ({ ledger, input })))],
    fcParams,
  )('score is always in [0, 100]', ({ ledger, input }) => {
    const result = computeScore(ledger, input, input.nowMs);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(result.score)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PS2 — Age monotone: larger gap → ageSignal.rawValue ≥
// ---------------------------------------------------------------------------

describe('PS2 — Age signal monotone in time gap', () => {
  test.prop(
    [
      // Use a non-empty ledger so age signal is meaningful
      nonEmptyLedgerArb.chain((ledger) => {
        // Pick two nowMs values; n1 is always ≥ n2 (relative to item dates)
        const baseMs = new Date('2026-01-01').getTime();
        return fc
          .tuple(
            fc.integer({ min: 0, max: 365 * 86_400_000 }),
            fc.integer({ min: 0, max: 365 * 86_400_000 }),
          )
          .map(([delta1, delta2]) => {
            const n1 = baseMs + Math.max(delta1, delta2);
            const n2 = baseMs + Math.min(delta1, delta2);
            return { ledger, n1, n2 };
          });
      }),
    ],
    fcParams,
  )('larger nowMs → ageSignal.rawValue >=', ({ ledger, n1, n2 }) => {
    const input: ScoreInput = { authorGoneThresholdDays: 365, nowMs: n1 };

    const result1 = computeScore(ledger, input, n1);
    const result2 = computeScore(ledger, { ...input, nowMs: n2 }, n2);

    const age1 = result1.signalBreakdown.find((s) => s.signal === 'age')!;
    const age2 = result2.signalBreakdown.find((s) => s.signal === 'age')!;

    // n1 >= n2, so age signal for n1 should be >= age signal for n2
    expect(age1.rawValue).toBeGreaterThanOrEqual(age2.rawValue - 1e-9);
  });
});

// ---------------------------------------------------------------------------
// PS3 — Marker signal monotone
// ---------------------------------------------------------------------------

describe('PS3 — Marker signal monotone', () => {
  test.prop(
    [
      // Build a non-empty ledger, then add one more TODO hunk line to get a variant
      nonEmptyLedgerArb.chain((ledger) => {
        const input: ScoreInput = {
          authorGoneThresholdDays: 365,
          nowMs: new Date('2026-11-05').getTime(),
        };
        return fc.constant({ ledger, input });
      }),
    ],
    fcParams,
  )(
    'appending a TODO line → markerSignal.rawValue non-decreasing',
    ({ ledger, input }) => {
      const original = computeScore(ledger, input, input.nowMs);

      // Create a variant by modifying the first item's hunk to include a TODO
      const items = [...ledger.items];
      const firstItem = items[0]!;
      const variantItems: EvidenceItem[] = [
        { ...firstItem, hunk: firstItem.hunk + '\n+// TODO: added marker for test\n' },
        ...items.slice(1),
      ];
      const variantLedger: LedgerResult = {
        ...ledger,
        items: variantItems as unknown as readonly EvidenceItem[],
      };
      const variant = computeScore(variantLedger, input, input.nowMs);

      const markerOriginal = original.signalBreakdown.find((s) => s.signal === 'marker')!;
      const markerVariant = variant.signalBreakdown.find((s) => s.signal === 'marker')!;

      expect(markerVariant.rawValue).toBeGreaterThanOrEqual(
        markerOriginal.rawValue - 1e-9,
      );
    },
  );
});

// ---------------------------------------------------------------------------
// PS4 — Determinism
// ---------------------------------------------------------------------------

describe('PS4 — Determinism', () => {
  test.prop(
    [ledgerArb.chain((ledger) => scoreInputArb.map((input) => ({ ledger, input })))],
    fcParams,
  )('same inputs → deepEqual ScoredResults', ({ ledger, input }) => {
    const result1 = computeScore(ledger, input, input.nowMs);
    const result2 = computeScore(ledger, input, input.nowMs);

    expect(result1).toEqual(result2);
  });
});

// ---------------------------------------------------------------------------
// PS5 — VerifiedRefactorPlan.verifierScore ∈ [0, 1]
// ---------------------------------------------------------------------------

describe('PS5 — verifierScore bounds on VerifiedRefactorPlan', () => {
  // ward-hardening T2: VerifiedRefactorPlanSchema is removed; the bound is checked on the
  // real verifyPlanClaims output for plans mixing verified, struck and silence claims.
  const ledger: LedgerResult = {
    items: [
      {
        id: 'E1',
        sha: 'abc1234' + '0'.repeat(33),
        shortSha: 'abc1234',
        author: 'Ada Lovelace',
        email: 'ada@example.com',
        date: '2020-01-01T00:00:00.000Z',
        subject: 'a quote of some length',
        body: '',
        hunk: '',
        files: ['f.js'],
        refs: [],
        suspiciousMessage: false,
      },
    ],
    truncated: false,
    buildDurationMs: 0,
  };

  const validClaim = {
    kind: 'memory' as const,
    text: 'A claim',
    citations: [{ sha7: 'abc1234', quote: 'a quote of some length' }],
  };

  const silenceClaim = {
    kind: 'silence' as const,
    text: 'The record is silent.',
    citations: [],
    silenceReason: 'No evidence found',
  };

  const struckClaim = {
    kind: 'memory' as const,
    text: 'A struck claim',
    citations: [{ sha7: 'deadbee', quote: 'a quote of some length' }],
  };

  const claimsArb = fc.array(fc.constantFrom(validClaim, silenceClaim, struckClaim), {
    minLength: 1,
    maxLength: 5,
  });

  const planArb: fc.Arbitrary<RefactorPlan> = fc
    .tuple(
      fc.array(claimsArb, { minLength: 1, maxLength: 3 }),
      fc.array(claimsArb, { maxLength: 3 }),
    )
    .map(([stepClaims, entryClaims]) => ({
      characterizationTests: ['it should behave correctly'],
      steps: stepClaims.map((claims) => ({
        description: 'Extract utility function',
        rationale: 'Reduces duplication',
        claims,
        reversible: true,
      })),
      doNotTouchList: entryClaims.map((claims) => ({
        lineRange: { start: 1, end: 5 },
        reason: 'Critical workaround',
        claims,
      })),
      summary: 'Refactor legacy code carefully.',
    }));

  test.prop([planArb], fcParams)('verifierScore is always in [0, 1]', (plan) => {
    const result: VerifiedRefactorPlan = verifyPlanClaims(ledger, plan);
    expect(result.verifierScore).toBeGreaterThanOrEqual(0);
    expect(result.verifierScore).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// PS6 — Empty ledger identity: score === 0
// ---------------------------------------------------------------------------

describe('PS6 — Empty ledger always produces score === 0', () => {
  test.prop([scoreInputArb], fcParams)(
    'score === 0 regardless of ScoreInput when items is empty',
    (input) => {
      const emptyLedger: LedgerResult = {
        items: [] as unknown as readonly EvidenceItem[],
        truncated: false,
        buildDurationMs: 0,
      };
      const result = computeScore(emptyLedger, input, input.nowMs);

      expect(result.score).toBe(0);
    },
  );
});
