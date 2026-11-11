/**
 * haunting.ts — the haunting map, computed from commits and trees with no model (haunting-map).
 *
 * Pure: no clock, no environment, no filesystem, no randomness, no locale (R3.1). Every
 * comparison of strings is code-unit order. No regular expression is built from input.
 */

import { z } from 'zod';
import { isSuspicious } from './refs.js';
import type { HauntingMap, MapFile, MapGhost } from '../ghost/schema.js';

// ---------------------------------------------------------------------------
// Constants and types (design.md §5.1)
// ---------------------------------------------------------------------------

export const DEPARTED_AFTER_DAYS = 365;
export const MAP_MAX_COMMITS = 2000;
export const MAP_MAX_FILES = 300;
const DAY_MS = 86_400_000;

export interface MapCommit {
  /** full, 40 or 64 lower-case hex */
  readonly sha: string;
  readonly name: string;
  /** as recorded; lower-cased only for identity (R2.2) */
  readonly email: string;
  /** author date, normalised with new Date(…).toISOString() */
  readonly date: string;
  readonly paths: readonly string[];
}

export interface HauntingOptions {
  readonly departedAfterDays: number;
  readonly maxCommits: number;
  readonly maxFiles: number;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const ms = (d: string): number => Date.parse(d);

// ---------------------------------------------------------------------------
// Parsers (design.md §4.2)
// ---------------------------------------------------------------------------

const RS = '\u001e';
const US = '\u001f';
const NUL = '\u0000';

const MapCommitRecordSchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/),
  name: z.string().min(1),
  email: z.string(),
  date: z.string().datetime({ offset: true }),
});

/**
 * Parse `git log -z --name-only --format=%x1e%H%x1f%an%x1f%ae%x1f%aI`. Never throws.
 * A record with the wrong number of fields, or one that fails the schema, is counted in
 * `skipped` and dropped (R1.9).
 */
export function parseNameLog(raw: string): { commits: MapCommit[]; skipped: number } {
  const commits: MapCommit[] = [];
  let skipped = 0;
  const pieces = raw.split(RS).slice(1);
  for (const piece of pieces) {
    const cut = piece.indexOf(NUL);
    const header = cut === -1 ? piece : piece.slice(0, cut);
    let rest = cut === -1 ? '' : piece.slice(cut + 1);
    if (rest.startsWith('\n')) rest = rest.slice(1);
    const fields = header.split(US);
    if (fields.length !== 4) {
      skipped++;
      continue;
    }
    const [sha, name, email, date] = fields;
    const parsed = MapCommitRecordSchema.safeParse({ sha, name, email, date });
    if (!parsed.success) {
      skipped++;
      continue;
    }
    commits.push({
      sha: parsed.data.sha,
      name: parsed.data.name,
      email: parsed.data.email,
      date: new Date(parsed.data.date).toISOString(),
      paths: rest.split(NUL).filter((p) => p !== ''),
    });
  }
  return { commits, skipped };
}

