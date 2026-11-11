// inquisitor review (2026-11-11): frozen copy of src/ghost/verifier.ts before the Unicode
// detection change (ward-hardening R11.4), for the "only stricter" property. Changed only in
// import paths. Do not edit.

/**
 * verifier.ts — deterministic ward that checks every claim against the ledger.
 *
 * Pure function; no I/O. Same ledger + same answer → same result every time.
 * The input is never mutated, and the result and its arrays are frozen.
 *
 * ward-hardening design.md §4: each claim is checked on its own, quotes are
 * mandatory and must be found in one single field of the one cited item, years
 * and ledger author names must be supported by the cited items, and silence
 * claims are reported in their own bucket, never as verified.
 *
 * No regular expression is built from ledger or claim text. Author names are
 * matched with indexOf, so a hostile name cannot cause catastrophic backtracking.
 */

import {
  ClaimSchema,
  ClaimShapeSchema,
  SilenceClaimSchema,
  HUNK_UI_CHARS,
  MAX_CITATIONS,
  QUOTE_MAX_CHARS,
  QUOTE_MIN_CHARS,
  SILENCE_MAX_CHARS,
} from '../../../src/ghost/schema.js';
import type {
  Claim,
  EvidenceItem,
  QuoteField,
  RejectedClaim,
  SilentClaim,
  VerifiedClaim,
  VerifiedQuote,
  VerifierResult,
} from '../../../src/ghost/schema.js';
import type { ZodError } from 'zod';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify every claim in `answer` against the evidence `ledger`.
 *
 * @param ledger - Read-only array of EvidenceItems (frozen by buildLedger).
 * @param answer - Anything with a `claims` array; each claim is checked on its own (R1.8).
 * @returns Frozen VerifierResult with verified[], rejected[], silent[] and a score in [0, 1].
 */
export function verify(
  ledger: ReadonlyArray<EvidenceItem>,
  answer: { readonly claims: ReadonlyArray<unknown> },
): VerifierResult {
  const index = buildIndex(ledger);

  const verified: VerifiedClaim[] = [];
  const rejected: RejectedClaim[] = [];
  const silent: SilentClaim[] = [];

  answer.claims.forEach((raw, i) => {
    const outcome = checkClaim(raw, i, index);
    if (outcome.bucket === 'verified') verified.push(outcome.value);
    else if (outcome.bucket === 'silent') silent.push(outcome.value);
    else rejected.push(outcome.value);
  });

  const total = verified.length + rejected.length + silent.length;
  const score = total === 0 ? 1 : verified.length / total;

  Object.freeze(verified);
  Object.freeze(rejected);
  Object.freeze(silent);
  return Object.freeze({ verified, rejected, silent, score });
}

// ---------------------------------------------------------------------------
// Index (built once per call)
// ---------------------------------------------------------------------------

const FIELD_ORDER: readonly QuoteField[] = ['subject', 'body', 'hunk'];

/** Four-digit years 1970–2099 not touching another ASCII digit. Used only via matchAll. */
const YEAR_RE = /(?<![0-9])(?:19[7-9][0-9]|20[0-9][0-9])(?![0-9])/g;

interface IndexedItem {
  readonly item: EvidenceItem;
  readonly fields: Readonly<Record<QuoteField, string>>;
  readonly years: ReadonlySet<string>;
}

interface LedgerIndex {
  readonly bySha: ReadonlyMap<string, readonly IndexedItem[]>;
  /** Distinct authors, longest first, then by UTF-16 code unit order. */
  readonly authors: readonly string[];
}

