/**
 * Ward report renderer — pure, deterministic Markdown output from a VerifierResult.
 *
 * R1.1  renderWardReport(result, meta) → Markdown string
 * R1.7  Pure: no I/O, no clock reads, no mutation.
 */

import type {
  VerifierResult,
  VerifiedClaim,
  RejectedClaim,
  SilentClaim,
} from './schema.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WardReportMeta {
  file?: string;
  lines?: { start: number; end: number };
}

// ---------------------------------------------------------------------------
// escapeMd — R1.6
// ---------------------------------------------------------------------------

/**
 * Neutralise Markdown structural characters in untrusted text.
 *
 * 1. Replace \r\n, \r, \n with a single space.
 * 2. Backslash-escape: \ ` ~ * _ [ ] < > |
 *
 * The sha7 inside backticks is NOT passed through this function — it is
 * already validated as 7 lowercase hex chars.
 */
export function escapeMd(text: string): string {
  // Step 1: normalise all newline variants to a single space
  const noNewlines = text.replace(/\r\n|\r|\n/g, ' ');

  // Step 2: backslash-escape structural characters (backslash first to avoid
  // double-escaping the escapes we add)
  return noNewlines.replace(/[\\`~*_[\]<>|]/g, (ch) => `\\${ch}`);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function renderVerifiedItem(vc: VerifiedClaim): string {
  const { claim } = vc;
  const kindTag = `[${claim.kind}]`;

  // memory | speculation — silence claims are never verified (ward-hardening R4.1)
  const text = escapeMd(claim.text);
  const citationParts = claim.citations.map((c) => {
    // sha7 is already validated hex — no escaping needed
    const base = `\`${c.sha7}\``;
    if (c.quote !== undefined && c.quote.length > 0) {
      return `${base} "${escapeMd(c.quote)}"`;
    }
    return base;
  });

  const citStr = citationParts.length > 0 ? ` — ${citationParts.join(', ')}` : '';
  return `- ${kindTag} ${text}${citStr}`;
}

function renderRejectedItem(rc: RejectedClaim): string {
  // rc.text is set even when the claim did not match the claim format (rc.claim === null)
  const text = escapeMd(rc.text);
  const reason = escapeMd(rc.reason);
  return `- ~~${text}~~ — rejected: ${reason}`;
}

function renderSilentItem(sc: SilentClaim): string {
  // ward-hardening R4.6 — the ghost's words, listed apart and never counted as verified
  return `- [silence] ${escapeMd(sc.claim.text)} Reason: ${escapeMd(sc.claim.silenceReason)}`;
}

/** ward-hardening R2.4 — states what the ward did and did not check. */
export const WARD_LIMIT_LINE =
  'The ward checked each citation and quote, not the wording of the claims.';

// ---------------------------------------------------------------------------
// renderWardReport — R1.1 – R1.7
// ---------------------------------------------------------------------------

export function renderWardReport(result: VerifierResult, meta?: WardReportMeta): string {
  const lines: string[] = [];

  // R1.1 — title
  lines.push('# Ward report');

  // R1.3 — optional location line
  if (meta?.file !== undefined) {
    const filePart = escapeMd(meta.file);
    if (meta.lines !== undefined) {
      lines.push(`File: ${filePart} lines ${meta.lines.start}–${meta.lines.end}`);
    } else {
      lines.push(`File: ${filePart}`);
    }
  }

  // R1.2 — count line; silence claims are not counted (ward-hardening R4.3)
  const n = result.verified.length;
  const m = result.verified.length + result.rejected.length;
  lines.push(`**${n} of ${m} claims verified**`);

  // ward-hardening R2.4 — limit line directly after the count line
  lines.push(WARD_LIMIT_LINE);

  // blank line before sections
  lines.push('');

  // R1.4 — verified section (heading omitted when empty)
  if (result.verified.length > 0) {
    lines.push('## Verified');
    for (const vc of result.verified) {
      lines.push(renderVerifiedItem(vc));
    }
  }

  // R1.5 — rejected section (heading omitted when empty)
  if (result.rejected.length > 0) {
    lines.push('## Struck by the ward');
    for (const rc of result.rejected) {
      lines.push(renderRejectedItem(rc));
    }
  }

  // ward-hardening R4.6 — silence section (heading omitted when empty)
  if (result.silent.length > 0) {
    lines.push('## The record is silent (not checked)');
    for (const sc of result.silent) {
      lines.push(renderSilentItem(sc));
    }
  }

  return lines.join('\n');
}
