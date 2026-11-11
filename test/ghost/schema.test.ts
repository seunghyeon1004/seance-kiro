/**
 * Unit tests for src/ghost/schema.ts
 *
 * ghost-verifier T1 tests, updated for ward-hardening T1 (design.md §3, §13.2):
 * quotes are mandatory and bounded, silence text is capped, the wire envelope
 * bounds the claim count, and the ask/ward response carries quotes, silent and tally.
 */

import { describe, it, expect } from 'vitest';
import {
  QUOTE_MIN_CHARS,
  QUOTE_MAX_CHARS,
  SILENCE_MAX_CHARS,
  MAX_CLAIMS,
  MAX_CITATIONS,
  HUNK_UI_CHARS,
  CitationSchema,
  QuoteSchema,
  MemoryClaimSchema,
  SpeculationClaimSchema,
  SilenceClaimSchema,
  ClaimSchema,
  ClaimShapeSchema,
  GhostAnswerSchema,
  GhostAnswerWireSchema,
  SummonResponseSchema,
  VerifiedAnswerResponseSchema,
} from '../../src/ghost/schema.js';

const Q = 'fix race condition';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('ward constants (design.md §3)', () => {
  it('have the values the spec names', () => {
    expect(QUOTE_MIN_CHARS).toBe(8);
    expect(QUOTE_MAX_CHARS).toBe(500);
    expect(SILENCE_MAX_CHARS).toBe(300);
    expect(MAX_CLAIMS).toBe(50);
    expect(MAX_CITATIONS).toBe(10);
    expect(HUNK_UI_CHARS).toBe(4000);
  });
});

// ---------------------------------------------------------------------------
// CitationSchema (R1.1)
// ---------------------------------------------------------------------------

