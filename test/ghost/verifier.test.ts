/**
 * T2 unit tests for src/ghost/verifier.ts
 */

import { describe, it, expect } from 'vitest';
import { verify } from '../../src/ghost/verifier.js';
import type { EvidenceItem, GhostAnswer } from '../../src/ghost/schema.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHA_40 = 'abc1234' + '0'.repeat(33);
const SHA_40_B = 'def5678' + '0'.repeat(33);

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
    hunk: '@@ -1,5 +1,6 @@\n+sleep(3000);\n',
    files: ['src/utils.ts'],
    refs: [],
    suspiciousMessage: false,
    ...overrides,
  });
}

function makeAnswer(claims: GhostAnswer['claims'], sessionId = 'sess-1'): GhostAnswer {
  return {
    claims,
    voice: 'Ada Lovelace, terse',
    sessionId,
  };
}

// ---------------------------------------------------------------------------
// Memory claim — passing cases
// ---------------------------------------------------------------------------

describe('verify — memory claims', () => {
  it('passes when SHA and quote are both present in ledger', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      {
        kind: 'memory',
        text: 'I added the sleep.',
        citations: [{ sha7: 'abc1234', quote: 'wait for downstream to stabilise' }],
      },
    ]);

    const result = verify(ledger, answer);

    expect(result.verified).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.score).toBe(1);
    expect(result.verified[0]?.speculative).toBe(false);
  });

  it('passes when SHA is present and no quote is provided', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      {
        kind: 'memory',
        text: 'I added the sleep.',
        citations: [{ sha7: 'abc1234' }],
      },
    ]);

    const result = verify(ledger, answer);

    expect(result.verified).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('rejected when SHA is absent from ledger', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      {
        kind: 'memory',
        text: 'Some claim',
        citations: [{ sha7: 'fff0000' }],
      },
    ]);

    const result = verify(ledger, answer);

    expect(result.verified).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('fff0000');
  });

  it('rejected when quote is not a substring of evidence text', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      {
        kind: 'memory',
        text: 'Some claim',
        citations: [{ sha7: 'abc1234', quote: 'this text does not appear in evidence' }],
      },
    ]);

    const result = verify(ledger, answer);

    expect(result.verified).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('abc1234');
  });

  it('quote check is case-sensitive', () => {
    const ledger = [makeItem()];
    // The evidence says "wait for downstream" — uppercase version should fail
    const answer = makeAnswer([
      {
        kind: 'memory',
        text: 'Some claim',
        citations: [{ sha7: 'abc1234', quote: 'Wait For Downstream To Stabilise' }],
      },
    ]);

    const result = verify(ledger, answer);

    expect(result.rejected).toHaveLength(1);
  });

  it('quote is checked against subject + body + hunk concatenated', () => {
    const ledger = [makeItem()];
    // Quote spans the hunk content
    const answer = makeAnswer([
      {
        kind: 'memory',
        text: 'The hunk shows addition',
        citations: [{ sha7: 'abc1234', quote: '+sleep(3000);' }],
      },
    ]);

    const result = verify(ledger, answer);
    expect(result.verified).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Speculation claims
// ---------------------------------------------------------------------------

describe('verify — speculation claims', () => {
  it('passes with valid citation and flags speculative=true', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      {
        kind: 'speculation',
        text: 'This might be related to a race condition.',
        citations: [{ sha7: 'abc1234' }],
      },
    ]);

    const result = verify(ledger, answer);

    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]?.speculative).toBe(true);
  });

  it('rejected when SHA not in ledger', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      {
        kind: 'speculation',
        text: 'Some speculation',
        citations: [{ sha7: '0000000' }],
      },
    ]);

    const result = verify(ledger, answer);

    expect(result.rejected).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Silence claims
// ---------------------------------------------------------------------------

