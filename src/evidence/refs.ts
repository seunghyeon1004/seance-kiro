/**
 * refs.ts — pure functions for reference parsing, suspicious-message
 * detection, and line-range mapping.
 *
 * No I/O, no side effects: every function here is fully unit- and
 * property-testable.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LineRange = { start: number; end: number };

export type RenameEvent = {
  fromFile: string;
  toFile: string;
  commitSha: string;
  /** Line-number delta caused by insertions/deletions before the range */
  offset: number;
};

// ---------------------------------------------------------------------------
// R5 — Issue / PR reference parsing
// ---------------------------------------------------------------------------

/**
 * Regex patterns for recognised issue/PR reference formats.
 *
 * All patterns are anchored to word boundaries or preceded by known keywords
 * so they cannot catastrophically backtrack on pathological input (R5.3).
 *
 * Supported:
 *   #NNN
 *   Fixes #NNN  / Fix #NNN
 *   Closes #NNN
 *   Resolves #NNN
 * (keyword prefix is case-insensitive; R5.1)
 */
const REF_PATTERNS: RegExp[] = [
  // Keyword-prefixed variants first (longest match priority)
  /\b(?:fixes?|closes?|resolves?)\s+(#\d+)/gi,
  // Bare #NNN — only when preceded by whitespace, start of string, or punctuation
  /(?:^|[\s,.([\]])#(\d+)/gm,
];

/**
 * Extract all issue/PR reference strings (e.g. `"#42"`) from `text`.
 *
 * - Deduplicates by reference number.
 * - Preserves order of first appearance.
 * - Never uses eval or dynamic code (R5.3).
 */
export function parseRefs(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const pattern of REF_PATTERNS) {
    // Reset lastIndex before each use (global flag)
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      // Group 1 is always the captured #NNN or just the digits
      const raw = (m[1] ?? '').startsWith('#') ? (m[1] ?? '') : `#${m[1] ?? ''}`;
      if (!raw || raw === '#') continue;
      if (!seen.has(raw)) {
        seen.add(raw);
        result.push(raw);
      }
    }
  }

  // Re-order by first appearance position in the original text
  // (the two-pass approach above may interleave — stabilise with indexOf)
  result.sort((a, b) => {
    const ia = text.indexOf(a);
    const ib = text.indexOf(b);
    return ia - ib;
  });

  return result;
}

// ---------------------------------------------------------------------------
// R11.3 — Suspicious message detection
// ---------------------------------------------------------------------------

/**
 * Known prompt-injection substrings (ward-hardening design.md §7), lower case.
 * Fixed strings compared with `includes` — no regular expression, no ReDoS risk (R6.1).
 */
const INJECTION_NEEDLES: readonly string[] = [
  // The original list; every entry must still trigger (R6.2)
  'ignore previous instructions',
  'ignore all instructions',
  'system:',
  '<|',
  '<!-- ',
  '[inst]',
  '[/inst]',
  '<<sys>>',
  // Added by ward-hardening
  'ignore previous',
  'ignore all previous',
  'ignore the above',
  'ignore your',
  'disregard',
  'forget your',
  'forget all',
  'new instructions',
  'you are now',
  'you must now',
  'pretend to be',
  'note to the ai',
  'note to the model',
  'to the assistant',
  'assistant:',
  'system prompt',
  '[system]',
  '### instruction',
  '<!--',
  '<evidence',
  '</evidence',
  '<ledger',
  '</ledger',
  '<question',
  '</question',
  '<persona',
  'do not tell the user',
  'always say',
  'always answer',
  'never need quotes',
  'without a quote',
  'without quotes',
  'silencereason',
  '"kind"',
  '"citations"',
  'sha7=',
  'tool_use',
  'ghost_answer',
  'refactor_plan',
];

/** Zero-width and invisible characters removed before matching (design.md §7 step 2). */
const INVISIBLE_CHARS: ReadonlySet<string> = new Set([
  '\u200B',
  '\u200C',
  '\u200D',
  '\u2060',
  '\uFEFF',
]);

/**
 * Normalise text for needle matching (design.md §7): NFKC, drop invisible characters,
 * collapse each run of whitespace to one space, lower-case. No regular expression:
 * a single character is whitespace when `trim()` empties it, which is the same set as `\s`.
 */
function normaliseForNeedles(text: string): string {
  let out = '';
  let inSpace = false;
  for (const ch of text.normalize('NFKC')) {
    if (INVISIBLE_CHARS.has(ch)) continue;
    if (ch.trim() === '') {
      if (!inSpace) out += ' ';
      inSpace = true;
      continue;
    }
    out += ch;
    inSpace = false;
  }
  return out.toLowerCase();
}

/**
 * Return `true` if `text` contains a substring that looks like a
 * prompt-injection attempt (R11.3, ward-hardening R6.1).
 *
 * Normalises once, then uses fixed-string `includes` checks — no regex, no ReDoS risk.
 */
export function isSuspicious(text: string): boolean {
  const normalised = normaliseForNeedles(text);
  for (const needle of INJECTION_NEEDLES) {
    if (normalised.includes(needle)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// R3 — Line-range mapping through renames
// ---------------------------------------------------------------------------

/**
 * Map an original `[start, end]` line range through a sequence of rename
 * events (as produced by `git log --follow`) to obtain the coordinates as
 * they appeared in the commit being examined.
 *
 * Algorithm (see design §5):
 * 1. Walk events from newest → oldest (the order git log emits them).
 * 2. For each event apply the stored `offset` to both start and end.
 * 3. Clamp: start ≥ 1.
 * 4. Enforce order: end ≥ start.
 *
 * This is a pure function (R3.3): same inputs always produce the same output.
 */
export function mapLineRange(
  renames: ReadonlyArray<RenameEvent>,
  original: LineRange,
): LineRange {
  let start = original.start;
  let end = original.end;

  // Walk newest → oldest (git log order)
  for (const event of renames) {
    start -= event.offset;
    end -= event.offset;
  }

  // Clamp (R3.2)
  if (start < 1) {
    console.warn(`[seance:mapLineRange] Clamping start ${start} → 1 after rename offset`);
    start = 1;
  }

  // Enforce order (R3.2)
  if (end < start) {
    console.warn(
      `[seance:mapLineRange] Clamping end ${end} → ${start} to maintain order`,
    );
    end = start;
  }

  return { start, end };
}
