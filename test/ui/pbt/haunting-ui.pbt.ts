/**
 * haunting-map T5 — properties of the map's text helpers in public/app.js (design.md §7.2, §7.3),
 * with fast-check (1,000 runs; FAST_CHECK_SEED honoured). public/app.js is a classic browser
 * script, so the pure functions are extracted from its source text, as test/ui/pbt/ui.pbt.ts does.
 * R2.6, R5.2, R5.11, R8.2.
 */
import { describe, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const js = readFileSync(resolve(__dirname, '../../../public/app.js'), 'utf8');

const SEED = process.env['FAST_CHECK_SEED']
  ? parseInt(process.env['FAST_CHECK_SEED'], 10)
  : undefined;
const params: fc.Parameters<unknown> = {
  numRuns: 1_000,
  ...(SEED !== undefined ? { seed: SEED } : {}),
};

/** Return the source of `function name(...) {...}` from app.js (brace matched). */
function extractFunction(name: string): string {
  const start = js.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in app.js`);
  let depth = 0;
  for (let i = js.indexOf(') {', start) + 2; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}' && --depth === 0) return js.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/** Return the source of `const name = ...;` from app.js, up to the first `;\n`. */
function extractConst(name: string): string {
  const start = js.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`const ${name} not found in app.js`);
  const end = js.indexOf(';\n', start);
  return js.slice(start, end + 1);
}

function load<T>(names: string[], consts: string[]): T {
  const src = [
    ...consts.map(extractConst),
    ...names.map(extractFunction),
    `return { ${names.join(', ')} };`,
  ].join('\n');
  return new Function(src)() as T;
}

interface Ghost {
  name: string;
  suspicious: boolean;
}
interface MapLike {
  repoNow: string;
  departedAfterDays: number;
  commitsRead: number;
  historyCut: boolean;
  truncated: boolean;
  filesConsidered: number;
  files: unknown[];
}
const fns = load<{
  commitsText: (n: number, m: number) => string;
  ghostLabel: (g: Ghost) => string;
  mapMetaText: (m: MapLike) => string;
  mapCutText: (m: MapLike, shallow: boolean) => string;
}>(
  ['commitsText', 'ghostLabel', 'mapMetaText', 'mapCutText'],
  ['dateFmt', 'countFmt', 'ORDERS_GHOST'],
);

const WARNING = 'A ghost whose name tries to give orders';
const HISTORY =
  'Only the newest 2,000 commits were read, so earlier authors may be missing.';
const SHALLOW = 'This clone holds only the newest 100 commits.';
const fileCap = (k: number, n: number) =>
  `Showing ${k.toLocaleString('en-US')} of ${n.toLocaleString('en-US')} files, the most haunted first.`;

const isoDate = fc
  .date({ min: new Date('1990-01-01T00:00:00Z'), max: new Date('2099-12-31T23:59:59Z') })
  .map((d) => d.toISOString());

const mapArb = fc
  .record({
    repoNow: isoDate,
    commitsRead: fc.integer({ min: 1, max: 2000 }),
    historyCut: fc.boolean(),
    kept: fc.integer({ min: 0, max: 300 }),
    extra: fc.integer({ min: 0, max: 5000 }),
  })
  .map(
    (r): MapLike => ({
      repoNow: r.repoNow,
      departedAfterDays: 365,
      commitsRead: r.commitsRead,
      historyCut: r.historyCut,
      truncated: r.extra > 0,
      filesConsidered: r.kept + r.extra,
      files: Array.from({ length: r.kept }, () => ({})),
    }),
  );

describe('commitsText (R2.6, R5.11)', () => {
  test.prop(
    [fc.integer({ min: 0, max: 2000 }), fc.integer({ min: 1, max: 2000 })],
    params,
  )('says "N of M commits by ghosts", with "commit" only when M is 1', (a, b) => {
    const n = Math.min(a, b);
    const s = fns.commitsText(n, b);
    const word = b === 1 ? 'commit' : 'commits';
    expect(s).toBe(
      `${n.toLocaleString('en-US')} of ${b.toLocaleString('en-US')} ${word} by ghosts`,
    );
  });
});

describe('ghostLabel (R8.2)', () => {
  test.prop([fc.string({ minLength: 1 }), fc.boolean()], params)(
    'is the warning wording for a suspicious ghost, and the name otherwise',
    (name, suspicious) => {
      const s = fns.ghostLabel({ name, suspicious });
      if (suspicious) {
        expect(s).toBe(WARNING);
        if (!WARNING.includes(name)) expect(s).not.toContain(name);
      } else {
        expect(s).toBe(name);
      }
    },
  );
});

describe('mapMetaText (R5.2, R5.11)', () => {
  test.prop([mapArb], params)('names the commits read and the newest date', (m) => {
    const d = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(m.repoNow));
    const n = m.commitsRead;
    expect(fns.mapMetaText(m)).toBe(
      `Read from ${n.toLocaleString('en-US')} commit${n === 1 ? '' : 's'}, the newest on ${d}. A ghost is an author whose last commit came more than 365 days before that one.`,
    );
  });
});

describe('mapCutText (R5.2)', () => {
  test.prop([mapArb, fc.boolean()], params)(
    'has the history, shallow and file-cap sentences exactly when they apply, in that order',
    (m, shallow) => {
      const want = [
        m.historyCut ? HISTORY : null,
        shallow ? SHALLOW : null,
        m.truncated ? fileCap(m.files.length, m.filesConsidered) : null,
      ].filter((s): s is string => s !== null);
      expect(fns.mapCutText(m, shallow)).toBe(want.join(' '));
    },
  );
});