/** Parse `git ls-tree -r -z --name-only HEAD`. Never throws. */
export function parseLsTree(raw: string): string[] {
  return raw.split(NUL).filter((p) => p !== '');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Exact: a/b vs c/d by cross-multiplication. Negative when the first share is smaller. */
export function compareShare(
  a: { readonly departedTouches: number; readonly totalTouches: number },
  b: { readonly departedTouches: number; readonly totalTouches: number },
): number {
  return a.departedTouches * b.totalTouches - b.departedTouches * a.totalTouches;
}

const INITIAL_RE = /[\p{L}\p{N}]/u;
const WORDS_RE = /\s+/u;

/** Initials of `name`, made unique within the map with a "-k" suffix (k = 1-based position). */
export function glyphFor(
  name: string,
  index: number,
  taken: ReadonlySet<string>,
): string {
  let base = '';
  let found = 0;
  for (const word of name.split(WORDS_RE)) {
    if (found === 2) break;
    if (word === '') continue;
    for (const ch of word) {
      if (INITIAL_RE.test(ch)) {
        base += ch.toUpperCase();
        found++;
        break;
      }
    }
  }
  if (base === '') base = '?';
  return taken.has(base) ? `${base}-${index + 1}` : base;
}

// ---------------------------------------------------------------------------
// computeHauntingMap (design.md §5.2)
// ---------------------------------------------------------------------------

interface Stamp {
  readonly ms: number;
  readonly sha: string;
  readonly date: string;
}

/** A later instant wins; an equal instant goes to the smaller full sha (R2.7). */
const newer = (a: Stamp, b: Stamp | undefined): boolean =>
  b === undefined || a.ms > b.ms || (a.ms === b.ms && a.sha < b.sha);

interface Identity {
  readonly name: string;
  readonly emailLower: string;
  lastMs: number;
}

interface FileTally {
  total: number;
  departed: number;
  newest: Stamp | undefined;
  readonly touches: Map<string, number>;
  readonly lastTouch: Map<string, Stamp>;
}

interface Row {
  readonly path: string;
  readonly departedTouches: number;
  readonly totalTouches: number;
  readonly winner: string | null;
  readonly stamp: Stamp;
}

export function computeHauntingMap(
  commits: ReadonlyArray<MapCommit>,
  headFiles: ReadonlyArray<string>,
  opts: Partial<HauntingOptions> = {},
): HauntingMap | null {
  const departedAfterDays = opts.departedAfterDays ?? DEPARTED_AFTER_DAYS;
  const maxCommits = opts.maxCommits ?? MAP_MAX_COMMITS;
  const maxFiles = opts.maxFiles ?? MAP_MAX_FILES;

  // 1. Dedupe by sha, keeping a choice that does not depend on input order (R3.2)
  const sorted = [...commits].sort(
    (a, b) =>
      cmp(a.sha, b.sha) ||
      ms(b.date) - ms(a.date) ||
      cmp(a.name, b.name) ||
      cmp(a.email, b.email) ||
      cmp(a.paths.join(NUL), b.paths.join(NUL)),
  );
  const kept: MapCommit[] = [];
  for (const c of sorted) {
    if (kept.length === 0 || (kept[kept.length - 1] as MapCommit).sha !== c.sha)
      kept.push(c);
  }

  // 2. Newest first (R3.3)
  kept.sort((a, b) => ms(b.date) - ms(a.date) || cmp(a.sha, b.sha));
  const first = kept[0];
  if (first === undefined) return null;

  // 3–4. The commit cut and repoNow (R2.1, R2.9)
  const historyCut = kept.length > maxCommits;
  const used = kept.slice(0, maxCommits);
  const repoNow = first.date;
  const nowMs = ms(repoNow);

  // 5. Identities and the departed set (R2.2, R2.3)
  const keyOf = (c: MapCommit): string => `${c.name}${NUL}${c.email.toLowerCase()}`;
  const ids = new Map<string, Identity>();
  for (const c of used) {
    const k = keyOf(c);
    const t = ms(c.date);
    const id = ids.get(k);
    if (id === undefined)
      ids.set(k, { name: c.name, emailLower: c.email.toLowerCase(), lastMs: t });
    else if (t > id.lastMs) id.lastMs = t;
  }
  const departed = new Set<string>();
  for (const [k, id] of ids) {
    if (nowMs - id.lastMs > departedAfterDays * DAY_MS) departed.add(k);
  }

  // 6. Touches (R2.4, R2.8)
  const head = new Set(headFiles);
  const tallies = new Map<string, FileTally>();
  for (const c of used) {
    const k = keyOf(c);
    const stamp: Stamp = { ms: ms(c.date), sha: c.sha, date: c.date };
    for (const path of new Set(c.paths)) {
      if (!head.has(path)) continue;
      let t = tallies.get(path);
      if (t === undefined) {
        t = {
          total: 0,
          departed: 0,
          newest: undefined,
          touches: new Map(),
          lastTouch: new Map(),
        };
        tallies.set(path, t);
      }
      t.total += 1;
      if (departed.has(k)) t.departed += 1;
      t.touches.set(k, (t.touches.get(k) ?? 0) + 1);
      if (newer(stamp, t.lastTouch.get(k))) t.lastTouch.set(k, stamp);
      if (newer(stamp, t.newest)) t.newest = stamp;
    }
  }

  // 7. Haunted by (R2.5, R2.7)
  const rows: Row[] = [];
  for (const [path, t] of tallies) {
    let winner: string | null = null;
    let wTouches = 0;
    let wStamp: Stamp | undefined;
    for (const [k, n] of t.touches) {
      if (!departed.has(k)) continue;
      const s = t.lastTouch.get(k) as Stamp;
      const better =
        winner === null ||
        n > wTouches ||
        (n === wTouches &&
          (s.ms > (wStamp as Stamp).ms ||
            (s.ms === (wStamp as Stamp).ms && tieBreak(ids, k, winner) < 0)));
      if (better) {
        winner = k;
        wTouches = n;
        wStamp = s;
      }
    }
    rows.push({
      path,
      departedTouches: t.departed,
      totalTouches: t.total,
      winner,
      stamp: (winner === null ? t.newest : wStamp) as Stamp,
    });
  }

  // 8. The file cap (R2.10)
  const filesConsidered = rows.length;
  rows.sort((a, b) => compareShare(b, a) || cmp(a.path, b.path));
  const listed = rows.slice(0, maxFiles);
  const truncated = filesConsidered > maxFiles;

  // 9. Ghosts (R3.4, R3.5, R5.4, R8.2)
  const ghostFiles = new Map<string, number>();
  for (const r of listed) {
    if (r.winner !== null) ghostFiles.set(r.winner, (ghostFiles.get(r.winner) ?? 0) + 1);
  }
  const ghostKeys = [...ghostFiles.keys()].sort((a, b) => {
    const ia = ids.get(a) as Identity;
    const ib = ids.get(b) as Identity;
    return (
      (ghostFiles.get(b) as number) - (ghostFiles.get(a) as number) ||
      ib.lastMs - ia.lastMs ||
      cmp(ia.name, ib.name) ||
      cmp(ia.emailLower, ib.emailLower)
    );
  });
  const taken = new Set<string>();
  const ghostIndex = new Map<string, number>();
  const ghosts: MapGhost[] = ghostKeys.map((k, i) => {
    const id = ids.get(k) as Identity;
    const glyph = glyphFor(id.name, i, taken);
    taken.add(glyph);
    ghostIndex.set(k, i);
    return Object.freeze({
      id: `G${i + 1}`,
      name: id.name,
      glyph,
      suspicious: isSuspicious(id.name),
      lastSeen: new Date(id.lastMs).toISOString(),
      files: ghostFiles.get(k) as number,
    });
  });

  // 10. File order (R3.6)
  const rank = (r: Row): number =>
    r.winner === null ? ghosts.length : (ghostIndex.get(r.winner) as number);
  listed.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.winner === null ? 0 : compareShare(b, a)) ||
      cmp(a.path, b.path),
  );
  const files: MapFile[] = listed.map((r) => {
    const g =
      r.winner === null ? null : (ghosts[ghostIndex.get(r.winner) as number] as MapGhost);
    return Object.freeze({
      path: r.path,
      hauntedBy: g === null ? null : g.name,
      ghostId: g === null ? null : g.id,
      departedTouches: r.departedTouches,
      totalTouches: r.totalTouches,
      lastSha7: r.stamp.sha.slice(0, 7),
      lastSeen: r.stamp.date,
    });
  });

  // 11. Freeze (R3.1)
  return Object.freeze({
    repoNow,
    departedAfterDays,
    commitsRead: used.length,
    historyCut,
    truncated,
    filesConsidered,
    ghosts: Object.freeze(ghosts) as MapGhost[],
    files: Object.freeze(files) as MapFile[],
  });
}

/** Name, then lower-cased email, in code-unit order (R2.5). Negative when `a` wins. */
function tieBreak(ids: ReadonlyMap<string, Identity>, a: string, b: string): number {
  const ia = ids.get(a) as Identity;
  const ib = ids.get(b) as Identity;
  return cmp(ia.name, ib.name) || cmp(ia.emailLower, ib.emailLower);
}
