/**
 * T2 — Property-based tests for the ward report renderer (P1–P4).
 *
 * fast-check: 1 000 runs per property; fixed seed via FAST_CHECK_SEED env var.
 *
 * P1 (R1.2): count line matches input lengths for any generated VerifierResult.
 * P2 (R1.5): every rejected claim's escaped text appears between ~~ markers,
 *            and the struck heading appears iff rejected.length > 0.
 * P3 (R1.6): for any string, escapeMd output contains no newline and no
 *            unescaped structural character.
 * P4 (R1.7): rendering twice gives the same string; input is unchanged
 *            (deep-equal to a structured clone).
 */

import { describe, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { renderWardReport, escapeMd } from '../../../src/ghost/report.js';
import type { VerifierResult, VerifiedClaim, RejectedClaim, Claim } from '../../../src/ghost/schema.js';

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

/** 7-char lowercase hex sha7 — already validates clean per CitationSchema */
const sha7Arb: fc.Arbitrary<string> = fc
  .hexaString({ minLength: 7, maxLength: 7 })
  .map((s) => s.toLowerCase());

const citationWithQuoteArb = sha7Arb.chain((sha7) =>
  fc.string({ minLength: 1, maxLength: 80 }).map((quote) => ({ sha7, quote })),
);

const citationNoQuoteArb = sha7Arb.map((sha7) => ({ sha7 }));

const citationArb = fc.oneof(citationWithQuoteArb, citationNoQuoteArb);

const memoryClaimArb: fc.Arbitrary<Claim> = fc
  .record({
    text: fc.string({ minLength: 1, maxLength: 200 }),
    citations: fc.array(citationArb, { minLength: 1, maxLength: 3 }),
  })
  .map(({ text, citations }) => ({ kind: 'memory' as const, text, citations }));

const speculationClaimArb: fc.Arbitrary<Claim> = fc
  .record({
    text: fc.string({ minLength: 1, maxLength: 200 }),
    citations: fc.array(citationArb, { minLength: 1, maxLength: 3 }),
  })
  .map(({ text, citations }) => ({ kind: 'speculation' as const, text, citations }));

const silenceClaimArb: fc.Arbitrary<Claim> = fc
  .record({
    text: fc.string({ minLength: 1, maxLength: 200 }),
    silenceReason: fc.string({ minLength: 1, maxLength: 200 }),
  })
  .map(({ text, silenceReason }) => ({
    kind: 'silence' as const,
    text,
    citations: [] as [],
    silenceReason,
  }));

const claimArb: fc.Arbitrary<Claim> = fc.oneof(
  memoryClaimArb,
  speculationClaimArb,
  silenceClaimArb,
);

const verifiedClaimArb: fc.Arbitrary<VerifiedClaim> = fc
  .record({
    claim: claimArb,
    speculative: fc.boolean(),
  });

const rejectedClaimArb: fc.Arbitrary<RejectedClaim> = fc
  .record({
    claim: claimArb,
    reason: fc.string({ minLength: 1, maxLength: 200 }),
  });

/** A VerifierResult with arbitrary verified / rejected arrays */
const verifierResultArb: fc.Arbitrary<VerifierResult> = fc
  .record({
    verified: fc.array(verifiedClaimArb, { minLength: 0, maxLength: 10 }),
    rejected: fc.array(rejectedClaimArb, { minLength: 0, maxLength: 10 }),
  })
  .map(({ verified, rejected }) => {
    const total = verified.length + rejected.length;
    const score = total === 0 ? 1 : verified.length / total;
    return { verified, rejected, score };
  });

// ---------------------------------------------------------------------------
// P1 — Count line matches input lengths
// ---------------------------------------------------------------------------

describe('P1 — count line matches input lengths', () => {
  test.prop([verifierResultArb], fcParams)(
    '**N of M claims verified** matches verified.length and total',
    (result) => {
      const report = renderWardReport(result);
      const n = result.verified.length;
      const m = result.verified.length + result.rejected.length;
      expect(report).toContain(`**${n} of ${m} claims verified**`);
    },
  );
});

// ---------------------------------------------------------------------------
// P2 — Rejected claims in ~~ and struck heading iff rejected.length > 0
// ---------------------------------------------------------------------------

describe('P2 — rejected claims rendered with ~~ and heading iff non-empty', () => {
  test.prop([verifierResultArb], fcParams)(
    'struck heading present iff rejected.length > 0',
    (result) => {
      const report = renderWardReport(result);
      if (result.rejected.length > 0) {
        expect(report).toContain('## Struck by the ward');
      } else {
        expect(report).not.toContain('## Struck by the ward');
      }
    },
  );

  test.prop([verifierResultArb.filter((r) => r.rejected.length > 0)], fcParams)(
    "every rejected claim's escaped text appears between ~~ markers",
    (result) => {
      const report = renderWardReport(result);
      for (const rc of result.rejected) {
        const escaped = escapeMd(rc.claim.text);
        expect(report).toContain(`~~${escaped}~~`);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// P3 — escapeMd output has no newline and no unescaped structural character
// ---------------------------------------------------------------------------

describe('P3 — escapeMd output is free of newlines and unescaped structural chars', () => {
  test.prop([fc.string()], fcParams)(
    'output has no \\n, \\r',
    (input) => {
      const out = escapeMd(input);
      expect(out).not.toMatch(/[\n\r]/);
    },
  );

  /**
   * "Unescaped" means the character appears without a preceding backslash.
   * We check each structural char with a negative lookbehind.
   *
   * Chars under test: ` ~ * _ [ ] < > |
   * (backslash itself is always escaped to \\, so a lone \ only appears as
   * an escape prefix, not as a bare character in the output)
   */
  const STRUCTURAL = ['`', '~', '*', '_', '[', ']', '<', '>', '|'] as const;

  for (const ch of STRUCTURAL) {
    test.prop([fc.string()], fcParams)(
      `output has no unescaped '${ch}'`,
      (input) => {
        const out = escapeMd(input);
        // An unescaped structural char is one NOT preceded by a backslash.
        // We match the char, then verify every occurrence is preceded by \.
        const positions: number[] = [];
        for (let i = 0; i < out.length; i++) {
          if (out[i] === ch) positions.push(i);
        }
        for (const pos of positions) {
          // Count consecutive preceding backslashes
          let backslashes = 0;
          let p = pos - 1;
          while (p >= 0 && out[p] === '\\') {
            backslashes++;
            p--;
          }
          // An even number of backslashes means the char is unescaped
          expect(backslashes % 2, `char '${ch}' at pos ${pos} in "${out}" is unescaped`).toBe(1);
        }
      },
    );
  }
});

// ---------------------------------------------------------------------------
// P4 — Determinism and input immutability
// ---------------------------------------------------------------------------

describe('P4 — determinism and input immutability', () => {
  test.prop([verifierResultArb], fcParams)(
    'rendering twice gives identical strings',
    (result) => {
      const r1 = renderWardReport(result);
      const r2 = renderWardReport(result);
      expect(r1).toBe(r2);
    },
  );

  test.prop([verifierResultArb], fcParams)(
    'input is unchanged after rendering (deep equal to structured clone)',
    (result) => {
      const clone = structuredClone(result);
      renderWardReport(result);
      expect(result).toEqual(clone);
    },
  );
});
