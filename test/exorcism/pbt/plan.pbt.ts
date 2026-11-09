/**
 * T4 — Property-based tests for buildPlanPrompt and buildPlan verification.
 *
 * fast-check: 1 000 runs per property; fixed seed via FAST_CHECK_SEED env var.
 */

import { describe, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { buildPlanPrompt } from '../../../src/exorcism/plan.js';
import type {
  EvidenceItem,
  LedgerResult,
  ScoredResult,
  SignalBreakdown,
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

const sha7Arb: fc.Arbitrary<string> = fc
  .hexaString({ minLength: 7, maxLength: 7 })
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

const signalBreakdownArb: fc.Arbitrary<SignalBreakdown> = fc.record({
  signal: fc.constantFrom(
    'age' as const,
    'churn' as const,
    'gone' as const,
    'marker' as const,
    'test' as const,
    'nesting' as const,
  ),
  rawValue: fc.float({ min: 0, max: 1, noNaN: true }),
  weightedContribution: fc.float({ min: 0, max: 25, noNaN: true }),
});

const scoredResultArb: fc.Arbitrary<ScoredResult> = fc.record({
  score: fc.integer({ min: 0, max: 100 }),
  signalBreakdown: fc
    .array(signalBreakdownArb, { minLength: 6, maxLength: 6 })
    .map((arr) => {
      // Ensure we have exactly one of each signal
      const signals = ['age', 'churn', 'gone', 'marker', 'test', 'nesting'] as const;
      return signals.map((signal, i) => ({
        signal,
        rawValue: arr[i]?.rawValue ?? 0.5,
        weightedContribution: arr[i]?.weightedContribution ?? 5,
      }));
    }),
  markerLocations: fc.array(
    fc.record({
      sha7: sha7Arb,
      lineText: fc.string({ maxLength: 256 }),
    }),
    { maxLength: 10 },
  ),
});

// ---------------------------------------------------------------------------
// PP1 — buildPlanPrompt determinism
// ---------------------------------------------------------------------------

describe('PP1 — buildPlanPrompt determinism', () => {
  test.prop(
    [
      nonEmptyLedgerArb.chain((ledger) =>
        scoredResultArb.map((scored) => ({ ledger, scored })),
      ),
    ],
    fcParams,
  )('same inputs → identical prompt string', ({ ledger, scored }) => {
    const prompt1 = buildPlanPrompt(ledger, scored);
    const prompt2 = buildPlanPrompt(ledger, scored);

    expect(prompt1).toBe(prompt2);
  });
});

// ---------------------------------------------------------------------------
// PP2 — buildPlanPrompt includes evidence block
// ---------------------------------------------------------------------------

describe('PP2 — buildPlanPrompt always includes evidence block', () => {
  test.prop(
    [
      nonEmptyLedgerArb.chain((ledger) =>
        scoredResultArb.map((scored) => ({ ledger, scored })),
      ),
    ],
    fcParams,
  )('prompt always contains [EVIDENCE] block', ({ ledger, scored }) => {
    const prompt = buildPlanPrompt(ledger, scored);

    expect(prompt).toContain('[EVIDENCE]');
  });
});

// ---------------------------------------------------------------------------
// PP3 — buildPlanPrompt includes score block
// ---------------------------------------------------------------------------

describe('PP3 — buildPlanPrompt always includes score block', () => {
  test.prop(
    [ledgerArb.chain((ledger) => scoredResultArb.map((scored) => ({ ledger, scored })))],
    fcParams,
  )('prompt always contains [SCORE] block', ({ ledger, scored }) => {
    const prompt = buildPlanPrompt(ledger, scored);

    expect(prompt).toContain('[SCORE]');
  });
});

// ---------------------------------------------------------------------------
// PP4 — buildPlanPrompt includes response format block
// ---------------------------------------------------------------------------

describe('PP4 — buildPlanPrompt always includes response format', () => {
  test.prop(
    [ledgerArb.chain((ledger) => scoredResultArb.map((scored) => ({ ledger, scored })))],
    fcParams,
  )('prompt always contains [RESPONSE FORMAT] block', ({ ledger, scored }) => {
    const prompt = buildPlanPrompt(ledger, scored);

    expect(prompt).toContain('[RESPONSE FORMAT]');
  });
});

// ---------------------------------------------------------------------------
// PP5 — buildPlanPrompt score value is respected
// ---------------------------------------------------------------------------

describe('PP5 — buildPlanPrompt score value serialization', () => {
  test.prop(
    [ledgerArb.chain((ledger) => scoredResultArb.map((scored) => ({ ledger, scored })))],
    fcParams,
  )('prompt score attribute matches ScoredResult.score', ({ ledger, scored }) => {
    const prompt = buildPlanPrompt(ledger, scored);

    // Extract the score attribute from the <score overall="X"> tag
    const scoreMatch = prompt.match(/overall="(\d+)"/);
    expect(scoreMatch).not.toBeNull();

    if (scoreMatch) {
      const scoreInPrompt = parseInt(scoreMatch[1]!, 10);
      expect(scoreInPrompt).toBe(scored.score);
    }
  });
});

// ---------------------------------------------------------------------------
// PP6 — buildPlanPrompt system block warning
// ---------------------------------------------------------------------------

describe('PP6 — buildPlanPrompt includes citation enforcement warning', () => {
  test.prop(
    [ledgerArb.chain((ledger) => scoredResultArb.map((scored) => ({ ledger, scored })))],
    fcParams,
  )('prompt contains system-level warning about citations', ({ ledger, scored }) => {
    const prompt = buildPlanPrompt(ledger, scored);

    // Ensure the system block warns about SHA citations
    expect(prompt).toContain('[SYSTEM]');
    expect(prompt).toMatch(/claim must cite.*SHA/i);
  });
});
