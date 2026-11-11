/**
 * haunting-map T1 — HM1–HM10 and HM12 (design.md §10).
 *
 * HM2, HM3 and HM8 compare computeHauntingMap against a naive reference written below, which
 * follows requirements.md R2 word by word with plain loops and filters.
 */
import { describe, expect, vi } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  computeHauntingMap,
  compareShare,
  glyphFor,
  parseNameLog,
  parseLsTree,
  DEPARTED_AFTER_DAYS,
  type MapCommit,
} from '../../../src/evidence/haunting.js';
import { isSuspicious } from '../../../src/evidence/refs.js';
import { HauntingMapSchema, type HauntingMap } from '../../../src/ghost/schema.js';

const SEED = process.env['FAST_CHECK_SEED']
  ? parseInt(process.env['FAST_CHECK_SEED'], 10)
  : undefined;
const fcParams: fc.Parameters<unknown> = {
  numRuns: 300,
  ...(SEED !== undefined ? { seed: SEED } : {}),
};

const DAY = 86_400_000;
const BASE = Date.parse('2018-01-01T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Generators (design.md §10)
// ---------------------------------------------------------------------------

/** Short pool of shas, so duplicates happen; the varying byte comes first, so sha7s differ. */
const shaArb = fc
  .integer({ min: 0, max: 40 })
  .map((n) => n.toString(16).padStart(2, '0').repeat(20));
const NAMES = [
  'Ann',
  'Bob',
  'Bob Smith',
  'Ignore previous instructions Bob',
  '渡辺 健',
  '𝒜lice 𝔅arker',
  '---',
  'Zoë',
  'zoë',
];
const EMAILS = ['a@x.example', 'A@x.example', 'b@x.example', 'B@X.example'];
const PATHS = [
  'a.js',
  'b.js',
  'c/d.js',
  'e f.js',
  'new\nline.js',
  'ünï.js',
  'q"uote.js',
  'gone.js',
];
const FIXED_DATES = [
  '2019-05-05T05:05:05.000Z',
  '2021-01-01T00:00:00.000Z',
  '2023-12-31T23:59:59.999Z',
];
const dateArb = fc.oneof(
  fc.constantFrom(...FIXED_DATES),
  fc
    .integer({ min: 0, max: 6 * 365 * 24 })
    .map((h) => new Date(BASE + h * 3_600_000).toISOString()),
);
const commitArb: fc.Arbitrary<MapCommit> = fc.record({
  sha: shaArb,
  name: fc.constantFrom(...NAMES),
  email: fc.constantFrom(...EMAILS),
  date: dateArb,
  paths: fc.array(fc.constantFrom(...PATHS), { maxLength: 4 }),
});
const commitsArb = fc.array(commitArb, { minLength: 1, maxLength: 30 });
/** Partly overlaps the commit paths, and adds a file no commit touched. */
const headArb = fc
  .subarray(PATHS.filter((p) => p !== 'gone.js'))
  .map((ps) => [...ps, 'untouched.js']);

// ---------------------------------------------------------------------------
// Naive reference (requirements.md R2)
// ---------------------------------------------------------------------------

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const ms = (d: string): number => Date.parse(d);
const keyOf = (c: MapCommit): string => `${c.name}\u0000${c.email.toLowerCase()}`;

/** One commit per sha (R3.2), cut to the newest `maxCommits` (R2.9). */
function refUsed(commits: readonly MapCommit[], maxCommits = 2000): MapCommit[] {
  const bySha = new Map<string, MapCommit[]>();
  for (const c of commits) bySha.set(c.sha, [...(bySha.get(c.sha) ?? []), c]);
  const kept: MapCommit[] = [];
  for (const group of bySha.values()) {
    let best = group[0] as MapCommit;
    for (const c of group) {
      const d =
        ms(best.date) - ms(c.date) ||
        cmp(c.name, best.name) ||
        cmp(c.email, best.email) ||
        cmp(c.paths.join('\u0000'), best.paths.join('\u0000'));
      if (d < 0) best = c;
    }
    kept.push(best);
  }
  kept.sort((a, b) => ms(b.date) - ms(a.date) || cmp(a.sha, b.sha));
  return kept.slice(0, maxCommits);
}

function refDeparted(
  used: readonly MapCommit[],
  days = DEPARTED_AFTER_DAYS,
): Set<string> {
  const now = Math.max(...used.map((c) => ms(c.date)));
  const out = new Set<string>();
  for (const c of used) {
    const last = Math.max(
      ...used.filter((x) => keyOf(x) === keyOf(c)).map((x) => ms(x.date)),
    );
    if (now - last > days * DAY) out.add(keyOf(c));
  }
  return out;
}

const touching = (used: readonly MapCommit[], path: string): MapCommit[] =>
  used.filter((c) => c.paths.includes(path));

/** The newest commit of a list: later date, then the smaller sha (R2.7). */
function newestOf(cs: readonly MapCommit[]): MapCommit {
  return [...cs].sort(
    (a, b) => ms(b.date) - ms(a.date) || cmp(a.sha, b.sha),
  )[0] as MapCommit;
}

/** The winning departed identity for a path (R2.5), or null. */
function refWinner(used: readonly MapCommit[], departed: Set<string>, path: string) {
  const on = touching(used, path).filter((c) => departed.has(keyOf(c)));
  const keys = [...new Set(on.map(keyOf))];
  if (keys.length === 0) return null;
  const rows = keys.map((k) => {
    const mine = on.filter((c) => keyOf(c) === k);
    const first = mine[0] as MapCommit;
    return {
      key: k,
      name: first.name,
      emailLower: first.email.toLowerCase(),
      touches: mine.length,
      newest: newestOf(mine),
    };
  });
  rows.sort(
    (a, b) =>
      b.touches - a.touches ||
      ms(b.newest.date) - ms(a.newest.date) ||
      cmp(a.name, b.name) ||
      cmp(a.emailLower, b.emailLower),
  );
  return rows[0] ?? null;
}

function mapOf(commits: readonly MapCommit[], head: readonly string[]): HauntingMap {
  const m = computeHauntingMap(commits, head);
  if (m === null) throw new Error('expected a map for a non-empty commit list');
  return m;
}

/** Commits as computeHauntingMap sees them: one per path occurrence collapsed (R2.4). */
const dedupePaths = (cs: readonly MapCommit[]): MapCommit[] =>
  cs.map((c) => ({ ...c, paths: [...new Set(c.paths)] }));

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('haunting map properties (design.md §10)', () => {
  test.prop([commitsArb, headArb], fcParams)(
    'HM1 counts are bounded (R2.6)',
    (cs, head) => {
      for (const f of mapOf(cs, head).files) {
        expect(f.totalTouches).toBeGreaterThanOrEqual(1);
        expect(f.departedTouches).toBeGreaterThanOrEqual(0);
        expect(f.departedTouches).toBeLessThanOrEqual(f.totalTouches);
        const share = f.departedTouches / f.totalTouches;
        expect(share).toBeGreaterThanOrEqual(0);
        expect(share).toBeLessThanOrEqual(1);
      }
    },
  );

  test.prop([commitsArb, headArb], fcParams)(
    'HM2 counts are counts (R2.4, R2.6)',
    (cs, head) => {
      const map = mapOf(cs, head);
      const used = dedupePaths(refUsed(cs));
      const departed = refDeparted(used);
      const expected = head.filter((p) => touching(used, p).length > 0).sort();
      expect(map.files.map((f) => f.path).sort()).toEqual(expected);
      for (const f of map.files) {
        const on = touching(used, f.path);
        expect(f.totalTouches).toBe(on.length);
        expect(f.departedTouches).toBe(on.filter((c) => departed.has(keyOf(c))).length);
      }
    },
  );

  test.prop([commitsArb, headArb], fcParams)(
    'HM3 a ghost touched it (R2.3, R2.5)',
    (cs, head) => {
      const map = mapOf(cs, head);
      const used = dedupePaths(refUsed(cs));
      const departed = refDeparted(used);
      for (const f of map.files) {
        expect(f.ghostId === null).toBe(f.departedTouches === 0);
        const w = refWinner(used, departed, f.path);
        if (f.ghostId === null) {
          expect(w).toBeNull();
          expect(f.hauntedBy).toBeNull();
          continue;
        }
        const g = map.ghosts.find((x) => x.id === f.ghostId);
        expect(g).toBeDefined();
        expect(w).not.toBeNull();
        expect(f.hauntedBy).toBe(w?.name);
        expect(g?.name).toBe(w?.name);
        // the ghost is that identity: its lastSeen is the identity's newest used date
        const lastMs = Math.max(
          ...used.filter((c) => keyOf(c) === w?.key).map((c) => ms(c.date)),
        );
        expect(g?.lastSeen).toBe(new Date(lastMs).toISOString());
      }
    },
  );

  test.prop(
    [
      commitsArb,
      headArb,
      fc.array(fc.nat(), { maxLength: 40 }),
      fc.array(fc.nat({ max: 29 }), { maxLength: 10 }),
      fc.tuple(fc.integer({ min: 0, max: 4e12 }), fc.integer({ min: 0, max: 4e12 })),
    ],
    fcParams,
  )('HM4 determinism (R3.1, R3.2)', (cs, head, keys, dupes, [t1, t2]) => {
    const before = structuredClone({ cs, head });
    const base = mapOf(cs, head);
    expect({ cs, head }).toEqual(before);

    const shuffle = <T>(xs: readonly T[]): T[] =>
      xs
        .map((x, i) => ({ x, k: keys[i % Math.max(keys.length, 1)] ?? i }))
        .sort((a, b) => a.k - b.k)
        .map((e) => e.x);
    const withDupes = [...cs, ...dupes.map((i) => cs[i % cs.length] as MapCommit)];
    expect(mapOf(shuffle(withDupes), shuffle(head))).toEqual(base);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(t1);
      const a = mapOf(cs, head);
      vi.setSystemTime(t2);
      const b = mapOf(cs, head);
      expect(a).toEqual(b);
      expect(a).toEqual(base);
    } finally {
      vi.useRealTimers();
    }
  });

  test.prop(
    [commitsArb, headArb, fc.integer({ min: 0, max: 364 * DAY }), fc.subarray(PATHS)],
    fcParams,
  )(
    "HM5 a living author's commit never raises a share (R2.3, R2.6)",
    (cs, head, back, paths) => {
      const before = mapOf(cs, head);
      const extra: MapCommit = {
        sha: 'ff'.repeat(20),
        name: 'Newcomer',
        email: 'new@x.example',
        date: new Date(ms(before.repoNow) - back).toISOString(),
        paths,
      };
      const after = mapOf([...cs, extra], head);
      expect(after.repoNow).toBe(before.repoNow);
      expect(after.ghosts).toEqual(before.ghosts);
      for (const f of after.files) {
        const old = before.files.find((x) => x.path === f.path);
        if (old) expect(compareShare(f, old)).toBeLessThanOrEqual(0);
      }
    },
  );

  test.prop(
    [commitsArb, headArb, fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 6 })],
    fcParams,
  )('HM6 caps (R2.9, R2.10)', (cs, head, maxFiles, maxCommits) => {
    const map = computeHauntingMap(cs, head, { maxFiles, maxCommits });
    const full = computeHauntingMap(cs, head, { maxFiles: 1000, maxCommits });
    if (map === null || full === null) throw new Error('expected maps');
    const distinct = new Set(cs.map((c) => c.sha)).size;
    expect(map.historyCut).toBe(distinct > maxCommits);
    expect(map.commitsRead).toBe(Math.min(distinct, maxCommits));
    expect(map.files.length).toBeLessThanOrEqual(maxFiles);
    expect(map.filesConsidered).toBe(full.files.length);
    expect(map.truncated).toBe(map.filesConsidered > maxFiles);
    const kept = new Set(map.files.map((f) => f.path));
    for (const omitted of full.files.filter((f) => !kept.has(f.path))) {
      for (const k of map.files) {
        const d = compareShare(k, omitted);
        expect(d > 0 || (d === 0 && k.path < omitted.path)).toBe(true);
      }
    }
  });

  test.prop([commitsArb, headArb], fcParams)(
    'HM7 ghost list (R3.4, R3.5, R5.4, R8.2)',
    (cs, head) => {
      const map = mapOf(cs, head);
      const used = refUsed(cs);
      const departed = refDeparted(used);
      map.ghosts.forEach((g, i) => {
        expect(g.id).toBe(`G${i + 1}`);
        const mine = map.files.filter((f) => f.ghostId === g.id);
        expect(g.files).toBe(mine.length);
        expect(g.files).toBeGreaterThanOrEqual(1);
        expect(mine.every((f) => f.hauntedBy === g.name)).toBe(true);
        expect(g.suspicious).toBe(isSuspicious(g.name));
        // some departed identity with this name has its newest used commit at lastSeen
        const match = [...departed].some((k) => {
          const theirs = used.filter((c) => keyOf(c) === k);
          return (
            theirs[0]?.name === g.name &&
            new Date(Math.max(...theirs.map((c) => ms(c.date)))).toISOString() ===
              g.lastSeen
          );
        });
        expect(match).toBe(true);
        const prev = map.ghosts[i - 1];
        if (prev) {
          expect(prev.files).toBeGreaterThanOrEqual(g.files);
          if (prev.files === g.files)
            expect(ms(prev.lastSeen)).toBeGreaterThanOrEqual(ms(g.lastSeen));
          if (prev.files === g.files && prev.lastSeen === g.lastSeen)
            expect(cmp(prev.name, g.name)).toBeLessThanOrEqual(0);
        }
      });
      expect(new Set(map.ghosts.map((g) => g.glyph)).size).toBe(map.ghosts.length);
    },
  );

  test.prop([commitsArb, headArb], fcParams)(
    'HM8 the commit named is real (R2.7)',
    (cs, head) => {
      const map = mapOf(cs, head);
      const used = dedupePaths(refUsed(cs));
      const departed = refDeparted(used);
      for (const f of map.files) {
        const on = touching(used, f.path);
        const named = on.find((c) => c.sha.slice(0, 7) === f.lastSha7);
        expect(named).toBeDefined();
        expect(f.lastSeen).toBe(named?.date);
        const w = refWinner(used, departed, f.path);
        const expected = w ? w.newest : newestOf(on);
        expect(f.lastSha7).toBe(expected.sha.slice(0, 7));
        expect(f.lastSeen).toBe(expected.date);
      }
    },
  );

  test.prop([commitsArb, headArb], fcParams)(
    'HM9 order and schema (R2.1, R3.6, R4.2)',
    (cs, head) => {
      const map = mapOf(cs, head);
      const used = refUsed(cs);
      expect(map.repoNow).toBe(
        new Date(Math.max(...used.map((c) => ms(c.date)))).toISOString(),
      );
      const rank = (f: HauntingMap['files'][number]): number =>
        f.ghostId === null ? Number.MAX_SAFE_INTEGER : Number(f.ghostId.slice(1));
      for (let i = 1; i < map.files.length; i++) {
        const a = map.files[i - 1] as HauntingMap['files'][number];
        const b = map.files[i] as HauntingMap['files'][number];
        expect(rank(a)).toBeLessThanOrEqual(rank(b));
        if (rank(a) === rank(b)) {
          const s = a.ghostId === null ? 0 : compareShare(a, b);
          expect(s).toBeGreaterThanOrEqual(0);
          if (s === 0) expect(cmp(a.path, b.path)).toBeLessThan(0);
        }
      }
      const parsed = HauntingMapSchema.safeParse(map);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    },
  );

  // --- HM10 parsers --------------------------------------------------------

  const fieldChars = fc.oneof(
    fc.constantFrom(' ', '"', "'", '\n', 'ü', '渡', '𝒜', '\t', '\\'),
    fc.char(),
  );
  // fc.char() is printable ASCII and the pool above has no NUL, RS or US, so no field can
  // contain a separator of the format
  const safe = (min: number) =>
    fc.array(fieldChars, { minLength: min, maxLength: 12 }).map((xs) => xs.join(''));
  const recordArb = fc.record({
    sha: fc
      .oneof(
        fc.hexaString({ minLength: 40, maxLength: 40 }),
        fc.hexaString({ minLength: 64, maxLength: 64 }),
      )
      .map((s) => s.toLowerCase()),
    name: safe(1),
    email: safe(0),
    date: fc.integer({ min: 0, max: 4e12 }).map((t) => new Date(t).toISOString()),
    paths: fc.array(safe(1), { maxLength: 4 }),
    fault: fc.constantFrom('none', 'none', 'none', 'missing', 'sha', 'date'),
  });
  const serialise = (r: fc.RecordValue<typeof recordArb>): string => {
    const shaOut = r.fault === 'sha' ? r.sha.slice(0, 39) + 'g' : r.sha;
    const dateOut = r.fault === 'date' ? 'not a date' : r.date;
    const fields =
      r.fault === 'missing'
        ? [shaOut, r.name, dateOut]
        : [shaOut, r.name, r.email, dateOut];
    const paths = r.paths.length > 0 ? `\n${r.paths.join('\u0000')}\u0000` : '';
    return `\u0000\u001e${fields.join('\u001f')}\u0000${paths}`;
  };

  test.prop([fc.array(recordArb, { maxLength: 8 })], fcParams)(
    'HM10 parseNameLog returns well-formed records and counts the rest (R1.9, R8.3)',
    (records) => {
      const out = parseNameLog(records.map(serialise).join(''));
      const good = records.filter((r) => r.fault === 'none');
      expect(out.skipped).toBe(records.length - good.length);
      expect(out.commits).toEqual(
        good.map((r) => ({
          sha: r.sha,
          name: r.name,
          email: r.email,
          date: r.date,
          paths: r.paths.filter((p) => p !== ''),
        })),
      );
    },
  );

  // haunting-map R10.3 (inquisitor review, 2026-11-11): paths of arbitrary bytes, NUL excepted,
  // including RS, US, newlines and whole fake headers, never forge or drop a commit
  const fakeHeader = fc
    .tuple(recordArb, fc.constantFrom('', 'a', '\n', 'x\n'))
    .map(
      ([r, pre]) => `${pre}\u001e${r.sha}\u001f${r.name}\u001f${r.email}\u001f${r.date}`,
    );
  const hostilePath = fc
    .oneof(
      { weight: 3, arbitrary: fc.fullUnicodeString({ minLength: 1, maxLength: 20 }) },
      {
        weight: 3,
        arbitrary: fc
          .array(fc.oneof(fc.constantFrom('\u001e', '\u001f', '\n'), fc.char()), {
            minLength: 1,
            maxLength: 20,
          })
          .map((xs) => xs.join('')),
      },
      { weight: 2, arbitrary: fakeHeader },
    )
    .map((p) => p.replaceAll('\u0000', ''))
    .filter((p) => p.length > 0);
  const realArb = recordArb
    .filter((r) => r.fault === 'none')
    .chain((r) =>
      fc.array(hostilePath, { maxLength: 4 }).map((paths) => ({ ...r, paths })),
    );

  test.prop([fc.array(realArb, { maxLength: 6 })], fcParams)(
    'HM10 git -z output with hostile paths parses to exactly the real commits and paths (R10.3)',
    (records) => {
      const out = parseNameLog(records.map(serialise).join(''));
      expect(out.skipped).toBe(0);
      expect(out.commits).toEqual(
        records.map((r) => ({
          sha: r.sha,
          name: r.name,
          email: r.email,
          date: r.date,
          paths: r.paths,
        })),
      );
    },
  );

  test.prop(
    [
      fc.oneof(
        fc.fullUnicodeString({ maxLength: 200 }),
        fc
          .array(
            fc.oneof(fc.constantFrom('\u0000', '\u001e', '\u001f', '\n'), fc.char()),
            {
              maxLength: 200,
            },
          )
          .map((xs) => xs.join('')),
      ),
    ],
    fcParams,
  )('HM10 neither parser throws on any string', (s) => {
    expect(() => parseNameLog(s)).not.toThrow();
    expect(() => parseLsTree(s)).not.toThrow();
    expect(parseLsTree(s).every((p) => p.length > 0)).toBe(true);
  });

  // --- HM12 glyphs ---------------------------------------------------------

  test.prop(
    [
      fc.array(
        fc.oneof(fc.constantFrom(...NAMES), fc.fullUnicodeString({ maxLength: 12 })),
        { maxLength: 12 },
      ),
    ],
    fcParams,
  )(
    'HM12 glyphs are non-empty, unsuffixed unless taken, and never taken (R5.4)',
    (names) => {
      const taken = new Set<string>();
      names.forEach((name, i) => {
        const glyph = glyphFor(name, i, taken);
        const base = glyphFor(name, i, new Set());
        expect(glyph.length).toBeGreaterThan(0);
        expect(base).not.toContain('-');
        expect(taken.has(glyph)).toBe(false);
        expect(glyph).toBe(taken.has(base) ? `${base}-${i + 1}` : base);
        taken.add(glyph);
      });
    },
  );
});
