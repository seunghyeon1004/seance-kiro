/**
 * ward-hardening T2 — property tests for the prompt builders.
 *
 * CP10 (escaped prompt) and the prompt half of CP9 (purity, no input mutation)
 * for buildPrompt and buildPlanPrompt (R5.2–R5.5, N6).
 */

import { describe, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  buildPrompt,
  escapeLedgerText,
  mostFrequentAuthor,
} from '../../../src/ghost/persona.js';
import { buildPlanPrompt } from '../../../src/exorcism/plan.js';
import type {
  EvidenceItem,
  LedgerResult,
  ScoredResult,
} from '../../../src/ghost/schema.js';

const SEED = process.env['FAST_CHECK_SEED']
  ? parseInt(process.env['FAST_CHECK_SEED'], 10)
  : undefined;
const fcParams: fc.Parameters<unknown> = {
  numRuns: 300,
  ...(SEED !== undefined ? { seed: SEED } : {}),
};

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary text, including markup, entities and full Unicode. */
const anyText = fc.oneof(
  fc.string({ maxLength: 60 }),
  fc.fullUnicodeString({ maxLength: 40 }),
  fc
    .array(
      fc.constantFrom(
        '<',
        '>',
        '"',
        '&',
        '&amp;',
        '&lt;',
        '</evidence>',
        '<evidence id="E1" sha7="abc1234">',
        '</question>',
        '<question>',
        '</ledger>',
        'x',
        ' ',
        '\n',
      ),
      { maxLength: 12 },
    )
    .map((xs) => xs.join('')),
);

/**
 * Generated field values start with `§`, which the fixed system text never contains,
 * so "system contains no generated value" is a meaningful check for any suffix.
 */
const marked = anyText.map((s) => `§${s}`);

const itemArb: fc.Arbitrary<EvidenceItem> = fc
  .record({
    sha: fc.hexaString({ minLength: 40, maxLength: 40 }).map((s) => s.toLowerCase()),
    author: marked,
    date: fc
      .date({ min: new Date('1990-01-01'), max: new Date('2030-01-01') })
      .map((d) => d.toISOString()),
    subject: marked,
    body: marked,
    hunk: marked,
    suspiciousMessage: fc.boolean(),
  })
  .map((r) => ({
    id: 'E1',
    sha: r.sha,
    shortSha: r.sha.slice(0, 7),
    author: r.author,
    email: 'x@example.com',
    date: r.date,
    subject: r.subject,
    body: r.body,
    hunk: r.hunk,
    files: ['f.js'],
    refs: [],
    suspiciousMessage: r.suspiciousMessage,
  }));

const ledgerArb = fc
  .array(itemArb, { maxLength: 8 })
  .map((items) => items.map((it, i) => ({ ...it, id: `E${i + 1}` })));

const scoredArb: fc.Arbitrary<ScoredResult> = fc.record({
  score: fc.integer({ min: 0, max: 100 }),
  signalBreakdown: fc.constant(
    (['age', 'churn', 'gone', 'marker', 'test', 'nesting'] as const).map((signal) => ({
      signal,
      rawValue: 0.5,
      weightedContribution: 5,
    })),
  ),
  markerLocations: fc.array(
    fc.record({
      sha7: fc.hexaString({ minLength: 7, maxLength: 7 }).map((s) => s.toLowerCase()),
      lineText: anyText.map((s) => s.slice(0, 256)),
    }),
    { maxLength: 5 },
  ),
});

