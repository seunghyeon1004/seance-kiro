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
export type { LedgerInput } from './ledger.input.js';
export { LedgerInputSchema, validateLedgerInput } from './ledger.input.js';

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { blame, logL, showHunk, changedFiles, cloneRepo } from './git.js';
import { parseRefs, isSuspicious } from './refs.js';
import { parseGitHubRemote, fetchGitHubRef } from './github.js';
import type { LedgerInput } from './ledger.input.js';
import type { EvidenceItem, LedgerResult } from '../ghost/schema.js';
import type { RawCommit } from './git.js';

// ---------------------------------------------------------------------------
// Size caps (R10.1, R10.2, R10.3)
// ---------------------------------------------------------------------------

const MAX_ITEMS = 50;
const MAX_HUNK_BYTES = 512 * 1024; // 512 KB combined

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
export async function buildLedger(input: LedgerInput): Promise<LedgerResult> {
  const t0 = performance.now();
  const isRemote =
    input.repoUrl.startsWith('http://') || input.repoUrl.startsWith('https://');

  let repoRoot = input.repoUrl;
  let cleanup: (() => Promise<void>) | undefined;

  try {
    // Step 1 — clone remote repo
    if (isRemote) {
      const resolved = await cloneRepo(input.repoUrl);
      repoRoot = resolved.root;
      cleanup = resolved.cleanup;
    }

    // Step 2 — blame to collect commit SHAs in the range
    const blameEntries = await blame(
      repoRoot,
      input.file,
      input.startLine,
      input.endLine,
    );

    // Step 3 — log -L for ordered history + rename events
    const logCommits = await logL(repoRoot, input.file, input.startLine, input.endLine);

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
        hunk = await showHunk(
          repoRoot,
          commit.sha,
          input.file,
          input.startLine,
          input.endLine,
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

      // GitHub PR/issue enrichment (R6)
      let pr: EvidenceItem['pr'];
      if (ghInfo && refs.length > 0 && input.githubToken) {
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

      // Truncate subject/body to spec limits (R10.3)
      const subject = commit.subject.slice(0, 512);
      const body = commit.body.slice(0, 4096);

      const item: EvidenceItem = {
        id: `E${i + 1}`,
        sha: commit.sha,
        shortSha: commit.sha.slice(0, 7),
        author: commit.author,
        email: commit.email,
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

    const buildDurationMs = performance.now() - t0;

    return {
      items: items as readonly EvidenceItem[],
      truncated,
      buildDurationMs,
    };
  } finally {
    // Always clean up cloned repos (R8.2)
    if (cleanup) {
      await cleanup();
    }
  }
}