function buildIndex(ledger: ReadonlyArray<EvidenceItem>): LedgerIndex {
  const bySha = new Map<string, IndexedItem[]>();
  const authorSet = new Set<string>();

  for (const item of ledger) {
    const fields: Record<QuoteField, string> = {
      subject: item.subject,
      body: item.body,
      hunk: item.hunk.slice(0, HUNK_UI_CHARS),
    };
    const years = new Set<string>();
    for (const f of FIELD_ORDER) {
      for (const y of yearsIn(fields[f])) years.add(y);
    }
    const entry: IndexedItem = { item, fields, years };
    const list = bySha.get(item.shortSha);
    if (list === undefined) bySha.set(item.shortSha, [entry]);
    else list.push(entry);
    authorSet.add(item.author);
  }

  const authors = [...authorSet].sort((a, b) => {
    if (a.length !== b.length) return b.length - a.length;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  return { bySha, authors };
}

function yearsIn(s: string): string[] {
  return Array.from(s.matchAll(YEAR_RE), (m) => m[0]);
}

// ---------------------------------------------------------------------------
// Per-claim check (design.md §4.1 steps 2–9)
// ---------------------------------------------------------------------------

type Outcome =
  | { bucket: 'verified'; value: VerifiedClaim }
  | { bucket: 'silent'; value: SilentClaim }
  | { bucket: 'rejected'; value: RejectedClaim };

function checkClaim(raw: unknown, i: number, index: LedgerIndex): Outcome {
  const n = i + 1;
  const kind = rawKind(raw);
  const citedSha7s = rawCitedSha7s(raw);

  const reject = (text: string, reasons: string[]): Outcome => ({
    bucket: 'rejected',
    value: {
      index: i,
      claim: strictOrNull(raw),
      kind,
      text,
      citedSha7s,
      reason: reasons.join(' '),
    },
  });

  // Step 2 — shape
  const shapeResult = ClaimShapeSchema.safeParse(raw);
  if (!shapeResult.success) {
    return reject(rawText(raw), [formatReason(n, shapeResult.error)]);
  }
  const shape = shapeResult.data;

  // Step 3 — silence
  if (shape.kind === 'silence') {
    const reasons: string[] = [];
    if (shape.citations.length > 0) reasons.push('A silence claim cannot cite commits.');
    if (shape.silenceReason === undefined || shape.silenceReason.length === 0) {
      reasons.push(
        'A silence claim must name the question the record cannot answer, and its silenceReason is empty.',
      );
    }
    if (shape.text.length > SILENCE_MAX_CHARS) {
      reasons.push(
        `A silence claim may be at most ${SILENCE_MAX_CHARS} characters long.`,
      );
    }
    if (
      shape.silenceReason !== undefined &&
      shape.silenceReason.length > SILENCE_MAX_CHARS
    ) {
      reasons.push(
        `The silenceReason of a silence claim may be at most ${SILENCE_MAX_CHARS} characters long.`,
      );
    }
    if (reasons.length === 0) {
      const strict = SilenceClaimSchema.safeParse(raw);
      if (strict.success) {
        return { bucket: 'silent', value: { index: i, claim: strict.data } };
      }
      reasons.push(formatReason(n, strict.error));
    }
    return reject(shape.text, reasons);
  }

  // Step 4 — memory or speculation
  const reasons: string[] = [];
  const quotes: VerifiedQuote[] = [];
  const cited: IndexedItem[] = [];

  if (shape.citations.length === 0) {
    reasons.push(`A ${shape.kind} claim needs at least one citation.`);
  }

  if (shape.citations.length > MAX_CITATIONS) {
    reasons.push(`A claim may cite at most ${MAX_CITATIONS} commits.`);
  } else {
    // Step 5 — each citation
    for (const { sha7, quote } of shape.citations) {
      const items = index.bySha.get(sha7) ?? [];
      if (items.length === 0) {
        reasons.push(`Commit ${sha7} is not in the ledger.`);
        continue;
      }
      if (items.length > 1) {
        reasons.push(
          `Commit ${sha7} is ambiguous: ${items.length} commits in the ledger share that short hash.`,
        );
        continue;
      }
      const entry = items[0];
      if (entry === undefined) continue; // unreachable: length is exactly 1
      if (quote === undefined) {
        reasons.push(
          `The citation of ${sha7} has no quote. The ward accepts a citation only with the exact words from the commit.`,
        );
        continue;
      }
      if (quote.trim().length < QUOTE_MIN_CHARS) {
        reasons.push(
          `The quote cited from ${sha7} is too short. A quote needs at least ${QUOTE_MIN_CHARS} characters.`,
        );
        continue;
      }
      if (quote.length > QUOTE_MAX_CHARS) {
        reasons.push(
          `The quote cited from ${sha7} is too long. A quote may have at most ${QUOTE_MAX_CHARS} characters.`,
        );
        continue;
      }
      const field = FIELD_ORDER.find((f) => entry.fields[f].includes(quote));
      if (field === undefined) {
        reasons.push(
          `The quote cited from ${sha7} is not in that commit's subject, message or diff.`,
        );
        continue;
      }
      quotes.push({ sha7, quote, field });
      cited.push(entry);
    }
  }

  // Step 6 — years
  const seenYears = new Set<string>();
  for (const y of yearsIn(shape.text)) {
    if (seenYears.has(y)) continue;
    seenYears.add(y);
    const supported = cited.some((e) => e.item.date.slice(0, 4) === y || e.years.has(y));
    if (!supported) {
      reasons.push(
        `The claim names the year ${y}, but no cited commit is dated ${y} or mentions it.`,
      );
    }
  }

  // Step 7 — ledger authors
  for (const name of namedAuthors(shape.text, index.authors)) {
    const supported = cited.some(
      (e) =>
        e.item.author === name ||
        FIELD_ORDER.some((f) => containsWholeWord(e.fields[f], name)),
    );
    if (!supported) {
      reasons.push(
        `The claim names ${name}, but no cited commit is by ${name} or mentions them.`,
      );
    }
  }

  // Step 8 — strict guard
  if (reasons.length === 0) {
    const strict = ClaimSchema.safeParse(raw);
    if (!strict.success) {
      reasons.push(formatReason(n, strict.error));
    } else if (strict.data.kind !== 'silence') {
      // Step 9 — verified
      return {
        bucket: 'verified',
        value: {
          index: i,
          claim: strict.data,
          speculative: strict.data.kind === 'speculation',
          quotes,
        },
      };
    } else {
      // unreachable: the shape said memory or speculation
      reasons.push(`Claim ${n} is not in the ward's format (kind).`);
    }
  }

  return reject(shape.text, reasons);
}

// ---------------------------------------------------------------------------
// Author matching (indexOf only; design.md §4.1 step 7)
// ---------------------------------------------------------------------------

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
}

function isWholeWordAt(s: string, p: number, len: number): boolean {
  return !isWordChar(s[p - 1]) && !isWordChar(s[p + len]);
}

function containsWholeWord(s: string, name: string): boolean {
  if (name.length === 0) return false;
  for (let p = s.indexOf(name); p !== -1; p = s.indexOf(name, p + 1)) {
    if (isWholeWordAt(s, p, name.length)) return true;
  }
  return false;
}

/**
 * Ledger authors named in `text` as whole words. `authors` is sorted longest first;
 * an occurrence inside an already-counted longer name does not count again.
 */
function namedAuthors(text: string, authors: readonly string[]): string[] {
  const mask = new Uint8Array(text.length);
  const named: string[] = [];
  for (const name of authors) {
    if (name.length === 0) continue;
    let counted = false;
    for (let p = text.indexOf(name); p !== -1; p = text.indexOf(name, p + 1)) {
      if (!isWholeWordAt(text, p, name.length)) continue;
      let free = true;
      for (let k = p; k < p + name.length; k++) {
        if (mask[k] === 1) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      mask.fill(1, p, p + name.length);
      counted = true;
    }
    if (counted) named.push(name);
  }
  return named;
}

// ---------------------------------------------------------------------------
// Raw-value helpers for rejected claims
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function rawKind(raw: unknown): string {
  const k = isRecord(raw) ? raw['kind'] : undefined;
  return typeof k === 'string' && k.length <= 32 ? k : 'unknown';
}

function rawText(raw: unknown): string {
  const t = isRecord(raw) ? raw['text'] : undefined;
  return typeof t === 'string' ? t : '';
}

function rawCitedSha7s(raw: unknown): string[] {
  const cs = isRecord(raw) ? raw['citations'] : undefined;
  if (!Array.isArray(cs)) return [];
  const out: string[] = [];
  for (const c of cs as unknown[]) {
    if (isRecord(c) && typeof c['sha7'] === 'string') out.push(c['sha7']);
  }
  return out;
}

function strictOrNull(raw: unknown): Claim | null {
  const r = ClaimSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** F1 — the first Zod issue path joined with ".", or "claim" when the path is empty. */
function formatReason(n: number, error: ZodError): string {
  const issue = error.issues[0];
  const path =
    issue === undefined || issue.path.length === 0 ? 'claim' : issue.path.join('.');
  return `Claim ${n} is not in the ward's format (${path}).`;
}
