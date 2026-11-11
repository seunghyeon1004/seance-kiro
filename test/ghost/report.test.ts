/**
 * Unit tests for src/ghost/report.ts
 *
 * Covers:
 *  - one verified memory claim with a quote
 *  - a silence claim is not counted or listed as verified (ward-hardening R4.1)
 *  - one rejected claim, including one whose claim did not parse (rc.text)
 *  - struck heading absent when there are no rejected claims
 *  - location line from meta
 */

import { describe, it, expect } from 'vitest';
import { renderWardReport, escapeMd } from '../../src/ghost/report.js';
import type {
  Claim,
  RejectedClaim,
  VerifiedClaim,
  VerifierResult,
} from '../../src/ghost/schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<VerifierResult> = {}): VerifierResult {
  return {
    verified: [],
    rejected: [],
    silent: [],
    score: 1,
    ...overrides,
  };
}

function verifiedMemory(text: string, sha7: string, quote: string): VerifiedClaim {
  return {
    index: 0,
    claim: { kind: 'memory', text, citations: [{ sha7, quote }] },
    speculative: false,
    quotes: [{ sha7, quote, field: 'body' }],
  };
}

function rejectedMemory(text: string, sha7: string, reason: string): RejectedClaim {
  const claim: Claim = {
    kind: 'memory',
    text,
    citations: [{ sha7, quote: 'some quote here' }],
  };
  return { index: 0, claim, kind: 'memory', text, citedSha7s: [sha7], reason };
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
      verified: [verifiedMemory('A fact', 'a1b2c3d', 'some quote here')],
      rejected: [
        rejectedMemory('Bad claim', 'dead000', 'Commit dead000 is not in the ledger.'),
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
      verified: [verifiedMemory('Retry after 3 s', 'a1b2c3d', 'vendor returns 429')],
      score: 1,
    });
    const report = renderWardReport(result);
    expect(report).toContain('## Citations verified');
    expect(report.split('\n')).not.toContain('## Verified');
    expect(report).toContain('[memory] Retry after 3 s');
    expect(report).toContain('`a1b2c3d`');
    expect(report).toContain('"vendor returns 429"');
    // full item line
    expect(report).toContain(
      '- [memory] Retry after 3 s — `a1b2c3d` "vendor returns 429"',
    );
  });

  // -------------------------------------------------------------------------
  // Silence claim (ward-hardening R4.1: silence is never in `verified`)
  // -------------------------------------------------------------------------

  it('does not count a silence claim in the count line or list it as verified', () => {
    const result = makeResult({
      silent: [
        {
          index: 0,
          claim: {
            kind: 'silence',
            text: 'The record is silent',
            citations: [],
            silenceReason: 'no commit mentions the timeout',
          },
        },
      ],
      score: 0,
    });
    const report = renderWardReport(result);
    expect(report).toContain('**0 of 0 claims verified**');
    expect(report).not.toContain('## Citations verified');
  });

  // -------------------------------------------------------------------------
  // Rejected claim
  // -------------------------------------------------------------------------

  it('renders a rejected claim under ## Struck by the ward', () => {
    const result = makeResult({
      rejected: [
        rejectedMemory(
          'Invented reason',
          'deadbee',
          'Commit deadbee is not in the ledger.',
        ),
      ],
      score: 0,
    });
    const report = renderWardReport(result);
    expect(report).toContain('## Struck by the ward');
    expect(report).toContain('~~Invented reason~~');
    expect(report).toContain('rejected: Commit deadbee is not in the ledger.');
  });

  it('renders the text of a rejected claim that did not match the claim format', () => {
    const result = makeResult({
      rejected: [
        {
          index: 0,
          claim: null,
          kind: 'rumour',
          text: 'Hearsay *only*',
          citedSha7s: [],
          reason: "Claim 1 is not in the ward's format (kind).",
        },
      ],
      score: 0,
    });
    const report = renderWardReport(result);
    expect(report).toContain('~~Hearsay \\*only\\*~~');
  });

  // -------------------------------------------------------------------------
  // Struck heading omitted when no rejected claims
  // -------------------------------------------------------------------------

  it('omits ## Struck by the ward when there are no rejected claims', () => {
    const result = makeResult({
      verified: [verifiedMemory('A fact', 'a1b2c3d', 'some quote here')],
      score: 1,
    });
    const report = renderWardReport(result);
    expect(report).not.toContain('## Struck by the ward');
  });

  // -------------------------------------------------------------------------
  // Citations verified heading omitted when no verified claims
  // -------------------------------------------------------------------------

  it('omits ## Citations verified when there are no verified claims', () => {
    const result = makeResult({
      rejected: [
        rejectedMemory('Bad', 'dead000', 'Commit dead000 is not in the ledger.'),
      ],
      score: 0,
    });
    const report = renderWardReport(result);
    expect(report).not.toContain('## Citations verified');
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
        rejectedMemory(
          'Line with **bold** and `code`',
          'dead000',
          'Commit dead000 is not in the ledger.',
        ),
      ],
      score: 0,
    });
    const report = renderWardReport(result);
    expect(report).toContain('\\*\\*bold\\*\\*');
    expect(report).toContain('\\`code\\`');
  });
});