describe('CitationSchema', () => {
  it('rejects a citation without a quote', () => {
    const result = CitationSchema.safeParse({ sha7: 'abc1234' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid sha7 with a quote of at least 8 characters', () => {
    const result = CitationSchema.safeParse({ sha7: 'abc1234', quote: Q });
    expect(result.success).toBe(true);
  });

  it('accepts a quote of exactly 8 characters', () => {
    expect(CitationSchema.safeParse({ sha7: 'abc1234', quote: '12345678' }).success).toBe(
      true,
    );
  });

  it('rejects a quote of 7 characters after trim()', () => {
    expect(
      CitationSchema.safeParse({ sha7: 'abc1234', quote: '   1234567   ' }).success,
    ).toBe(false);
  });

  it('accepts a quote of 500 characters and rejects 501 (untrimmed length)', () => {
    expect(QuoteSchema.safeParse('q'.repeat(500)).success).toBe(true);
    expect(QuoteSchema.safeParse('q'.repeat(501)).success).toBe(false);
    expect(QuoteSchema.safeParse(' '.repeat(493) + '12345678').success).toBe(false);
  });

  it('rejects sha7 that is not 7 chars', () => {
    const result = CitationSchema.safeParse({ sha7: 'abc123', quote: Q });
    expect(result.success).toBe(false);
  });

  it('rejects sha7 with uppercase hex', () => {
    const result = CitationSchema.safeParse({ sha7: 'ABC1234', quote: Q });
    expect(result.success).toBe(false);
  });

  it('rejects sha7 with non-hex chars', () => {
    const result = CitationSchema.safeParse({ sha7: 'zzzzzz1', quote: Q });
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
      citations: [{ sha7: 'abc1234', quote: Q }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a memory claim whose citation has no quote', () => {
    const result = MemoryClaimSchema.safeParse({
      kind: 'memory',
      text: 'I added this for legacy callers',
      citations: [{ sha7: 'abc1234' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects memory claim with empty citations array', () => {
    const result = MemoryClaimSchema.safeParse({
      kind: 'memory',
      text: 'Some text',
      citations: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts 10 citations and rejects 11', () => {
    const cite = { sha7: 'abc1234', quote: Q };
    const make = (n: number) => ({
      kind: 'memory',
      text: 't',
      citations: Array.from({ length: n }, () => cite),
    });
    expect(MemoryClaimSchema.safeParse(make(10)).success).toBe(true);
    expect(MemoryClaimSchema.safeParse(make(11)).success).toBe(false);
  });

  it('rejects memory claim with empty text', () => {
    const result = MemoryClaimSchema.safeParse({
      kind: 'memory',
      text: '',
      citations: [{ sha7: 'abc1234', quote: Q }],
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
      citations: [{ sha7: 'def5678', quote: Q }],
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

  it('rejects a speculation claim whose citation has no quote', () => {
    const result = SpeculationClaimSchema.safeParse({
      kind: 'speculation',
      text: 'Some guess',
      citations: [{ sha7: 'def5678' }],
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
      citations: [{ sha7: 'abc1234', quote: Q }],
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

  it('caps text at 300 characters', () => {
    const base = { kind: 'silence', citations: [], silenceReason: 'why' };
    expect(SilenceClaimSchema.safeParse({ ...base, text: 's'.repeat(300) }).success).toBe(
      true,
    );
    expect(SilenceClaimSchema.safeParse({ ...base, text: 's'.repeat(301) }).success).toBe(
      false,
    );
  });

  it('caps silenceReason at 300 characters', () => {
    const base = { kind: 'silence', citations: [], text: 'quiet' };
    expect(
      SilenceClaimSchema.safeParse({ ...base, silenceReason: 'r'.repeat(300) }).success,
    ).toBe(true);
    expect(
      SilenceClaimSchema.safeParse({ ...base, silenceReason: 'r'.repeat(301) }).success,
    ).toBe(false);
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
      citations: [{ sha7: 'def5678', quote: Q }],
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
// ClaimShapeSchema — lenient, used only inside the verifier for precise reasons
// ---------------------------------------------------------------------------

describe('ClaimShapeSchema', () => {
  it('lets a quoteless citation through so the verifier can name it (F6)', () => {
    const result = ClaimShapeSchema.safeParse({
      kind: 'memory',
      text: 't',
      citations: [{ sha7: 'abc1234' }],
    });
    expect(result.success).toBe(true);
  });

  it('still refuses an unknown kind and a non-string text', () => {
    expect(
      ClaimShapeSchema.safeParse({ kind: 'rumour', text: 't', citations: [] }).success,
    ).toBe(false);
    expect(
      ClaimShapeSchema.safeParse({ kind: 'memory', text: 1, citations: [] }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GhostAnswerSchema (strict) and GhostAnswerWireSchema (envelope only)
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
          citations: [{ sha7: 'def5678', quote: Q }],
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

  it('rejects GhostAnswer with more than 50 claims', () => {
    const claims = Array.from({ length: 51 }, () => validAnswer.claims[0]);
    expect(GhostAnswerSchema.safeParse({ ...validAnswer, claims }).success).toBe(false);
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
          citations: [{ sha7: 'abc1234', quote: Q }],
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
          citations: [{ sha7: 'abc1234', quote: Q }],
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

describe('GhostAnswerWireSchema (R1.8)', () => {
  const env = { voice: 'v', sessionId: 's' };

  it('refuses 0 claims', () => {
    expect(GhostAnswerWireSchema.safeParse({ ...env, claims: [] }).success).toBe(false);
  });

  it('refuses 51 claims and accepts 50', () => {
    const claim = { kind: 'memory', text: 't', citations: [] };
    expect(
      GhostAnswerWireSchema.safeParse({
        ...env,
        claims: Array.from({ length: 51 }, () => claim),
      }).success,
    ).toBe(false);
    expect(
      GhostAnswerWireSchema.safeParse({
        ...env,
        claims: Array.from({ length: 50 }, () => claim),
      }).success,
    ).toBe(true);
  });

  it('leaves each claim to the verifier, so a quoteless claim does not fail the envelope', () => {
    const result = GhostAnswerWireSchema.safeParse({
      ...env,
      claims: [{ kind: 'memory', text: 't', citations: [{ sha7: 'abc1234' }] }],
    });
    expect(result.success).toBe(true);
  });

  it('still requires a voice and a sessionId', () => {
    expect(
      GhostAnswerWireSchema.safeParse({ claims: [{}], voice: '', sessionId: 's' })
        .success,
    ).toBe(false);
    expect(GhostAnswerWireSchema.safeParse({ claims: [{}], voice: 'v' }).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// SummonResponseSchema
// ---------------------------------------------------------------------------

describe('SummonResponseSchema', () => {
  // first-seance T2 (design.md §7): items, lines, persona and shallow are required
  const valid = {
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    ledgerSize: 12,
    truncated: false,
    buildDurationMs: 847,
    items: [],
    lines: [{ n: 7, text: '  await sleep(3000);' }],
    persona: { author: 'Ada Lovelace', suspicious: false },
    shallow: false,
    // haunting-map T4 (design.md §3): the range the ledger was built for is required
    range: { startLine: 7, endLine: 7 },
  };

  it('accepts a valid SummonResponse', () => {
    const result = SummonResponseSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects a response without the first-seance fields, or without range (haunting-map R4.3)', () => {
    for (const key of ['items', 'lines', 'persona', 'shallow', 'range'] as const) {
      const { [key]: _drop, ...rest } = valid;
      expect(SummonResponseSchema.safeParse(rest).success).toBe(false);
    }
  });

  it('requires persona.suspicious as a boolean (first-seance R2.5)', () => {
    const persona = (p: unknown) =>
      SummonResponseSchema.safeParse({ ...valid, persona: p });
    expect(persona({ author: 'Ada Lovelace' }).success).toBe(false);
    expect(persona({ author: 'Ada Lovelace', suspicious: 'yes' }).success).toBe(false);
    expect(persona({ author: 'Ada Lovelace', suspicious: true }).success).toBe(true);
  });

  it('rejects more than 40 lines, a line over 400 characters, and an empty author', () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ n: i + 1, text: '' }));
    expect(SummonResponseSchema.safeParse({ ...valid, lines: many }).success).toBe(false);
    expect(
      SummonResponseSchema.safeParse({
        ...valid,
        lines: [{ n: 1, text: 'x'.repeat(401) }],
      }).success,
    ).toBe(false);
    expect(
      SummonResponseSchema.safeParse({ ...valid, persona: { author: '' } }).success,
    ).toBe(false);
  });

  it('rejects non-UUID sessionId', () => {
    const result = SummonResponseSchema.safeParse({
      ...valid,
      sessionId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VerifiedAnswerResponseSchema (R2.1, R4.3, R6.4)
// ---------------------------------------------------------------------------

describe('VerifiedAnswerResponseSchema', () => {
  const valid = {
    sessionId: 'session-abc',
    voice: 'Ada Lovelace',
    verified: [
      {
        text: 'I added the delay.',
        kind: 'memory',
        citations: [{ sha7: 'abc1234', quote: Q }],
        speculative: false,
        quotes: [{ sha7: 'abc1234', quote: Q, field: 'body' }],
        citesSuspicious: false,
      },
    ],
    rejected: [{ text: 'bad', kind: 'memory', reason: 'r', citesSuspicious: true }],
    silent: [{ text: 'quiet', silenceReason: 'why' }],
    tally: { verified: 1, checked: 2, silent: 1 },
    score: 1 / 3,
    report: '# Ward report\n**1 of 2 claims passed the ward**',
  };

  it('accepts a valid VerifiedAnswerResponse', () => {
    expect(VerifiedAnswerResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a response without sessionId (/api/ward)', () => {
    const { sessionId: _, ...noSession } = valid;
    expect(VerifiedAnswerResponseSchema.safeParse(noSession).success).toBe(true);
  });

  it('requires quotes on every verified entry, with at least one quote', () => {
    const { quotes: _, ...noQuotes } = valid.verified[0]!;
    expect(
      VerifiedAnswerResponseSchema.safeParse({ ...valid, verified: [noQuotes] }).success,
    ).toBe(false);
    expect(
      VerifiedAnswerResponseSchema.safeParse({
        ...valid,
        verified: [{ ...valid.verified[0], quotes: [] }],
      }).success,
    ).toBe(false);
  });

  it('refuses a quote field other than subject, body or hunk', () => {
    expect(
      VerifiedAnswerResponseSchema.safeParse({
        ...valid,
        verified: [
          {
            ...valid.verified[0],
            quotes: [{ sha7: 'abc1234', quote: Q, field: 'joined' }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('refuses a silence claim in verified', () => {
    expect(
      VerifiedAnswerResponseSchema.safeParse({
        ...valid,
        verified: [{ ...valid.verified[0], kind: 'silence' }],
      }).success,
    ).toBe(false);
  });

  it('requires silent', () => {
    const { silent: _, ...noSilent } = valid;
    expect(VerifiedAnswerResponseSchema.safeParse(noSilent).success).toBe(false);
  });

  it('requires tally', () => {
    const { tally: _, ...noTally } = valid;
    expect(VerifiedAnswerResponseSchema.safeParse(noTally).success).toBe(false);
  });

  it('requires citesSuspicious on verified and rejected entries', () => {
    const { citesSuspicious: _v, ...v } = valid.verified[0]!;
    const { citesSuspicious: _r, ...r } = valid.rejected[0]!;
    expect(
      VerifiedAnswerResponseSchema.safeParse({ ...valid, verified: [v] }).success,
    ).toBe(false);
    expect(
      VerifiedAnswerResponseSchema.safeParse({ ...valid, rejected: [r] }).success,
    ).toBe(false);
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
        citations: [{ sha7: 'abc1234', quote: 'fix race condition' }],
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
        citations: [{ sha7: 'abc1234', quote: 'fix race condition' }],
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
        citations: [{ sha7: 'abc1234', quote: 'fix race condition' }],
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

describe('plan claims: model output vs verified output', () => {
  const step = {
    description: 'Add a comment',
    rationale: 'Keeps the reason',
    claims: [] as unknown[],
    rejectedClaims: [],
    reversible: true,
  };
  it('the model must cite at least one claim per step', async () => {
    const { RefactorStepSchema } = await import('../../src/ghost/schema.js');
    expect(RefactorStepSchema.safeParse(step).success).toBe(false);
  });
  it('the model may send at most MAX_CLAIMS claims per step (ward-hardening T2)', async () => {
    const { RefactorStepSchema, MAX_CLAIMS } = await import('../../src/ghost/schema.js');
    const claim = { kind: 'memory', text: 't', citations: [] };
    expect(
      RefactorStepSchema.safeParse({ ...step, claims: Array(MAX_CLAIMS).fill(claim) })
        .success,
    ).toBe(true);
    expect(
      RefactorStepSchema.safeParse({ ...step, claims: Array(MAX_CLAIMS + 1).fill(claim) })
        .success,
    ).toBe(false);
  });
  it('a shown plan step needs a verified claim; a dropped entry carries none (ward-hardening T2)', async () => {
    type Parser = { safeParse(v: unknown): { success: boolean } };
    const {
      PlanStepResponseSchema,
      PlanDroppedResponseSchema,
      VerifiedRefactorStepSchema,
    } = (await import('../../src/ghost/schema.js')) as unknown as {
      PlanStepResponseSchema: Parser;
      PlanDroppedResponseSchema: Parser;
      VerifiedRefactorStepSchema?: unknown;
    };
    expect(VerifiedRefactorStepSchema).toBeUndefined();
    expect(
      PlanStepResponseSchema.safeParse({
        description: 'Add a comment',
        rationale: 'Keeps the reason',
        reversible: true,
        claims: [],
        rejectedClaims: [],
      }).success,
    ).toBe(false);
    expect(
      PlanDroppedResponseSchema.safeParse({
        kind: 'step',
        title: 'Add a comment',
        modelText: 'Keeps the reason',
        dropReason: 'None of the claims behind this step passed the ward.',
        rejectedClaims: [
          { text: 't', kind: 'memory', reason: 'r', citesSuspicious: false },
        ],
      }).success,
    ).toBe(true);
  });
});
