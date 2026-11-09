/**
 * Unit tests for src/ghost/report.ts
 *
 * Covers:
 *  - one verified memory claim with a quote
 *  - one verified silence claim
 *  - one rejected claim
 *  - struck heading absent when there are no rejected claims
 *  - location line from meta
 */

import { describe, it, expect } from 'vitest';
import { renderWardReport, escapeMd } from '../../src/ghost/report.js';
import type { VerifierResult } from '../../src/ghost/schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<VerifierResult> = {}): VerifierResult {
  return {
    verified: [],
    rejected: [],
    score: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// escapeMd
// ---------------------------------------------------------------------------

describe('escapeMd', () => {
  it('replaces \\n with a space', () => {
    expect(escapeMd('line1\nline2')).toBe('line1 line2');
  });

  it('replaces \\r\\n with a space', () => {
    expect(escapeMd('line1\r\nline2')).toBe('line1 line2');
  });

  it('replaces \\r with a space', () => {
    expect(escapeMd('line1\rline2')).toBe('line1 line2');
  });

  it('escapes backslash', () => {
    expect(escapeMd('a\\b')).toBe('a\\\\b');
  });

  it('escapes backtick', () => {
    expect(escapeMd('`code`')).toBe('\\`code\\`');
  });

  it('escapes tilde', () => {
    expect(escapeMd('~~strike~~')).toBe('\\~\\~strike\\~\\~');
  });

  it('escapes asterisk', () => {
    expect(escapeMd('**bold**')).toBe('\\*\\*bold\\*\\*');
  });

  it('escapes underscore', () => {
    expect(escapeMd('_italic_')).toBe('\\_italic\\_');
  });

  it('escapes brackets', () => {
    expect(escapeMd('[link]')).toBe('\\[link\\]');
  });

  it('escapes angle brackets', () => {
    expect(escapeMd('<tag>')).toBe('\\<tag\\>');
  });

  it('escapes pipe', () => {
    expect(escapeMd('a|b')).toBe('a\\|b');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeMd('hello world 123')).toBe('hello world 123');
  });
});

// ---------------------------------------------------------------------------
// renderWardReport — structure
// ---------------------------------------------------------------------------

describe('renderWardReport', () => {
  it('starts with # Ward report', () => {
    const report = renderWardReport(makeResult());
    expect(report.startsWith('# Ward report\n')).toBe(true);
  });

  it('contains the count line with correct N and M', () => {
    const result = makeResult({
      verified: [
        {
          claim: { kind: 'memory', text: 'A fact', citations: [{ sha7: 'a1b2c3d' }] },
          speculative: false,
        },
      ],
      rejected: [
        {
          claim: { kind: 'memory', text: 'Bad claim', citations: [{ sha7: 'dead000' }] },
          reason: 'sha dead000 not in ledger',
        },
      ],
      score: 0.5,
    });
    const report = renderWardReport(result);
    expect(report).toContain('**1 of 2 claims verified**');
  });

  // -------------------------------------------------------------------------
  // Memory claim with a quote
  // -------------------------------------------------------------------------

  it('renders a verified memory claim with a quote', () => {
    const result = makeResult({
      verified: [
        {
          claim: {
            kind: 'memory',
            text: 'Retry after 3 s',
            citations: [{ sha7: 'a1b2c3d', quote: 'vendor returns 429' }],
          },
          speculative: false,
        },
      ],
      score: 1,
    });
    const report = renderWardReport(result);
    expect(report).toContain('## Verified');
    expect(report).toContain('[memory] Retry after 3 s');
    expect(report).toContain('`a1b2c3d`');
    expect(report).toContain('"vendor returns 429"');
    // full item line
    expect(report).toContain(
      '- [memory] Retry after 3 s — `a1b2c3d` "vendor returns 429"',
    );
  });

  // -------------------------------------------------------------------------
  // Silence claim
  // -------------------------------------------------------------------------

  it('renders a verified silence claim with reason', () => {
    const result = makeResult({
      verified: [
        {
          claim: {
            kind: 'silence',
            text: 'The record is silent',
            citations: [],
            silenceReason: 'no commit mentions the timeout',
          },
          speculative: false,
        },
      ],
      score: 1,
    });
    const report = renderWardReport(result);
    expect(report).toContain(
      '[silence] The record is silent Reason: no commit mentions the timeout',
    );
  });

  // -------------------------------------------------------------------------
  // Rejected claim
  // -------------------------------------------------------------------------

  it('renders a rejected claim under ## Struck by the ward', () => {
    const result = makeResult({
      rejected: [
        {
          claim: {
            kind: 'memory',
            text: 'Invented reason',
            citations: [{ sha7: 'deadbee' }],
          },
          reason: 'sha deadbee not in ledger',
        },
      ],
      score: 0,
    });
    const report = renderWardReport(result);
    expect(report).toContain('## Struck by the ward');
    expect(report).toContain('~~Invented reason~~');
    expect(report).toContain('rejected: sha deadbee not in ledger');
  });

  // -------------------------------------------------------------------------
  // Struck heading omitted when no rejected claims
  // -------------------------------------------------------------------------

  it('omits ## Struck by the ward when there are no rejected claims', () => {
    const result = makeResult({
      verified: [
        {
          claim: {
            kind: 'silence',
            text: 'The record is silent',
            citations: [],
            silenceReason: 'no info',
          },
          speculative: false,
        },
      ],
      score: 1,
    });
    const report = renderWardReport(result);
    expect(report).not.toContain('## Struck by the ward');
  });

  // -------------------------------------------------------------------------
  // Verified heading omitted when no verified claims
  // -------------------------------------------------------------------------

  it('omits ## Verified when there are no verified claims', () => {
    const result = makeResult({
      rejected: [
        {
          claim: { kind: 'memory', text: 'Bad', citations: [{ sha7: 'dead000' }] },
          reason: 'sha dead000 not in ledger',
        },
      ],
      score: 0,
    });
    const report = renderWardReport(result);
    expect(report).not.toContain('## Verified');
    expect(report).toContain('## Struck by the ward');
  });

  // -------------------------------------------------------------------------
  // Location line from meta
  // -------------------------------------------------------------------------

  it('includes file and line range when meta is provided', () => {
    const result = makeResult();
    const report = renderWardReport(result, {
      file: 'legacy/tax.js',
      lines: { start: 7, end: 12 },
    });
    expect(report).toContain('File: legacy/tax.js lines 7–12');
  });

  it('includes only file when lines are omitted from meta', () => {
    const result = makeResult();
    const report = renderWardReport(result, { file: 'legacy/tax.js' });
    expect(report).toContain('File: legacy/tax.js');
    expect(report).not.toContain('lines');
  });

  it('omits location line when meta is absent', () => {
    const result = makeResult();
    const report = renderWardReport(result);
    expect(report).not.toContain('File:');
  });

  // -------------------------------------------------------------------------
  // Claim text with Markdown special chars is escaped
  // -------------------------------------------------------------------------

  it('escapes Markdown in claim text', () => {
    const result = makeResult({
      rejected: [
        {
          claim: {
            kind: 'memory',
            text: 'Line with **bold** and `code`',
            citations: [{ sha7: 'dead000' }],
          },
          reason: 'sha dead000 not in ledger',
        },
      ],
      score: 0,
    });
    const report = renderWardReport(result);
    expect(report).toContain('\\*\\*bold\\*\\*');
    expect(report).toContain('\\`code\\`');
  });
});
