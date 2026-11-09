/**
 * T1 unit tests for src/ghost/schema.ts
 *
 * Tests:
 * - Parse a valid GhostAnswer for each claim kind (memory, speculation, silence)
 * - Each invalid variant produces a Zod error
 */

import { describe, it, expect } from 'vitest';
import {
  CitationSchema,
  MemoryClaimSchema,
  SpeculationClaimSchema,
  SilenceClaimSchema,
  ClaimSchema,
  GhostAnswerSchema,
  VerifierResultSchema,
  SummonResponseSchema,
  VerifiedAnswerResponseSchema,
} from '../../src/ghost/schema.js';

// ---------------------------------------------------------------------------
// CitationSchema
// ---------------------------------------------------------------------------

describe('CitationSchema', () => {
  it('accepts a valid sha7 without quote', () => {
    const result = CitationSchema.safeParse({ sha7: 'abc1234' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid sha7 with a non-empty quote', () => {
    const result = CitationSchema.safeParse({
      sha7: 'abc1234',
      quote: 'fix race condition',
    });
    expect(result.success).toBe(true);
  });

  it('rejects sha7 that is not 7 chars', () => {
    const result = CitationSchema.safeParse({ sha7: 'abc123' });
    expect(result.success).toBe(false);
  });

  it('rejects sha7 with uppercase hex', () => {
    const result = CitationSchema.safeParse({ sha7: 'ABC1234' });
    expect(result.success).toBe(false);
  });

  it('rejects sha7 with non-hex chars', () => {
    const result = CitationSchema.safeParse({ sha7: 'zzzzzz1' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty quote string', () => {
    const result = CitationSchema.safeParse({ sha7: 'abc1234', quote: '' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MemoryClaimSchema
// ---------------------------------------------------------------------------

describe('MemoryClaimSchema', () => {
  it('accepts a valid memory claim', () => {
    const result = MemoryClaimSchema.safeParse({
      kind: 'memory',
      text: 'I added this for legacy callers',
      citations: [{ sha7: 'abc1234' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects memory claim with empty citations array', () => {
    const result = MemoryClaimSchema.safeParse({
      kind: 'memory',
      text: 'Some text',
      citations: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects memory claim with empty text', () => {
    const result = MemoryClaimSchema.safeParse({
      kind: 'memory',
      text: '',
      citations: [{ sha7: 'abc1234' }],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SpeculationClaimSchema
// ---------------------------------------------------------------------------

describe('SpeculationClaimSchema', () => {
  it('accepts a valid speculation claim', () => {
    const result = SpeculationClaimSchema.safeParse({
      kind: 'speculation',
      text: 'This might have been a performance fix',
      citations: [{ sha7: 'def5678' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects speculation claim with no citations', () => {
    const result = SpeculationClaimSchema.safeParse({
      kind: 'speculation',
      text: 'Some guess',
      citations: [],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SilenceClaimSchema
// ---------------------------------------------------------------------------

describe('SilenceClaimSchema', () => {
  it('accepts a valid silence claim', () => {
    const result = SilenceClaimSchema.safeParse({
      kind: 'silence',
      text: 'The record is silent',
      citations: [],
      silenceReason: 'No commits in the ledger mention this behaviour',
    });
    expect(result.success).toBe(true);
  });

  it('rejects silence claim with citations', () => {
    const result = SilenceClaimSchema.safeParse({
      kind: 'silence',
      text: 'Cannot say',
      citations: [{ sha7: 'abc1234' }],
      silenceReason: 'No evidence',
    });
    expect(result.success).toBe(false);
  });

  it('rejects silence claim missing silenceReason', () => {
    const result = SilenceClaimSchema.safeParse({
      kind: 'silence',
      text: 'Cannot say',
      citations: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects silence claim with empty silenceReason', () => {
    const result = SilenceClaimSchema.safeParse({
      kind: 'silence',
      text: 'Cannot say',
      citations: [],
      silenceReason: '',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ClaimSchema discriminated union
// ---------------------------------------------------------------------------

describe('ClaimSchema', () => {
  it('parses a memory claim via discriminated union', () => {
    const result = ClaimSchema.safeParse({
      kind: 'memory',
      text: 'Added sleep for downstream service',
      citations: [{ sha7: 'abc1234', quote: 'wait for downstream' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('memory');
    }
  });

  it('parses a speculation claim via discriminated union', () => {
    const result = ClaimSchema.safeParse({
      kind: 'speculation',
      text: 'Probably a race condition',
      citations: [{ sha7: 'def5678' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('speculation');
    }
  });

  it('parses a silence claim via discriminated union', () => {
    const result = ClaimSchema.safeParse({
      kind: 'silence',
      text: 'The record is silent on this topic',
      citations: [],
      silenceReason: 'No relevant commits found',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('silence');
    }
  });

  it('rejects unknown kind', () => {
    const result = ClaimSchema.safeParse({
      kind: 'rumour',
      text: 'something',
      citations: [],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GhostAnswerSchema
// ---------------------------------------------------------------------------

describe('GhostAnswerSchema', () => {
  const validAnswer = {
    claims: [
      {
        kind: 'memory',
        text: 'I added the sleep because the downstream service was not ready.',
        citations: [{ sha7: 'abc1234', quote: 'wait for downstream' }],
      },
    ],
    voice: 'Ada Lovelace, terse and precise',
    sessionId: 'session-abc-123',
  };

  it('parses a valid GhostAnswer with a memory claim', () => {
    const result = GhostAnswerSchema.safeParse(validAnswer);
    expect(result.success).toBe(true);
  });

  it('parses a valid GhostAnswer with speculation claim', () => {
    const result = GhostAnswerSchema.safeParse({
      ...validAnswer,
      claims: [
        {
          kind: 'speculation',
          text: 'This might be related to a race condition.',
          citations: [{ sha7: 'def5678' }],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid GhostAnswer with silence claim', () => {
    const result = GhostAnswerSchema.safeParse({
      ...validAnswer,
      claims: [
        {
          kind: 'silence',
          text: 'The record is silent.',
          citations: [],
          silenceReason: 'No relevant commits found',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects GhostAnswer with empty claims array', () => {
    const result = GhostAnswerSchema.safeParse({ ...validAnswer, claims: [] });
    expect(result.success).toBe(false);
  });

  it('rejects GhostAnswer with missing sessionId', () => {
    const { sessionId: _, ...noSession } = validAnswer;
    const result = GhostAnswerSchema.safeParse(noSession);
    expect(result.success).toBe(false);
  });

  it('rejects GhostAnswer with empty voice', () => {
    const result = GhostAnswerSchema.safeParse({ ...validAnswer, voice: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a memory claim with missing sha7', () => {
    const result = GhostAnswerSchema.safeParse({
      ...validAnswer,
      claims: [
        {
          kind: 'memory',
          text: 'Some claim',
          citations: [{ quote: 'no sha here' }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a memory claim with empty text', () => {
    const result = GhostAnswerSchema.safeParse({
      ...validAnswer,
      claims: [
        {
          kind: 'memory',
          text: '',
          citations: [{ sha7: 'abc1234' }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a silence claim with citations', () => {
    const result = GhostAnswerSchema.safeParse({
      ...validAnswer,
      claims: [
        {
          kind: 'silence',
          text: 'Cannot say',
          citations: [{ sha7: 'abc1234' }],
          silenceReason: 'No evidence',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a memory claim with no citations', () => {
    const result = GhostAnswerSchema.safeParse({
      ...validAnswer,
      claims: [
        {
          kind: 'memory',
          text: 'Some memory',
          citations: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VerifierResultSchema
// ---------------------------------------------------------------------------

describe('VerifierResultSchema', () => {
  it('accepts a valid VerifierResult', () => {
    const result = VerifierResultSchema.safeParse({
      verified: [
        {
          claim: {
            kind: 'memory',
            text: 'Some fact',
            citations: [{ sha7: 'abc1234' }],
          },
          speculative: false,
        },
      ],
      rejected: [],
      score: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects score < 0', () => {
    const result = VerifierResultSchema.safeParse({
      verified: [],
      rejected: [],
      score: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects score > 1', () => {
    const result = VerifierResultSchema.safeParse({
      verified: [],
      rejected: [],
      score: 1.1,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SummonResponseSchema
// ---------------------------------------------------------------------------

describe('SummonResponseSchema', () => {
  it('accepts a valid SummonResponse', () => {
    const result = SummonResponseSchema.safeParse({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      ledgerSize: 12,
      truncated: false,
      buildDurationMs: 847,
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID sessionId', () => {
    const result = SummonResponseSchema.safeParse({
      sessionId: 'not-a-uuid',
      ledgerSize: 0,
      truncated: false,
      buildDurationMs: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VerifiedAnswerResponseSchema
// ---------------------------------------------------------------------------

describe('VerifiedAnswerResponseSchema', () => {
  it('accepts a valid VerifiedAnswerResponse', () => {
    const result = VerifiedAnswerResponseSchema.safeParse({
      sessionId: 'session-abc',
      voice: 'Ada Lovelace',
      verified: [
        {
          text: 'I added the delay.',
          kind: 'memory',
          citations: [{ sha7: 'abc1234' }],
          speculative: false,
        },
      ],
      rejected: [],
      score: 1,
      report: '# Ward report\n**1 of 1 claims verified**',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T1 Exorcism schema tests — appended per tasks.md T1
// ---------------------------------------------------------------------------

import {
  ScoredResultSchema,
  DoNotTouchEntrySchema,
  RefactorPlanSchema,
  ExorciseRequestSchema,
} from '../../src/ghost/schema.js';

// ── ScoredResultSchema ───────────────────────────────────────────────────────

describe('ScoredResultSchema', () => {
  const sixBreakdowns = (
    ['age', 'churn', 'gone', 'marker', 'test', 'nesting'] as const
  ).map((signal) => ({
    signal,
    rawValue: 0.5,
    weightedContribution: 10,
  }));

  it('parses a valid ScoredResult with six breakdown entries', () => {
    const result = ScoredResultSchema.safeParse({
      score: 42,
      signalBreakdown: sixBreakdowns,
      markerLocations: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a ScoredResult whose signalBreakdown has fewer than six entries', () => {
    const result = ScoredResultSchema.safeParse({
      score: 42,
      signalBreakdown: sixBreakdowns.slice(0, 3),
      markerLocations: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a ScoredResult whose signalBreakdown has more than six entries', () => {
    const result = ScoredResultSchema.safeParse({
      score: 42,
      signalBreakdown: [...sixBreakdowns, ...sixBreakdowns],
      markerLocations: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a score outside [0, 100]', () => {
    const result = ScoredResultSchema.safeParse({
      score: 101,
      signalBreakdown: sixBreakdowns,
      markerLocations: [],
    });
    expect(result.success).toBe(false);
  });
});

// ── DoNotTouchEntrySchema ────────────────────────────────────────────────────

describe('DoNotTouchEntrySchema', () => {
  const validEntry = {
    lineRange: { start: 10, end: 20 },
    reason: 'Critical external constraint from upstream API contract.',
    claims: [
      {
        kind: 'memory',
        text: 'This was required by the API contract.',
        citations: [{ sha7: 'abc1234' }],
      },
    ],
  };

  it('accepts a valid DoNotTouchEntry', () => {
    const result = DoNotTouchEntrySchema.safeParse(validEntry);
    expect(result.success).toBe(true);
  });

  it('rejects a DoNotTouchEntry where lineRange.end < lineRange.start', () => {
    const result = DoNotTouchEntrySchema.safeParse({
      ...validEntry,
      lineRange: { start: 20, end: 10 },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a DoNotTouchEntry where lineRange.end === lineRange.start', () => {
    const result = DoNotTouchEntrySchema.safeParse({
      ...validEntry,
      lineRange: { start: 5, end: 5 },
    });
    expect(result.success).toBe(true);
  });
});

// ── RefactorPlanSchema ───────────────────────────────────────────────────────

describe('RefactorPlanSchema', () => {
  const validStep = {
    description: 'Extract the retry logic into a dedicated helper function.',
    rationale: 'Reduces duplication across callers.',
    claims: [
      {
        kind: 'memory',
        text: 'The retry logic was added to handle flaky downstream calls.',
        citations: [{ sha7: 'abc1234' }],
      },
    ],
    reversible: true,
  };

  const validEntry = {
    lineRange: { start: 10, end: 20 },
    reason: 'Critical workaround for upstream API.',
    claims: [
      {
        kind: 'memory',
        text: 'This was required by the API contract.',
        citations: [{ sha7: 'abc1234' }],
      },
    ],
  };

  it('parses a valid RefactorPlan with one step and one do-not-touch entry', () => {
    const result = RefactorPlanSchema.safeParse({
      characterizationTests: ['it should return 200 on valid input'],
      steps: [validStep],
      doNotTouchList: [validEntry],
      summary: 'Extract retry logic and leave the workaround in place.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a RefactorPlan with an empty steps array', () => {
    const result = RefactorPlanSchema.safeParse({
      characterizationTests: ['it should return 200 on valid input'],
      steps: [],
      doNotTouchList: [],
      summary: 'No steps to take.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a RefactorPlan with an empty characterizationTests array', () => {
    const result = RefactorPlanSchema.safeParse({
      characterizationTests: [],
      steps: [validStep],
      doNotTouchList: [],
      summary: 'A plan without characterization tests.',
    });
    expect(result.success).toBe(false);
  });
});

// ── ExorciseRequestSchema ────────────────────────────────────────────────────

describe('ExorciseRequestSchema', () => {
  it('parses a valid ExorciseRequest without authorGoneThresholdDays', () => {
    const result = ExorciseRequestSchema.safeParse({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.authorGoneThresholdDays).toBeUndefined();
    }
  });

  it('parses a valid ExorciseRequest with authorGoneThresholdDays', () => {
    const result = ExorciseRequestSchema.safeParse({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      authorGoneThresholdDays: 180,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.authorGoneThresholdDays).toBe(180);
    }
  });

  it('rejects an ExorciseRequest with an empty sessionId', () => {
    const result = ExorciseRequestSchema.safeParse({
      sessionId: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an ExorciseRequest with negative authorGoneThresholdDays', () => {
    const result = ExorciseRequestSchema.safeParse({
      sessionId: 'some-session',
      authorGoneThresholdDays: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an ExorciseRequest with zero authorGoneThresholdDays', () => {
    const result = ExorciseRequestSchema.safeParse({
      sessionId: 'some-session',
      authorGoneThresholdDays: 0,
    });
    expect(result.success).toBe(false);
  });
});
