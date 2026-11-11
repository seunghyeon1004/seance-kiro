/**
 * ledger.ts — full pipeline: build the Evidence Ledger from validated input.
 *
 * This module re-exports the shared types and also implements `buildLedger`,
 * the top-level orchestrator that drives all the git, refs, and GitHub helpers.
 */

// Re-exports of shared types (source of truth is src/ghost/schema.ts)
export type { EvidenceItem, LedgerResult } from '../ghost/schema.js';
export { EvidenceItemSchema, LedgerResultSchema } from '../ghost/schema.js';

// ---------------------------------------------------------------------------
// LedgerInput — the validated input type consumed by buildLedger
// ---------------------------------------------------------------------------
export type { LedgerInput, WholeFileInput } from './ledger.input.js';
export {
  LedgerInputSchema,
  validateLedgerInput,
  WholeFileInputSchema,
  validateWholeFileInput,
} from './ledger.input.js';

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  blame,
  logL,
  showHunk,
  changedFiles,
  cloneRepo,
  cloneSizeBytes,
  readLines,
  lineCountAtHead,
  CLONE_MAX_BYTES,
  CLONE_MAX_MB,
  WHOLE_FILE_MAX_LINES,
} from './git.js';
import { parseRefs, isSuspicious } from './refs.js';
import { parseGitHubRemote, fetchGitHubRef } from './github.js';
import { readHauntingMap, MAP_NOTE_FAILED } from './haunting.read.js';
import { CloneError, GitError, HistoryError, ValidationError } from '../errors.js';
import type { LedgerInput, WholeFileInput } from './ledger.input.js';
import type {
  EvidenceItem,
  HauntingOutcome,
  LedgerResult,
  LineRange,
} from '../ghost/schema.js';
import type { RawCommit } from './git.js';

// ---------------------------------------------------------------------------
// Size caps (R10.1, R10.2, R10.3)
// ---------------------------------------------------------------------------

const MAX_ITEMS = 50;
const MAX_HUNK_BYTES = 512 * 1024; // 512 KB combined
/** EvidenceItemSchema's limits for author and email (ward-hardening R11.13). */
const MAX_AUTHOR_CHARS = 256;
const MAX_EMAIL_CHARS = 256;

// ---------------------------------------------------------------------------
// Whole-summon deadline for remote repositories (ward-hardening R11.10)
// ---------------------------------------------------------------------------

export const SUMMON_DEADLINE_DEFAULT_MS = 60_000;

/** SUMMON_DEADLINE_MS, read per summon; a missing or invalid value gives the default. */
function summonDeadlineMs(): number {
  const n = Number(process.env['SUMMON_DEADLINE_MS']);
  return Number.isFinite(n) && n > 0 ? n : SUMMON_DEADLINE_DEFAULT_MS;
}

/**
 * A check run before each git call. For a remote repository it throws HistoryError once the
 * deadline has passed, so the remaining git calls are not started; otherwise it does nothing.
 * `passed()` says whether the deadline has passed without throwing; the GitHub enrichment uses
 * it to skip a request once the deadline is gone (ward-hardening R12.7).
 */
function deadlineGuard(remote: boolean): {
  (step: string): void;
  passed: () => boolean;
} {
  if (!remote) return Object.assign(() => undefined, { passed: () => false });
  const ms = summonDeadlineMs();
  const deadline = Date.now() + ms;
  const passed = (): boolean => Date.now() >= deadline;
  return Object.assign(
    (step: string): void => {
      if (passed()) {
        throw new HistoryError(`The summon deadline of ${ms} ms passed before ${step}`);
      }
    },
    { passed },
  );
}

// ---------------------------------------------------------------------------
// Whole-file summons and the map option (haunting-map design.md §6.2)
// ---------------------------------------------------------------------------

export const WHOLE_FILE_UNREADABLE =
  'Séance could not read that file in the latest commit. Check the path.';
export const WHOLE_FILE_EMPTY =
  'That file is empty in the latest commit, so there is no line to ask about.';

export interface BuildLedgerOptions {
  /** Read the haunting map while the repository directory exists (R1.1). */
  readonly hauntingMap?: boolean;
}

/** Pure: lines 1 to min(n, 500) of a file with n >= 1 lines (R6.4). */
export function wholeFileRange(n: number): LineRange {
  return { startLine: 1, endLine: Math.min(n, WHOLE_FILE_MAX_LINES) };
}

/**
 * Start the map read now, as a promise that never rejects (R1.6). The reader does not reject or
 * throw; the guards keep the summon alive even if it did, synchronously or not.
 */
