/**
 * T4 — Property-based tests for buildPlanPrompt and buildPlan verification.
 * ward-hardening T2: the { system, user } layout, and CP12 for verifyPlanClaims (R7.1, R7.2, R7.6).
 *
 * fast-check: 1 000 runs per property; fixed seed via FAST_CHECK_SEED env var.
 */

import { describe, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { buildPlanPrompt, verifyPlanClaims } from '../../../src/exorcism/plan.js';
import { RefactorPlanSchema } from '../../../src/ghost/schema.js';
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
const pairArb = (l: fc.Arbitrary<LedgerResult>) =>
  l.chain((ledger) => scoredResultArb.map((scored) => ({ ledger, scored })));

// ---------------------------------------------------------------------------
// PP1 — buildPlanPrompt determinism
// ---------------------------------------------------------------------------

describe('PP1 — buildPlanPrompt determinism', () => {
  test.prop([pairArb(nonEmptyLedgerArb)], fcParams)(
    'same inputs → identical { system, user }',
    ({ ledger, scored }) => {
      expect(buildPlanPrompt(ledger, scored)).toEqual(buildPlanPrompt(ledger, scored));
    },
  );
});

// ---------------------------------------------------------------------------
// PP2–PP4 — the user turn holds the ledger and the score; system holds the format
// ---------------------------------------------------------------------------

describe('PP2 — buildPlanPrompt always includes the ledger in user', () => {
  test.prop([pairArb(nonEmptyLedgerArb)], fcParams)(
    'user contains <ledger> … </ledger>',
    ({ ledger, scored }) => {
      const { user } = buildPlanPrompt(ledger, scored);
      expect(user.startsWith('<ledger>\n')).toBe(true);
      expect(user).toContain('\n</ledger>');
    },
  );
});

describe('PP3 — buildPlanPrompt always includes the score block in user', () => {
  test.prop([pairArb(ledgerArb)], fcParams)(
    'user contains exactly one <score> element',
    ({ ledger, scored }) => {
      const { user } = buildPlanPrompt(ledger, scored);
      expect(user.split('<score ').length - 1).toBe(1);
      expect(user.split('</score>').length - 1).toBe(1);
    },
  );
});

describe('PP4 — buildPlanPrompt system holds the response format', () => {
  test.prop([pairArb(ledgerArb)], fcParams)(
    'system describes the plan fields and the tool call',
    ({ ledger, scored }) => {
      const { system } = buildPlanPrompt(ledger, scored);
      expect(system).toContain('characterizationTests');
      expect(system).toContain('doNotTouchList');
      expect(system).toContain('Answer by calling the refactor_plan tool exactly once.');
    },
  );
});

// ---------------------------------------------------------------------------
// PP5 — buildPlanPrompt score value is respected
// ---------------------------------------------------------------------------

describe('PP5 — buildPlanPrompt score value serialization', () => {
  test.prop([pairArb(ledgerArb)], fcParams)(
    'user score attribute matches ScoredResult.score',
    ({ ledger, scored }) => {
      const { user } = buildPlanPrompt(ledger, scored);
      const scoreMatch = user.match(/<score overall="(\d+)">/);
      expect(scoreMatch).not.toBeNull();
      if (scoreMatch) {
        expect(parseInt(scoreMatch[1]!, 10)).toBe(scored.score);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// PP6 — buildPlanPrompt system rules
// ---------------------------------------------------------------------------

describe('PP6 — buildPlanPrompt includes citation enforcement rules in system', () => {
  test.prop([pairArb(ledgerArb)], fcParams)(
    'system warns about citations and quotes',
    ({ ledger, scored }) => {
      const { system } = buildPlanPrompt(ledger, scored);
      expect(system).toMatch(/claim must cite.*SHA/i);
      expect(system).toContain('every citation carries a quote');
    },
  );
});

// ---------------------------------------------------------------------------
// CP12 — plan verification (R7.1, R7.2, R7.6)
// ---------------------------------------------------------------------------

/** A small ledger with distinct short hashes and quotable subjects. */
const cp12LedgerArb: fc.Arbitrary<LedgerResult> = fc
  .uniqueArray(sha40Arb, { minLength: 1, maxLength: 4, selector: (s) => s.slice(0, 7) })
  .map((shas) => ({
    items: shas.map((sha, i) => ({
      id: `E${i + 1}`,
      sha,
      shortSha: sha.slice(0, 7),
      author: 'Plain Author',
      email: 'a@example.com',
      date: '2015-06-01T00:00:00.000Z',
      subject: `subject number ${i} of the plan ledger`,
      body: '',
      hunk: '',
      files: ['f.js'],
      refs: [],
      suspiciousMessage: i % 2 === 1,
    })) as unknown as readonly EvidenceItem[],
    truncated: false,
    buildDurationMs: 0,
  }));

/** Claims of every kind: valid, misquoted, quoteless, unknown commit, silence, malformed. */
function claimArb(ledger: LedgerResult): fc.Arbitrary<unknown> {
  const n = ledger.items.length;
  return fc.oneof(
    fc.integer({ min: 0, max: n - 1 }).map((i) => ({
      kind: 'memory',
      text: 'A cited claim.',
      citations: [
        { sha7: ledger.items[i]!.shortSha, quote: `subject number ${i} of the plan` },
      ],
    })),
    fc.integer({ min: 0, max: n - 1 }).map((i) => ({
      kind: 'speculation',
      text: 'A guess.',
      citations: [{ sha7: ledger.items[i]!.shortSha, quote: 'not in any commit' }],
    })),
    fc.integer({ min: 0, max: n - 1 }).map((i) => ({
      kind: 'memory',
      text: 'Quoteless.',
      citations: [{ sha7: ledger.items[i]!.shortSha }],
    })),
    sha7Arb.map((sha7) => ({
      kind: 'memory',
      text: 'Unknown commit.',
      citations: [{ sha7, quote: 'subject number 0 of the plan' }],
    })),
    fc.constant({
      kind: 'silence',
      text: 'Silent.',
      citations: [],
      silenceReason: 'Why?',
    }),
    fc.anything(),
  );
}

const planArb = cp12LedgerArb.chain((ledger) => {
  const claims = fc.array(claimArb(ledger), { minLength: 1, maxLength: 4 });
  const stepArb = fc.record({
    description: fc.string({ minLength: 1, maxLength: 20 }),
    rationale: fc.string({ minLength: 1, maxLength: 20 }),
    claims,
    reversible: fc.boolean(),
  });
  const entryArb = fc
    .tuple(fc.integer({ min: 1, max: 50 }), fc.integer({ min: 0, max: 5 }), claims)
    .map(([start, len, cs]) => ({
      lineRange: { start, end: start + len },
      reason: 'kept for a reason',
      claims: cs,
    }));
  return fc
    .record({
      steps: fc.array(stepArb, { minLength: 1, maxLength: 4 }),
      doNotTouchList: fc.array(entryArb, { maxLength: 3 }),
    })
    .map((p) => ({
      ledger,
      plan: RefactorPlanSchema.parse({
        characterizationTests: ['a test'],
        summary: 'a summary',
        ...p,
      }),
    }));
});

describe('CP12 — plan verification', () => {
  test.prop([planArb], fcParams)(
    'shown entries have a verified claim, nothing is lost, the tally covers all three lists',
    ({ ledger, plan }) => {
      const result = verifyPlanClaims(ledger, plan);

      for (const s of result.steps) expect(s.claims.length).toBeGreaterThanOrEqual(1);
      for (const e of result.doNotTouchList)
        expect(e.claims.length).toBeGreaterThanOrEqual(1);
      for (const d of result.dropped)
        expect(d.rejectedClaims.length).toBeGreaterThanOrEqual(1);

      expect(
        result.steps.length + result.doNotTouchList.length + result.dropped.length,
      ).toBe(plan.steps.length + plan.doNotTouchList.length);
      expect(
        result.dropped.filter((d) => d.kind === 'step').length + result.steps.length,
      ).toBe(plan.steps.length);

      const inputClaims = [...plan.steps, ...plan.doNotTouchList].reduce(
        (n, x) => n + x.claims.length,
        0,
      );
      const verified =
        result.steps.reduce((n, s) => n + s.claims.length, 0) +
        result.doNotTouchList.reduce((n, e) => n + e.claims.length, 0);
      const rejected =
        result.steps.reduce((n, s) => n + s.rejectedClaims.length, 0) +
        result.doNotTouchList.reduce((n, e) => n + e.rejectedClaims.length, 0) +
        result.dropped.reduce((n, d) => n + d.rejectedClaims.length, 0);
      expect(verified + rejected).toBe(inputClaims);
      expect(result.verifierScore).toBeCloseTo(
        verified + rejected === 0 ? 1 : verified / (verified + rejected),
        12,
      );
      expect(result.verifierScore).toBeGreaterThanOrEqual(0);
      expect(result.verifierScore).toBeLessThanOrEqual(1);
    },
  );
});