describe('verify — silence claims', () => {
  it('passes when silenceReason is non-empty', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      {
        kind: 'silence',
        text: 'The record is silent.',
        citations: [],
        silenceReason: 'No commits mention this behaviour',
      },
    ]);

    const result = verify(ledger, answer);

    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]?.speculative).toBe(false);
  });

  it('rejected when silenceReason is empty (bypass schema)', () => {
    const ledger = [makeItem()];
    // Bypass schema by casting to test defence-in-depth with empty string
    const claim = {
      kind: 'silence' as const,
      text: 'The record is silent.',
      citations: [] as [],
      silenceReason: '', // empty string — bypass Zod min(1)
    };
    const answer: GhostAnswer = {
      claims: [claim],
      voice: 'Test',
      sessionId: 'sess-1',
    };

    const result = verify(ledger, answer);

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('silenceReason');
  });
});

// ---------------------------------------------------------------------------
// Mixed-kind answers
// ---------------------------------------------------------------------------

describe('verify — mixed answers', () => {
  it('handles all three kinds in one answer correctly', () => {
    const item2 = makeItem({ id: 'E2', sha: SHA_40_B, shortSha: 'def5678' });
    const ledger = [makeItem(), item2];

    const answer = makeAnswer([
      {
        kind: 'memory',
        text: 'Memory claim',
        citations: [{ sha7: 'abc1234' }],
      },
      {
        kind: 'speculation',
        text: 'Speculation claim',
        citations: [{ sha7: 'def5678' }],
      },
      {
        kind: 'silence',
        text: 'Silence claim',
        citations: [],
        silenceReason: 'Nothing relevant',
      },
      {
        kind: 'memory',
        text: 'Bad memory claim',
        citations: [{ sha7: 'zzz9999' }], // not in ledger
      },
    ]);

    const result = verify(ledger, answer);

    expect(result.verified).toHaveLength(3);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('zzz9999');
    expect(result.score).toBeCloseTo(3 / 4);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('verify — edge cases', () => {
  it('empty claims array (schema-bypassed) → score === 1', () => {
    const ledger = [makeItem()];
    // Force empty claims past schema
    const answer = {
      claims: [],
      voice: 'Test',
      sessionId: 'sess-1',
    } as unknown as GhostAnswer;

    const result = verify(ledger, answer);

    expect(result.score).toBe(1);
    expect(result.verified).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it('preserves claim insertion order across verified and rejected', () => {
    const ledger = [makeItem()];
    // Two valid, then one bad, then one valid
    const answer = makeAnswer([
      { kind: 'memory', text: 'Claim 1', citations: [{ sha7: 'abc1234' }] },
      { kind: 'memory', text: 'Claim 2', citations: [{ sha7: 'abc1234' }] },
      { kind: 'memory', text: 'Claim 3 (bad)', citations: [{ sha7: 'zzz9999' }] },
      { kind: 'memory', text: 'Claim 4', citations: [{ sha7: 'abc1234' }] },
    ]);

    const result = verify(ledger, answer);

    expect(result.verified.map((v) => v.claim.text)).toEqual([
      'Claim 1',
      'Claim 2',
      'Claim 4',
    ]);
    expect(result.rejected.map((r) => r.claim.text)).toEqual(['Claim 3 (bad)']);
  });

  it('result is frozen', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      { kind: 'memory', text: 'Claim', citations: [{ sha7: 'abc1234' }] },
    ]);

    const result = verify(ledger, answer);

    expect(Object.isFrozen(result)).toBe(true);
  });

  it('score is 0 when all claims are rejected', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      { kind: 'memory', text: 'Bad', citations: [{ sha7: 'zzz0000' }] },
      { kind: 'memory', text: 'Also bad', citations: [{ sha7: 'zzz1111' }] },
    ]);

    const result = verify(ledger, answer);

    expect(result.score).toBe(0);
  });

  it('author mismatch adds to reason string but does not independently reject a passing claim', () => {
    // The design spec says author/date corroboration is a warning-only check (no rejection).
    // A claim with a valid SHA must still pass even if the claim text mentions a different author.
    const ledger = [makeItem({ author: 'Ada Lovelace' })];
    const answer = makeAnswer([
      {
        kind: 'memory',
        text: 'Charles Babbage wrote this sleep (wrong author in text)',
        citations: [{ sha7: 'abc1234' }],
      },
    ]);

    const result = verify(ledger, answer);

    // Should still be verified — author mismatch is warning-only per design §3
    expect(result.verified).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });
});