function startHauntingMap(repoRoot: string): Promise<HauntingOutcome> {
  const failed = (err: unknown): HauntingOutcome => {
    console.error('[seance] haunting map failed', {
      code: 'UNKNOWN',
      message: err instanceof Error ? err.message : String(err),
    });
    return { kind: 'note', note: MAP_NOTE_FAILED };
  };
  try {
    return readHauntingMap(repoRoot).catch(failed);
  } catch (err) {
    return Promise.resolve(failed(err));
  }
}

/** The line range for a whole-file input; refuses an unreadable or empty file (R6.4, R6.5). */
async function resolveWholeFile(
  repoRoot: string,
  file: string,
  beforeGit: (step: string) => void,
): Promise<LineRange> {
  let n: number;
  beforeGit('lineCountAtHead');
  try {
    n = await lineCountAtHead(repoRoot, file);
  } catch (err) {
    if (!(err instanceof GitError)) throw err;
    // the path and git's stderr go to the log only, never to the response (R6.5)
    console.error('[seance] whole-file read failed', {
      code: err.code,
      message: err.message,
    });
    throw new ValidationError(WHOLE_FILE_UNREADABLE);
  }
  if (n === 0) throw new ValidationError(WHOLE_FILE_EMPTY);
  return wholeFileRange(n);
}

// ---------------------------------------------------------------------------
// buildLedger (R4, R7, R8, R10, R11)
// ---------------------------------------------------------------------------

/**
 * Build an immutable Evidence Ledger for a file+line range in a repository.
 *
 * Orchestration order:
 *   1. Clone remote repo (if URL) or use local path.
 *   2. Run `git blame` to get commit SHAs touching the range.
 *   3. Run `git log -L` to get ordered history + rename events.
 *   4. Deduplicate by full SHA.
 *   5. Sort oldest → newest.
 *   6. Cap at 50 items (keep most-recent 50).
 *   7. For each commit: fetch hunk, changed files, parse refs, flag suspicious.
 *   8. Cap combined hunk size at 512 KB.
 *   9. Optionally enrich with GitHub PR/issue text.
 *  10. Assign IDs E1…En, freeze, return.
 */
