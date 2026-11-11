// inquisitor second pass (2026-11-11): frozen copy of src/ghost/verifier.ts with the
// hand-kept IGNORABLE_RANGES detection of ward-hardening R11.4, before the change to the
// Unicode property (R12.1). For the "only stricter" property CP14. Changed only in import
// paths. Do not edit.

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
 *
 * ward-hardening R11.4 (inquisitor review, 2026-11-11): the year and author checks run
 * twice, on the raw text and on its detection form (NFKC, default-ignorables removed).
 * The second pass only adds reasons. Quotes are always compared raw.
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

/**
 * Default-ignorable characters removed before year and author detection (ward-hardening
 * R11.4), as inclusive code point ranges. Nothing from the ledger or the claim is compiled
 * into a pattern; the text is walked one code point at a time.
 */
const IGNORABLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xe0000, 0xe0fff],
];

function isIgnorable(cp: number): boolean {
  for (const [lo, hi] of IGNORABLE_RANGES) if (cp >= lo && cp <= hi) return true;
  return false;
}

function stripIgnorables(s: string): string {
  let out = '';
  for (const ch of s) if (!isIgnorable(ch.codePointAt(0) ?? 0)) out += ch;
  return out;
}

/**
 * The text that year and author detection reads (R11.4): default-ignorable characters
 * removed, NFKC applied, and the ignorables NFKC may produce (U+FFA0 and U+3164 become
 * U+1160) removed again. Case is kept. Quotes are never compared in this form (R11.5).
 */
export function detectionText(s: string): string {
  return stripIgnorables(stripIgnorables(s).normalize('NFKC'));
}

interface IndexedItem {
  readonly item: EvidenceItem;
  readonly fields: Readonly<Record<QuoteField, string>>;
  readonly years: ReadonlySet<string>;
  /** R11.4: the same fields, the years in them and the author, in detection form. */
  readonly normFields: Readonly<Record<QuoteField, string>>;
  readonly normYears: ReadonlySet<string>;
  readonly normAuthor: string;
}

interface LedgerIndex {
  readonly bySha: ReadonlyMap<string, readonly IndexedItem[]>;
  /** Distinct authors, longest first, then by UTF-16 code unit order. */
  readonly authors: readonly string[];
  /** R11.4: distinct authors in detection form, in the same order. */
  readonly normAuthors: readonly string[];
}

function longestFirst(a: string, b: string): number {
  if (a.length !== b.length) return b.length - a.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function buildIndex(ledger: ReadonlyArray<EvidenceItem>): LedgerIndex {
  const bySha = new Map<string, IndexedItem[]>();
  const authorSet = new Set<string>();
  const normAuthorSet = new Set<string>();

  for (const item of ledger) {
    const fields: Record<QuoteField, string> = {
      subject: item.subject,
      body: item.body,
      hunk: item.hunk.slice(0, HUNK_UI_CHARS),
    };
    const normFields: Record<QuoteField, string> = {
      subject: detectionText(fields.subject),
      body: detectionText(fields.body),
      hunk: detectionText(fields.hunk),
    };
    const years = new Set<string>();
    const normYears = new Set<string>();
    for (const f of FIELD_ORDER) {
      for (const y of yearsIn(fields[f])) years.add(y);
      for (const y of yearsIn(normFields[f])) normYears.add(y);
    }
    const normAuthor = detectionText(item.author);
    const entry: IndexedItem = { item, fields, years, normFields, normYears, normAuthor };
    const list = bySha.get(item.shortSha);
    if (list === undefined) bySha.set(item.shortSha, [entry]);
    else list.push(entry);
    authorSet.add(item.author);
    normAuthorSet.add(normAuthor);
  }

  const authors = [...authorSet].sort(longestFirst);
  const normAuthors = [...normAuthorSet].sort(longestFirst);

  return { bySha, authors, normAuthors };
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

  // Step 7b — the same two checks again on the detection form of the claim and the
  // ledger (R11.4). They only add reasons, so the ward only becomes stricter (R11.7).
  const normText = detectionText(shape.text);
  const seenNormYears = new Set<string>();
  for (const y of yearsIn(normText)) {
    if (seenNormYears.has(y)) continue;
    seenNormYears.add(y);
    const supported = cited.some(
      (e) => e.item.date.slice(0, 4) === y || e.normYears.has(y),
    );
    if (!supported) {
      pushOnce(
        reasons,
        `The claim names the year ${y}, but no cited commit is dated ${y} or mentions it.`,
      );
    }
  }
  for (const name of namedAuthors(normText, index.normAuthors)) {
    const supported = cited.some(
      (e) =>
        e.normAuthor === name ||
        FIELD_ORDER.some((f) => containsWholeWord(e.normFields[f], name)),
    );
    if (!supported) {
      pushOnce(
        reasons,
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

function pushOnce(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason);
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
