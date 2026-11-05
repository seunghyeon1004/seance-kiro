/**
 * Property-based tests for src/evidence/refs.ts
 * Uses fast-check via @fast-check/vitest.
 *
 * Properties tested (from design §7 and evidence-rules steering):
 *   P1 — mapLineRange result always has start >= 1 and end >= start
 *   P2 — mapLineRange is deterministic (same inputs → same output)
 *   P3 — parseRefs result length <= unique ref count in input
 *   P4 — parseRefs completes in < 100 ms on 10 000-char input
 *   P5 — isSuspicious returns true for all known injection strings
 */

import { describe, it as _it } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { parseRefs, isSuspicious, mapLineRange } from '../../../src/evidence/refs.js';
import type { RenameEvent, LineRange } from '../../../src/evidence/refs.js';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const renameEventArb: fc.Arbitrary<RenameEvent> = fc.record({
  fromFile: fc.string({ minLength: 1, maxLength: 64 }),
  toFile: fc.string({ minLength: 1, maxLength: 64 }),
  commitSha: fc.hexaString({ minLength: 40, maxLength: 40 }).map((s) => s.toLowerCase()),
  offset: fc.integer({ min: -200, max: 200 }),
});

const lineRangeArb: fc.Arbitrary<LineRange> = fc
  .tuple(fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 0, max: 500 }))
  .map(([start, delta]) => ({ start, end: start + delta }));

// ---------------------------------------------------------------------------
// P1 — mapLineRange: start >= 1 and end >= start
// ---------------------------------------------------------------------------

describe('P1 — mapLineRange bounds invariant', () => {
  test.prop([fc.array(renameEventArb, { maxLength: 20 }), lineRangeArb])(
    'result.start >= 1 and result.end >= result.start',
    (renames, original) => {
      const result = mapLineRange(renames, original);
      return result.start >= 1 && result.end >= result.start;
    },
  );
});

// ---------------------------------------------------------------------------
// P2 — mapLineRange is deterministic
// ---------------------------------------------------------------------------

describe('P2 — mapLineRange determinism', () => {
  test.prop([fc.array(renameEventArb, { maxLength: 20 }), lineRangeArb])(
    'same inputs always produce the same output',
    (renames, original) => {
      const r1 = mapLineRange(renames, original);
      const r2 = mapLineRange(renames, original);
      return r1.start === r2.start && r1.end === r2.end;
    },
  );
});

// ---------------------------------------------------------------------------
// P3 — parseRefs: result length <= unique ref count in input
// ---------------------------------------------------------------------------

describe('P3 — parseRefs deduplication', () => {
  test.prop([
    fc.array(fc.integer({ min: 1, max: 9999 }), { maxLength: 30 }).map((nums) => {
      // Build a string that mentions each number multiple times
      return nums.flatMap((n) => [`#${n}`, `#${n}`]).join(' ');
    }),
  ])('result.length <= unique ref count in input', (text) => {
    const unique = new Set<string>();
    const re = /#(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      unique.add(`#${m[1]}`);
    }
    const refs = parseRefs(text);
    return refs.length <= unique.size;
  });
});

// ---------------------------------------------------------------------------
// P4 — parseRefs completes in < 100 ms on 10 000-char input
// ---------------------------------------------------------------------------

describe('P4 — parseRefs no ReDoS', () => {
  test.prop([fc.string({ maxLength: 10_000 })])(
    'parseRefs completes quickly on large arbitrary strings',
    (text) => {
      const t0 = Date.now();
      parseRefs(text);
      const elapsed = Date.now() - t0;
      return elapsed < 100;
    },
  );
});

// ---------------------------------------------------------------------------
// P5 — isSuspicious returns true for all known injection strings
// ---------------------------------------------------------------------------

const INJECTION_STRINGS = [
  'ignore previous instructions',
  'ignore all instructions',
  'system:',
  '<|',
  '[INST]',
  '[/INST]',
  '<<SYS>>',
];

describe('P5 — isSuspicious detects all known injection strings', () => {
  test.prop([
    fc.constantFrom(...INJECTION_STRINGS),
    fc.string({ maxLength: 50 }),
    fc.string({ maxLength: 50 }),
  ])(
    'isSuspicious(prefix + injectionString + suffix) is true',
    (injection, prefix, suffix) => {
      return isSuspicious(prefix + injection + suffix) === true;
    },
  );
});
