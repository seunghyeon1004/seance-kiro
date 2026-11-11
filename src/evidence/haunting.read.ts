/**
 * haunting.read.ts — reads the haunting map from a repository directory (haunting-map §4.3).
 *
 * Two git calls, commits and trees only, run at the same time under one timeout each. Never
 * rejects: every failure becomes one fixed note, and the details go only to the log (R1.6).
 */

import { logNameOnly, lsTreeNames } from './git.js';
import {
  computeHauntingMap,
  parseLsTree,
  parseNameLog,
  MAP_MAX_COMMITS,
} from './haunting.js';
import { HauntingMapSchema, type HauntingOutcome } from '../ghost/schema.js';

export const HAUNTING_TIMEOUT_MS = 10_000;
export const MAP_NOTE_FAILED =
  'The haunting map could not be drawn: git could not read the history in time. The séance is not affected.';
export const MAP_NOTE_EMPTY =
  'The haunting map needs at least one commit, and none was read.';

function failed(code: string, message: string): HauntingOutcome {
  console.error('[seance] haunting map failed', { code, message });
  return { kind: 'note', note: MAP_NOTE_FAILED };
}

/** Never rejects (R1.6). */
export async function readHauntingMap(
  repo: string,
  opts: { readonly timeoutMs?: number } = {},
): Promise<HauntingOutcome> {
  const t = opts.timeoutMs ?? HAUNTING_TIMEOUT_MS;
  try {
    const [log, tree] = await Promise.all([
      logNameOnly(repo, MAP_MAX_COMMITS + 1, t),
      lsTreeNames(repo, t),
    ]);
    const { commits, skipped } = parseNameLog(log);
    if (skipped > 0)
      console.warn('[seance:map] skipped malformed commit records', { skipped });
    const map = computeHauntingMap(commits, parseLsTree(tree));
    if (map === null) return { kind: 'note', note: MAP_NOTE_EMPTY };
    const parsed = HauntingMapSchema.safeParse(map);
    if (!parsed.success) return failed('MAP_SCHEMA', parsed.error.message);
    return { kind: 'map', map };
  } catch (err: unknown) {
    const code =
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      typeof err.code === 'string'
        ? err.code
        : 'UNKNOWN';
    return failed(code, err instanceof Error ? err.message : String(err));
  }
}
