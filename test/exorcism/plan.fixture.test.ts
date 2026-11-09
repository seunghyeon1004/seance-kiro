/**
 * T7 fixture generation test for exorcism plans
 *
 * This test:
 * 1. Defines a fixed ledger (small, deterministic)
 * 2. Computes its prompt hash via buildPlanPrompt
 * 3. Runs buildPlan in fixture mode (ANTHROPIC_FIXTURE=1)
 * 4. Asserts verifierScore > 0 and plan shape is valid
 *
 * The fixture hash is used to name the fixture file in test/fixtures/exorcism-plans/.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { buildPlanPrompt, buildPlan } from '../../src/exorcism/plan.js';
import type {
  LedgerResult,
  EvidenceItem,
  ScoredResult,
  SignalBreakdown,
} from '../../src/ghost/schema.js';

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const SHA_40 = 'abc1234' + '0'.repeat(33);

function makeItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return Object.freeze({
    id: 'E1',
    sha: SHA_40,
    shortSha: 'abc1234',
    author: 'Ada Lovelace',
    email: 'ada@example.com',
    date: new Date('2020-01-01T00:00:00.000Z').toISOString(),
    subject: 'fix: add sleep for downstream service',
    body: 'wait for downstream to stabilise',
    hunk: '+sleep(3000);\n',
    files: ['src/utils.ts'],
    refs: [],
    suspiciousMessage: false,
    ...overrides,
  });
}

function makeLedger(items: EvidenceItem[]): LedgerResult {
  return {
    items: items as unknown as readonly EvidenceItem[],
    truncated: false,
    buildDurationMs: 0,
  };
}

function makeScoredResult(overrides: Partial<ScoredResult> = {}): ScoredResult {
  const signals: Array<SignalBreakdown['signal']> = [
    'age',
    'churn',
    'gone',
    'marker',
    'test',
    'nesting',
  ];
  return {
    score: 42,
    signalBreakdown: signals.map((signal) => ({
      signal,
      rawValue: 0.5,
      weightedContribution: signal === 'age' ? 12.5 : 5,
    })),
    markerLocations: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test fixture: small fixed ledger and score
// ---------------------------------------------------------------------------

const FIXTURE_LEDGER = makeLedger([makeItem()]);
const FIXTURE_SCORE = makeScoredResult({
  score: 35,
  signalBreakdown: [
    { signal: 'age', rawValue: 0.45, weightedContribution: 11.25 },
    { signal: 'churn', rawValue: 0.3, weightedContribution: 6 },
    { signal: 'gone', rawValue: 0.2, weightedContribution: 4 },
    { signal: 'marker', rawValue: 0.1, weightedContribution: 1.5 },
    { signal: 'test', rawValue: 1, weightedContribution: 10 },
    { signal: 'nesting', rawValue: 0, weightedContribution: 0 },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// T7 — fixture generation and validation
// ---------------------------------------------------------------------------

describe('plan.fixture — hash computation and fixture generation', () => {
  it('computes the prompt hash from fixed ledger and score', () => {
    const prompt = buildPlanPrompt(FIXTURE_LEDGER, FIXTURE_SCORE);
    const hash = createHash('sha256').update(prompt).digest('hex').slice(0, 8);

    // The hash should be deterministic and reproducible
    const hash2 = createHash('sha256')
      .update(buildPlanPrompt(FIXTURE_LEDGER, FIXTURE_SCORE))
      .digest('hex')
      .slice(0, 8);
    expect(hash).toBe(hash2);
  });

  it('the canonical fixture file exists for this ledger and score', async () => {
    const prompt = buildPlanPrompt(FIXTURE_LEDGER, FIXTURE_SCORE);
    const hash = createHash('sha256').update(prompt).digest('hex').slice(0, 8);
    const file = new URL(`../fixtures/exorcism-plans/${hash}.json`, import.meta.url);
    await expect(access(file)).resolves.toBeUndefined();
  });

  it('buildPlan in fixture mode reads that file through the real loader and verifies it', async () => {
    const prev = process.env['ANTHROPIC_FIXTURE'];
    process.env['ANTHROPIC_FIXTURE'] = '1';
    try {
      const plan = await buildPlan(
        FIXTURE_LEDGER,
        FIXTURE_SCORE,
        '550e8400-e29b-41d4-a716-446655440000',
      );
      expect(plan.steps.length).toBeGreaterThanOrEqual(2);
      expect(plan.doNotTouchList.length).toBeGreaterThanOrEqual(1);
      expect(plan.verifierScore).toBeGreaterThan(0);
      expect(plan.verifierScore).toBeLessThanOrEqual(1);
    } finally {
      if (prev === undefined) delete process.env['ANTHROPIC_FIXTURE'];
      else process.env['ANTHROPIC_FIXTURE'] = prev;
    }
  });
});
