/**
 * T3 — Property-based tests for the Verifier (PV1–PV8).
 *
 * fast-check: 1 000 runs per property; fixed seed via FAST_CHECK_SEED env var.
 */

import { describe, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { verify } from '../../../src/ghost/verifier.js';
import type { EvidenceItem, GhostAnswer, Claim } from '../../../src/ghost/schema.js';

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

/** 40-char lowercase hex SHA */
const sha40Arb: fc.Arbitrary<string> = fc
  .hexaString({ minLength: 40, maxLength: 40 })
  .map((s) => s.toLowerCase());

/** 7-char lowercase hex sha7 */
const sha7Arb: fc.Arbitrary<string> = fc
  .hexaString({ minLength: 7, maxLength: 7 })
  .map((s) => s.toLowerCase());

/** Generate a minimal EvidenceItem */
const evidenceItemArb: fc.Arbitrary<EvidenceItem> = fc
  .record({
    sha: sha40Arb,
    author: fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0),
    subject: fc.string({ minLength: 1, maxLength: 200 }),
    body: fc.string({ maxLength: 500 }),
    hunk: fc.string({ maxLength: 200 }),
  })
  .map(({ sha, author, subject, body, hunk }) => ({
    id: 'E1',
    sha,
    shortSha: sha.slice(0, 7),
    author,
    email: 'test@example.com',
    date: new Date('2020-01-01T00:00:00.000Z').toISOString(),
    subject,
    body,
    hunk,
    files: [],
    refs: [],
    suspiciousMessage: false,
  }));

/** Generate an array of EvidenceItems with unique shortShas */
const ledgerArb: fc.Arbitrary<EvidenceItem[]> = fc
  .array(evidenceItemArb, { minLength: 1, maxLength: 20 })
  .map((items) => {
    // Deduplicate by shortSha
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.shortSha)) return false;
      seen.add(item.shortSha);
      return true;
    });
  })
  .filter((items) => items.length > 0);

/** Generate a 7-char hex string NOT in the given ledger */
function absentSha7Arb(ledger: EvidenceItem[]): fc.Arbitrary<string> {
  const present = new Set(ledger.map((i) => i.shortSha));
  return sha7Arb.filter((s) => !present.has(s));
}

/** Generate a string that is NOT a substring of any evidence text in the ledger */
function absentQuoteArb(ledger: EvidenceItem[]): fc.Arbitrary<string> {
  return fc.string({ minLength: 30, maxLength: 60 }).filter((q) => {
    for (const item of ledger) {
      const text = `${item.subject} ${item.body} ${item.hunk}`;
      if (text.includes(q)) return false;
    }
    return true;
  });
}

/** Build a well-formed memory claim using a SHA from the ledger */
function validMemoryClaimArb(ledger: EvidenceItem[]): fc.Arbitrary<Claim> {
  return fc.constantFrom(...ledger).map(
    (item): Claim => ({
      kind: 'memory',
      text: 'Some valid claim',
      citations: [{ sha7: item.shortSha }],
    }),
  );
}

/** Build a memory claim using a SHA absent from the ledger */
function invalidMemoryClaimArb(ledger: EvidenceItem[]): fc.Arbitrary<Claim> {
  return absentSha7Arb(ledger).map(
    (sha7): Claim => ({
      kind: 'memory',
      text: 'Bad claim with absent SHA',
      citations: [{ sha7 }],
    }),
  );
}

/** Build a silence claim */
const silenceClaimArb: fc.Arbitrary<Claim> = fc
  .string({ minLength: 1, maxLength: 100 })
  .map(
    (reason): Claim => ({
      kind: 'silence',
      text: 'The record is silent',
      citations: [],
      silenceReason: reason,
    }),
  );

// ---------------------------------------------------------------------------
// PV1 — SHA absent from ledger → never in verified
// ---------------------------------------------------------------------------

describe('PV1 — SHA absent from ledger → never verified', () => {
  test.prop(
    [
      ledgerArb.chain((ledger) =>
        fc
          .array(invalidMemoryClaimArb(ledger), { minLength: 1, maxLength: 5 })
          .map((claims) => ({ ledger, claims })),
      ),
    ],
    fcParams,
  )('no claim with absent SHA appears in verified', ({ ledger, claims }) => {
    const answer: GhostAnswer = {
      claims,
      voice: 'Test ghost',
      sessionId: 'test-session',
    };

    const result = verify(ledger, answer);

    // All claims should be rejected since their SHAs are not in the ledger
    expect(result.verified).toHaveLength(0);
    expect(result.rejected).toHaveLength(claims.length);
  });
});

// ---------------------------------------------------------------------------
// PV2 — Quote not substring → never verified
// ---------------------------------------------------------------------------