function unescape(s: string): string {
  return s
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

function count(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// CP10 — escaped prompt
// ---------------------------------------------------------------------------

describe('CP10 — escaped prompt (R5.2, R5.3, R5.4)', () => {
  test.prop([ledgerArb, marked], fcParams)(
    'user has exactly n evidence elements and one question; system holds no field value',
    (ledger, question) => {
      const { system, user } = buildPrompt(ledger, question, 'sid-1');
      expect(count(user, '<evidence ')).toBe(ledger.length);
      expect(count(user, '</evidence>')).toBe(ledger.length);
      expect(count(user, '<question>')).toBe(1);
      expect(count(user, '</question>')).toBe(1);
      expect(count(user, 'suspicious="true"')).toBe(
        ledger.filter((i) => i.suspiciousMessage).length,
      );
      expect(system).not.toContain('§');
      for (const item of ledger) {
        for (const v of [item.author, item.subject, item.body, item.hunk]) {
          expect(system).not.toContain(v);
        }
      }
      expect(system).not.toContain(question);
    },
  );

  test.prop([anyText], fcParams)(
    'escapeLedgerText round-trips and removes < > "',
    (s) => {
      const e = escapeLedgerText(s);
      expect(unescape(e)).toBe(s);
      expect(e).not.toMatch(/[<>"]/);
    },
  );

  test.prop([ledgerArb, scoredArb], fcParams)(
    'plan prompt: n evidence elements, escaped marker text, no field value in system',
    (items, scored) => {
      const ledger: LedgerResult = { items, truncated: false, buildDurationMs: 0 };
      const { system, user } = buildPlanPrompt(ledger, scored);
      expect(count(user, '<evidence ')).toBe(items.length);
      expect(count(user, '</evidence>')).toBe(items.length);
      expect(count(user, '<score ')).toBe(1);
      expect(count(user, '</score>')).toBe(1);
      expect(system).not.toContain('§');
      for (const m of scored.markerLocations) {
        expect(user).toContain(escapeLedgerText(m.lineText.slice(0, 80)));
      }
    },
  );
});

// ---------------------------------------------------------------------------
// CP9 (prompt half) — pure, deterministic, no input mutation
// ---------------------------------------------------------------------------

describe('CP9 — prompt builders are pure (R5.5, N6)', () => {
  test.prop([ledgerArb, marked], fcParams)('buildPrompt', (ledger, question) => {
    const before = structuredClone(ledger);
    const a = buildPrompt(ledger, question, 'sid-1');
    const b = buildPrompt(ledger, question, 'sid-1');
    expect(a).toEqual(b);
    expect(ledger).toEqual(before);
  });

  test.prop([ledgerArb, scoredArb], fcParams)('buildPlanPrompt', (items, scored) => {
    const ledger: LedgerResult = { items, truncated: false, buildDurationMs: 0 };
    const before = structuredClone({ ledger, scored });
    const a = buildPlanPrompt(ledger, scored);
    const b = buildPlanPrompt(ledger, scored);
    expect(a).toEqual(b);
    expect({ ledger, scored }).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// first-seance T2 — CP7, one persona rule (R2.2, N6)
// ---------------------------------------------------------------------------

const cp7Params: fc.Parameters<unknown> = {
  numRuns: 1000,
  ...(SEED !== undefined ? { seed: SEED } : {}),
};

/** Ledgers whose authors repeat, so counts and ties matter. */
const repeatLedgerArb = fc
  .array(fc.tuple(itemArb, fc.constantFrom('Ada', 'Grace', 'Linus', '§<"&>', '')), {
    maxLength: 12,
  })
  .map((xs) =>
    xs.map(([it, a], i) => ({
      ...it,
      id: `E${i + 1}`,
      author: a === '' ? it.author : a,
    })),
  );

/** Reference rule of R2.2: the highest count wins, ties go to the first seen. */
function oracle(items: ReadonlyArray<EvidenceItem>): string {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const i of items) {
    if (!counts.has(i.author)) order.push(i.author);
    counts.set(i.author, (counts.get(i.author) ?? 0) + 1);
  }
  let best: string | undefined;
  for (const a of order) {
    if (best === undefined || (counts.get(a) ?? 0) > (counts.get(best) ?? 0)) best = a;
  }
  return best ?? 'Unknown Author';
}

describe('CP7 — one persona rule (R2.2)', () => {
  test.prop([fc.oneof(ledgerArb, repeatLedgerArb), marked], cp7Params)(
    'buildPrompt names the persona with mostFrequentAuthor',
    (items, question) => {
      const { user } = buildPrompt(items, question, 'sid-1');
      expect(user).toContain(
        `<persona author="${escapeLedgerText(mostFrequentAuthor(items))}"/>`,
      );
    },
  );

  test.prop([fc.oneof(ledgerArb, repeatLedgerArb)], cp7Params)(
    'highest count wins, ties go to the first seen, empty gives Unknown Author',
    (items) => {
      expect(mostFrequentAuthor(items)).toBe(oracle(items));
    },
  );
});