export async function buildLedger(
  input: LedgerInput | WholeFileInput,
  opts: BuildLedgerOptions = {},
): Promise<LedgerResult> {
  const t0 = performance.now();
  const isRemote =
    input.repoUrl.startsWith('http://') || input.repoUrl.startsWith('https://');

  let repoRoot = input.repoUrl;
  let cleanup: (() => Promise<void>) | undefined;
  let shallow = false;
  let mapRun: Promise<HauntingOutcome> | undefined;

  try {
    // Step 1 — clone remote repo
    if (isRemote) {
      const resolved = await cloneRepo(input.repoUrl);
      repoRoot = resolved.root;
      cleanup = resolved.cleanup;
      // A mocked cloneRepo that returns no `shallow` is not shallow (design.md §5.4)
      shallow = resolved.shallow === true;
    }

    // The haunting map starts as soon as the directory is ready, alongside the ledger's own
    // git calls (haunting-map R1.1, R1.5). The reader never rejects; the catch is a guard.
    if (opts.hauntingMap === true) mapRun = startHauntingMap(repoRoot);

    // ward-hardening R11.10: one deadline from here on, checked before each git call
    const beforeGit = deadlineGuard(isRemote);

    // The range: given, or the whole file at HEAD (haunting-map R6.4, R6.5)
    const range: LineRange =
      'wholeFile' in input
        ? await resolveWholeFile(repoRoot, input.file, beforeGit)
        : { startLine: input.startLine, endLine: input.endLine };

    // Step 2 — blame to collect commit SHAs in the range
    beforeGit('blame');
    const blameEntries = await blame(
      repoRoot,
      input.file,
      range.startLine,
      range.endLine,
    );

    // Step 3 — log -L for ordered history + rename events
    beforeGit('log -L');
    const logCommits = await logL(repoRoot, input.file, range.startLine, range.endLine);

    // The selected lines at HEAD, read before the clone is deleted (first-seance R2.1)
    beforeGit('reading the lines');
    const lines = await readLines(repoRoot, input.file, range.startLine, range.endLine);

    // Step 4 — deduplicate SHAs (blame + log combined)
    const blameShas = new Set(blameEntries.map((e) => e.sha));
    const seen = new Set<string>();
    const allCommits: RawCommit[] = [];

    for (const commit of logCommits) {
      if (!seen.has(commit.sha)) {
        seen.add(commit.sha);
        allCommits.push(commit);
      }
    }

    // Add blame SHAs that log -L might have missed (edge case: very new lines)
    // We don't have full RawCommit for pure-blame entries, so we only keep
    // the ones that logL captured.  Blame serves as the initial reference set
    // but logL is authoritative for the commit data.
    void blameShas; // satisfies no-unused-vars; used above for deduplication concept

    // Step 5 — sort oldest → newest by ISO date
    allCommits.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Step 6 — cap at MAX_ITEMS (keep most-recent)
    const truncated = allCommits.length > MAX_ITEMS;
    const capped = truncated
      ? allCommits.slice(allCommits.length - MAX_ITEMS)
      : allCommits;

    // Determine GitHub enrichment context
    const ghInfo = parseGitHubRemote(input.repoUrl);

    // Step 7–9 — assemble EvidenceItems
    const items: EvidenceItem[] = [];
    let combinedHunkBytes = 0;

    for (let i = 0; i < capped.length; i++) {
      const commit = capped[i] as RawCommit;

      // Hunk (R4.3)
      let hunk = '';
      if (combinedHunkBytes < MAX_HUNK_BYTES) {
        beforeGit('git show');
        hunk = await showHunk(
          repoRoot,
          commit.sha,
          input.file,
          range.startLine,
          range.endLine,
        );
        const hunkBytes = Buffer.byteLength(hunk, 'utf8');
        if (combinedHunkBytes + hunkBytes > MAX_HUNK_BYTES) {
          // This item would exceed the cap — replace with empty (R10.2)
          hunk = '';
        } else {
          combinedHunkBytes += hunkBytes;
        }
      }
      // else: already over cap, hunk stays ""

      // Changed files (R4.2)
      let files: string[] = [];
      beforeGit('listing changed files');
      try {
        files = await changedFiles(repoRoot, commit.sha);
      } catch {
        // non-fatal: leave files as []
      }

      // Refs + suspicious check (R5, R11.3); the author is scanned, the hunk is not
      // (ward-hardening R6.1, design.md §7)
      const refs = parseRefs(`${commit.subject} ${commit.body}`);
      const suspiciousMessage = isSuspicious(
        `${commit.author}\n${commit.subject}\n${commit.body}`,
      );

      // GitHub PR/issue enrichment (R6). ward-hardening R12.6, R12.7: skipped once the summon
      // deadline has passed, and each request is bounded by GITHUB_TIMEOUT_MS, so a hung API
      // holds the clone at most the deadline plus that timeout.
      let pr: EvidenceItem['pr'];
      if (ghInfo && refs.length > 0 && input.githubToken && !beforeGit.passed()) {
        // Try the first ref; non-fatal on failure
        const firstRef = refs[0];
        if (firstRef !== undefined) {
          const ghResult = await fetchGitHubRef(
            ghInfo.owner,
            ghInfo.repo,
            firstRef,
            input.githubToken,
          );
          if (ghResult) {
            pr = { title: ghResult.title, body: ghResult.body };
          }
        }
      }

      // Truncate subject/body to spec limits (R10.3), and author/email to the schema's
      // limits (ward-hardening R11.13); isSuspicious above saw the full author
      const subject = commit.subject.slice(0, 512);
      const body = commit.body.slice(0, 4096);

      const item: EvidenceItem = {
        id: `E${i + 1}`,
        sha: commit.sha,
        shortSha: commit.sha.slice(0, 7),
        author: commit.author.slice(0, MAX_AUTHOR_CHARS),
        email: commit.email.slice(0, MAX_EMAIL_CHARS),
        date: commit.date,
        subject,
        body,
        hunk,
        files,
        refs,
        suspiciousMessage,
        ...(pr !== undefined ? { pr } : {}),
      };

      items.push(item);
    }

    // Step 10 — freeze (R7.2)
    items.forEach(Object.freeze);
    Object.freeze(items);
    lines.forEach(Object.freeze);
    Object.freeze(lines);

    const buildDurationMs = performance.now() - t0;

    // ward-hardening R11.12: the map read has settled; check the clone size once more, since
    // blame, log -L and show may have fetched blobs the blob-less clone left out
    const haunting = mapRun ? await mapRun : undefined;
    if (isRemote) {
      const bytes = await cloneSizeBytes(repoRoot);
      if (bytes !== null && bytes > CLONE_MAX_BYTES) {
        throw new CloneError(
          `The clone grew past the size cap (${CLONE_MAX_MB} MB) while its history was read`,
        );
      }
    }

    return {
      items: items as readonly EvidenceItem[],
      truncated,
      buildDurationMs,
      lines,
      shallow,
      range,
      ...(haunting ? { haunting } : {}),
    };
  } finally {
    // The reader settles before the clone is deleted, whether the ledger succeeded or not, so
    // no git process reads a directory being removed (haunting-map R1.8)
    if (mapRun) await mapRun;
    // Always clean up cloned repos (R8.2)
    if (cleanup) {
      await cleanup();
    }
  }
}