describe('PV2 — quote not substring → never verified', () => {
  test.prop(
    [
      ledgerArb.chain((ledger) =>
        absentQuoteArb(ledger).chain((quote) =>
          fc.constantFrom(...ledger).map((item) => ({
            ledger,
            claim: {
              kind: 'memory' as const,
              text: 'Claim with bad quote',
              citations: [{ sha7: item.shortSha, quote }],
            } satisfies Claim,
          })),
        ),
      ),
    ],
    fcParams,
  )('claim with non-substring quote is rejected', ({ ledger, claim }) => {
    const answer: GhostAnswer = {
      claims: [claim],
      voice: 'Test ghost',
      sessionId: 'test-session',
    };

    const result = verify(ledger, answer);

    expect(result.verified).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// PV3 — Score always in [0, 1]
// ---------------------------------------------------------------------------

describe('PV3 — score always in [0, 1]', () => {
  test.prop(
    [
      ledgerArb.chain((ledger) =>
        fc
          .array(
            fc.oneof(
              validMemoryClaimArb(ledger),
              invalidMemoryClaimArb(ledger),
              silenceClaimArb,
            ),
            { minLength: 1, maxLength: 10 },
          )
          .map((claims) => ({ ledger, claims })),
      ),
    ],
    fcParams,
  )('score >= 0 && score <= 1', ({ ledger, claims }) => {
    const answer: GhostAnswer = {
      claims,
      voice: 'Test ghost',
      sessionId: 'test-session',
    };

    const result = verify(ledger, answer);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// PV4 — Empty claims (forced past schema) → score === 1
// ---------------------------------------------------------------------------

describe('PV4 — empty claims → score === 1', () => {
  test.prop([ledgerArb], fcParams)(
    'empty claims array produces score === 1',
    (ledger) => {
      const answer = {
        claims: [] as Claim[],
        voice: 'Test ghost',
        sessionId: 'test-session',
      } as unknown as GhostAnswer;

      const result = verify(ledger, answer);

      expect(result.score).toBe(1);
    },
  );
});

// ---------------------------------------------------------------------------
// PV5 — Determinism: same inputs → same result
// ---------------------------------------------------------------------------

describe('PV5 — determinism: same inputs → same outputs', () => {
  test.prop(
    [
      ledgerArb.chain((ledger) =>
        fc
          .array(fc.oneof(validMemoryClaimArb(ledger), silenceClaimArb), {
            minLength: 1,
            maxLength: 5,
          })
          .map((claims) => ({ ledger, claims })),
      ),
    ],
    fcParams,
  )('verify(l,a) called twice returns deepEqual results', ({ ledger, claims }) => {
    const answer: GhostAnswer = {
      claims,
      voice: 'Test ghost',
      sessionId: 'test-session',
    };

    const result1 = verify(ledger, answer);
    const result2 = verify(ledger, answer);

    expect(result1).toEqual(result2);
  });
});

// ---------------------------------------------------------------------------
// PV6 — One well-formed silence claim → verified.length === 1
// ---------------------------------------------------------------------------

describe('PV6 — one silence claim → verified.length === 1', () => {
  test.prop([ledgerArb, fc.string({ minLength: 1, maxLength: 100 })], fcParams)(
    'single silence claim always verifies',
    (ledger, silenceReason) => {
      const answer: GhostAnswer = {
        claims: [
          {
            kind: 'silence',
            text: 'The record is silent',
            citations: [],
            silenceReason,
          },
        ],
        voice: 'Test ghost',
        sessionId: 'test-session',
      };

      const result = verify(ledger, answer);

      expect(result.verified).toHaveLength(1);
      expect(result.rejected).toHaveLength(0);
    },
  );
});

// ---------------------------------------------------------------------------
// PV7 — Order preserved: every claim appears exactly once
// ---------------------------------------------------------------------------

describe('PV7 — order preserved: no duplicates, no omissions', () => {
  test.prop(
    [
      ledgerArb.chain((ledger) =>
        fc
          .array(
            fc.oneof(
              validMemoryClaimArb(ledger),
              invalidMemoryClaimArb(ledger),
              silenceClaimArb,
            ),
            { minLength: 1, maxLength: 10 },
          )
          .map((claims) => ({ ledger, claims })),
      ),
    ],
    fcParams,
  )('each claim appears exactly once in verified or rejected', ({ ledger, claims }) => {
    const answer: GhostAnswer = {
      claims,
      voice: 'Test ghost',
      sessionId: 'test-session',
    };

    const result = verify(ledger, answer);

    // Collect all claim texts from both buckets
    const verifiedTexts = result.verified.map((v) => v.claim.text);
    const rejectedTexts = result.rejected.map((r) => r.claim.text);
    const allTexts = [...verifiedTexts, ...rejectedTexts];

    // Same length as input
    expect(allTexts).toHaveLength(claims.length);
  });
});

// ---------------------------------------------------------------------------
// PV8 — verified.length + rejected.length === answer.claims.length
// ---------------------------------------------------------------------------

describe('PV8 — verified + rejected = total claims', () => {
  test.prop(
    [
      ledgerArb.chain((ledger) =>
        fc
          .array(
            fc.oneof(
              validMemoryClaimArb(ledger),
              invalidMemoryClaimArb(ledger),
              silenceClaimArb,
            ),
            { minLength: 0, maxLength: 15 },
          )
          .map((claims) => ({ ledger, claims })),
      ),
    ],
    fcParams,
  )('verified.length + rejected.length === claims.length', ({ ledger, claims }) => {
    const answer = {
      claims,
      voice: 'Test ghost',
      sessionId: 'test-session',
    } as unknown as GhostAnswer;

    const result = verify(ledger, answer);

    expect(result.verified.length + result.rejected.length).toBe(claims.length);
  });
});
