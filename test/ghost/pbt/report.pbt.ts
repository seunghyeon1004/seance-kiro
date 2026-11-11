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
import type {
  VerifierResult,
  VerifiedClaim,
  RejectedClaim,
  SilentClaim,
  CheckedClaim,
  Claim,
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

/** 7-char lowercase hex sha7 — already validates clean per CitationSchema */
const sha7Arb: fc.Arbitrary<string> = fc
  .hexaString({ minLength: 7, maxLength: 7 })
  .map((s) => s.toLowerCase());

/** Quotes are mandatory (ward-hardening R1.1) */
const citationArb = sha7Arb.chain((sha7) =>
  fc.string({ minLength: 8, maxLength: 80 }).map((quote) => ({ sha7, quote })),
);

const memoryClaimArb: fc.Arbitrary<CheckedClaim> = fc
  .record({
    text: fc.string({ minLength: 1, maxLength: 200 }),
    citations: fc.array(citationArb, { minLength: 1, maxLength: 3 }),
  })
  .map(({ text, citations }) => ({ kind: 'memory' as const, text, citations }));

const speculationClaimArb: fc.Arbitrary<CheckedClaim> = fc
  .record({
    text: fc.string({ minLength: 1, maxLength: 200 }),
    citations: fc.array(citationArb, { minLength: 1, maxLength: 3 }),
  })
  .map(({ text, citations }) => ({ kind: 'speculation' as const, text, citations }));

const silenceClaimArb = fc
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
    index: fc.nat(100),
    claim: fc.oneof(memoryClaimArb, speculationClaimArb),
    speculative: fc.boolean(),
  })
  .map((v) => ({
    ...v,
    quotes: v.claim.citations.map((c) => ({ ...c, field: 'body' as const })),
  }));

const rejectedClaimArb: fc.Arbitrary<RejectedClaim> = fc
  .record({
    index: fc.nat(100),
    claim: fc.option(claimArb, { nil: null }),
    text: fc.string({ maxLength: 200 }),
    reason: fc.string({ minLength: 1, maxLength: 200 }),
  })
  .map(({ index, claim, text, reason }) => ({
    index,
    claim,
    kind: claim?.kind ?? 'unknown',
    text: claim?.text ?? text,
    citedSha7s: claim?.citations.map((c) => c.sha7) ?? [],
    reason,
  }));

const silentClaimArb: fc.Arbitrary<SilentClaim> = fc.record({
  index: fc.nat(100),
  claim: silenceClaimArb,
});

/** A VerifierResult with arbitrary verified / rejected / silent arrays */
const verifierResultArb: fc.Arbitrary<VerifierResult> = fc
  .record({
    verified: fc.array(verifiedClaimArb, { minLength: 0, maxLength: 10 }),
    rejected: fc.array(rejectedClaimArb, { minLength: 0, maxLength: 10 }),
    silent: fc.array(silentClaimArb, { minLength: 0, maxLength: 5 }),
  })
  .map(({ verified, rejected, silent }) => {
    const total = verified.length + rejected.length + silent.length;
    const score = total === 0 ? 1 : verified.length / total;
    return { verified, rejected, silent, score };
  });

// ---------------------------------------------------------------------------
// P1 — Count line matches input lengths
// ---------------------------------------------------------------------------

describe('P1 — count line matches input lengths', () => {
  test.prop([verifierResultArb], fcParams)(
    '**N of M claims passed the ward** matches verified.length and total',
    (result) => {
      const report = renderWardReport(result);
      const n = result.verified.length;
      const m = result.verified.length + result.rejected.length;
      expect(report).toContain(`**${n} of ${m} claims passed the ward**`);
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
        const escaped = escapeMd(rc.text);
        expect(report).toContain(`~~${escaped}~~`);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// P3 — escapeMd output has no newline and no unescaped structural character
// ---------------------------------------------------------------------------

describe('P3 — escapeMd output is free of newlines and unescaped structural chars', () => {
  test.prop([fc.string()], fcParams)('output has no \\n, \\r', (input) => {
    const out = escapeMd(input);
    expect(out).not.toMatch(/[\n\r]/);
  });

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
    test.prop([fc.string()], fcParams)(`output has no unescaped '${ch}'`, (input) => {
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
        expect(
          backslashes % 2,
          `char '${ch}' at pos ${pos} in "${out}" is unescaped`,
        ).toBe(1);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// P5 — bidi controls (ward-hardening R11.9)
// ---------------------------------------------------------------------------

describe('P5 — escapeMd leaves no bidi embedding, override, isolate or mark (R11.9, R12.10)', () => {
  const BIDI = [
    '\u061C',
    '\u200E',
    '\u200F',
    '\u202A',
    '\u202B',
    '\u202C',
    '\u202D',
    '\u202E',
    '\u2066',
    '\u2067',
    '\u2068',
    '\u2069',
  ];
  const withBidi = fc
    .array(fc.oneof(fc.constantFrom(...BIDI), fc.string({ maxLength: 4 })), {
      maxLength: 30,
    })
    .map((a) => a.join(''));

  test.prop([withBidi], fcParams)(
    'no control survives, and each becomes one visible \\uXXXX escape',
    (input) => {
      const out = escapeMd(input);
      expect(out).not.toMatch(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/);
      const controls = [...input].filter((ch) => BIDI.includes(ch)).length;
      const escapes =
        out.match(/(?<!\\)(?:\\\\)*\\u(?:061C|200[EF]|202[A-E]|206[6-9])/g) ?? [];
      expect(escapes.length).toBe(controls);
    },
  );
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

// ---------------------------------------------------------------------------
// ward-hardening T3 — limit line and silence section (R2.4, R4.3, R4.6)
// ---------------------------------------------------------------------------

const LIMIT_LINE =
  'The ward checked each citation and quote, not the wording of the claims.';
const SILENCE_HEADING = '## The record is silent (not checked)';

describe('ward-hardening T3 — limit line and silence section', () => {
  test.prop([verifierResultArb], fcParams)(
    'the line directly after the count line is the limit line (R2.4)',
    (result) => {
      const lines = renderWardReport(result).split('\n');
      const n = result.verified.length;
      const m = result.verified.length + result.rejected.length;
      const i = lines.indexOf(`**${n} of ${m} claims passed the ward**`);
      expect(i).toBeGreaterThan(0);
      expect(lines[i + 1]).toBe(LIMIT_LINE);
    },
  );

  test.prop([verifierResultArb], fcParams)(
    'the silence heading appears iff silent.length > 0, followed by one line per claim (R4.6)',
    (result) => {
      const lines = renderWardReport(result).split('\n');
      const h = lines.indexOf(SILENCE_HEADING);
      if (result.silent.length === 0) {
        expect(h).toBe(-1);
        return;
      }
      expect(h).toBeGreaterThan(0);
      result.silent.forEach((s, k) => {
        expect(lines[h + 1 + k]).toBe(
          `- [silence] ${escapeMd(s.claim.text)} Reason: ${escapeMd(s.claim.silenceReason)}`,
        );
      });
    },
  );
});