// ---------------------------------------------------------------------------
// ward-hardening T3: limit line and silence section (R2.4, R4.3, R4.6)
// ---------------------------------------------------------------------------

const LIMIT_LINE =
  'The ward checked each citation and quote, not the wording of the claims.';

function silentClaim(text: string, silenceReason: string, index = 0) {
  return {
    index,
    claim: { kind: 'silence' as const, text, citations: [] as [], silenceReason },
  };
}

describe('renderWardReport (ward-hardening T3)', () => {
  it('puts the limit line directly after the count line (R2.4)', () => {
    const result = makeResult({
      verified: [verifiedMemory('A fact', 'a1b2c3d', 'some quote here')],
      rejected: [
        rejectedMemory('Bad', 'dead000', 'Commit dead000 is not in the ledger.'),
      ],
      silent: [silentClaim('Silent', 'Who asked?')],
    });
    const lines = renderWardReport(result).split('\n');
    const i = lines.indexOf('**1 of 2 claims verified**');
    expect(i).toBeGreaterThan(0);
    expect(lines[i + 1]).toBe(LIMIT_LINE);
  });

  it('puts the limit line after the count line even when the report is empty', () => {
    const lines = renderWardReport(makeResult(), { file: 'a.js' }).split('\n');
    expect(lines.slice(0, 4)).toEqual([
      '# Ward report',
      'File: a.js',
      '**0 of 0 claims verified**',
      LIMIT_LINE,
    ]);
  });

  it('does not count silence claims in N or M (R4.3)', () => {
    const result = makeResult({
      verified: [verifiedMemory('A fact', 'a1b2c3d', 'some quote here')],
      silent: [silentClaim('One', 'Q1?'), silentClaim('Two', 'Q2?', 1)],
    });
    expect(renderWardReport(result)).toContain('**1 of 1 claims verified**');
  });

  it('lists silence claims under their own heading, escaped (R4.6)', () => {
    const result = makeResult({
      silent: [
        silentClaim('The record is *silent*', 'Who asked for [the] wait?'),
        silentClaim('Nothing on\nthat', 'Why 3 s?', 1),
      ],
    });
    const lines = renderWardReport(result).split('\n');
    const h = lines.indexOf('## The record is silent (not checked)');
    expect(h).toBeGreaterThan(0);
    expect(lines[h + 1]).toBe(
      '- [silence] The record is \\*silent\\* Reason: Who asked for \\[the\\] wait?',
    );
    expect(lines[h + 2]).toBe('- [silence] Nothing on that Reason: Why 3 s?');
  });

  it('omits the silence heading when there are no silence claims (R4.6)', () => {
    const result = makeResult({
      verified: [verifiedMemory('A fact', 'a1b2c3d', 'some quote here')],
      rejected: [
        rejectedMemory('Bad', 'dead000', 'Commit dead000 is not in the ledger.'),
      ],
    });
    const report = renderWardReport(result);
    expect(report).not.toContain('## The record is silent');
    expect(report).not.toContain('[silence]');
  });

  it('never lists a silence claim under ## Citations verified', () => {
    const result = makeResult({ silent: [silentClaim('Silent words', 'Q?')] });
    const report = renderWardReport(result);
    expect(report).not.toContain('## Citations verified');
    expect(report).not.toContain('[memory] Silent words');
  });
});

// ---------------------------------------------------------------------------
// ward-hardening R11.9 (inquisitor review, suspected bidi finding)
// ---------------------------------------------------------------------------

describe('bidi controls become visible escapes (R11.9)', () => {
  it('escapeMd replaces U+202A–U+202E and U+2066–U+2069 with \\uXXXX text', () => {
    expect(escapeMd('a\u202Eb\u202Cc')).toBe('a\\u202Eb\\u202Cc');
    expect(escapeMd('\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069')).toBe(
      '\\u202A\\u202B\\u202C\\u202D\\u202E\\u2066\\u2067\\u2068\\u2069',
    );
    // other characters, and a literal backslash-u typed by the author, stay distinguishable
    expect(escapeMd('\\u202E')).toBe('\\\\u202E');
    expect(escapeMd('\u200F\u061C')).toBe('\u200F\u061C');
  });

  it('a report built from claims, quotes, reasons and the file name holds no bidi control', () => {
    const rlo = '\u202E';
    const result = makeResult({
      verified: [verifiedMemory(`fact ${rlo}deifirev`, 'a1b2c3d', `quote ${rlo}here ok`)],
      rejected: [rejectedMemory(`bad ${rlo}x`, 'dead000', `reason ${rlo}y`)],
      silent: [
        {
          index: 2,
          claim: {
            kind: 'silence',
            text: `silent ${rlo}z`,
            citations: [],
            silenceReason: `why ${rlo}w`,
          },
        },
      ],
    });
    const report = renderWardReport(result, {
      file: `a${rlo}.js`,
      lines: { start: 1, end: 2 },
    });
    expect(report).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
    expect(report.split('\\u202E').length - 1).toBe(7);
  });
});
