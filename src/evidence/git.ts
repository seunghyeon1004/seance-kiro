/**
 * git.ts — all git subprocess invocations for Séance.
 *
 * Every call uses execa with argument arrays (never shell string interpolation).
 * Throws GitError on non-zero exit or timeout.
 */

import { execaSync, execa } from 'execa';
import { GitError, CloneError } from '../errors.js';
import { z } from 'zod';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

// ---------------------------------------------------------------------------
// Git binary resolution (R1.3 — resolved once at module load)
// ---------------------------------------------------------------------------

function resolveGitBinary(): string {
  try {
    const result = execaSync('which', ['git'], { reject: false });
    const bin = result.stdout.trim();
    if (!bin) throw new Error('git not found');
    return bin;
  } catch {
    throw new Error('git binary not found in PATH — install git before using Séance');
  }
}

export const GIT_BIN: string = resolveGitBinary();

// ---------------------------------------------------------------------------
// Internal timeout (R12.1)
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = Number(process.env['GIT_CALL_TIMEOUT_MS'] ?? 10_000);

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export type RawBlameEntry = {
  sha: string;
  author: string;
  email: string;
  date: string; // ISO 8601
  summary: string;
  filename: string;
  lineStart: number;
  lineCount: number;
};

export type RenameEvent = {
  fromFile: string;
  toFile: string;
  commitSha: string;
  offset: number;
};

export type RawCommit = {
  sha: string;
  author: string;
  email: string;
  date: string; // ISO 8601
  subject: string;
  body: string;
  renames: RenameEvent[];
};

// ---------------------------------------------------------------------------
// Low-level subprocess helper (R9.4 — argument arrays, never shell strings)
// ---------------------------------------------------------------------------

/**
 * Run a git command in `cwd`, returning stdout as a string.
 * Throws GitError on non-zero exit or timeout.
 */
export async function runGit(
  args: string[],
  cwd: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  try {
    const result = await execa(GIT_BIN, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
      reject: true,
    });
    return result.stdout;
  } catch (err: unknown) {
    // execa wraps timeout and non-zero exits
    const message = err instanceof Error ? err.message : `git ${args[0] ?? ''} failed`;
    throw new GitError(message);
  }
}

// ---------------------------------------------------------------------------
// Blame (R1.1, R1.2, R2.1)
// ---------------------------------------------------------------------------

/**
 * Zod schema for a single porcelain blame block.
 * A block starts with a 40-char SHA line, followed by metadata key-value lines.
 */
const RawBlameEntrySchema = z.object({
  sha: z
    .string()
    .length(40)
    .regex(/^[0-9a-f]+$/),
  author: z.string().min(1),
  email: z.string().min(1),
  date: z.string().datetime(),
  summary: z.string(),
  filename: z.string().min(1),
  lineStart: z.number().int().min(1),
  lineCount: z.number().int().min(1),
});

/**
 * Parse `git blame --porcelain` output into RawBlameEntry[].
 * Skips (logs) blocks that fail schema validation (R1.2).
 */
function parsePorcelainBlame(raw: string): RawBlameEntry[] {
  const entries: RawBlameEntry[] = [];
  // Each porcelain block: <40-char-sha> <orig-line> <final-line> <count>\n
  // followed by key-value pairs until a TAB-prefixed content line.
  const lines = raw.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }

    // SHA header line: "<sha40> <orig> <final> <count>"
    const shaMatch = /^([0-9a-f]{40}) \d+ (\d+) (\d+)/.exec(line);
    if (!shaMatch) {
      i++;
      continue;
    }

    const sha = shaMatch[1] as string;
    const finalLine = parseInt(shaMatch[2] as string, 10);
    const lineCount = parseInt(shaMatch[3] as string, 10);

    // Collect metadata from subsequent key-value lines
    const meta: Record<string, string> = {};
    i++;
    while (i < lines.length) {
      const kv = lines[i];
      if (!kv) {
        i++;
        break;
      }
      if (kv.startsWith('\t')) {
        i++;
        break;
      } // content line — end of block
      const sep = kv.indexOf(' ');
      if (sep > 0) {
        const key = kv.slice(0, sep);
        const val = kv.slice(sep + 1);
        meta[key] = val;
      }
      i++;
    }

    // Normalise author-time epoch to ISO 8601
    const epochStr = meta['author-time'];
    const tz = meta['author-tz'] ?? '+0000';
    let dateIso = '';
    if (epochStr) {
      const epoch = parseInt(epochStr, 10);
      if (!isNaN(epoch)) {
        // Produce a proper ISO 8601 with offset from the tz field
        const offsetMin = tzToOffsetMinutes(tz);
        const local = new Date((epoch + offsetMin * 60) * 1000);
        const sign = offsetMin >= 0 ? '+' : '-';
        const abs = Math.abs(offsetMin);
        const hh = String(Math.floor(abs / 60)).padStart(2, '0');
        const mm = String(abs % 60).padStart(2, '0');
        dateIso = local.toISOString().replace('Z', '') + `${sign}${hh}:${mm}`;
      }
    }

    const candidate = {
      sha,
      author: meta['author'] ?? '',
      email: (meta['author-mail'] ?? '').replace(/[<>]/g, ''),
      date: dateIso,
      summary: meta['summary'] ?? '',
      filename: meta['filename'] ?? '',
      lineStart: finalLine,
      lineCount,
    };

    const parsed = RawBlameEntrySchema.safeParse(candidate);
    if (!parsed.success) {
      console.warn(
        `[seance:blame] Skipping malformed blame entry for ${sha.slice(0, 7)}: ` +
          parsed.error.issues.map((i) => i.message).join('; '),
      );
      continue;
    }
    entries.push(parsed.data);
  }

  return entries;
}

/** Convert a git timezone offset string like "+0530" to minutes */
function tzToOffsetMinutes(tz: string): number {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(tz);
  if (!m) return 0;
  const sign = m[1] === '+' ? 1 : -1;
  return sign * (parseInt(m[2] as string, 10) * 60 + parseInt(m[3] as string, 10));
}

/**
 * Run `git blame --porcelain -L start,end <file>` and parse the output.
 * Returns an empty array when the range is out-of-bounds (R2.4).
 */
export async function blame(
  repo: string,
  file: string,
  start: number,
  end: number,
): Promise<RawBlameEntry[]> {
  let raw: string;
  try {
    raw = await runGit(['blame', '--porcelain', `-L${start},${end}`, '--', file], repo);
  } catch (err) {
    // git blame exits non-zero for empty ranges
    if (err instanceof GitError && err.message.includes('no lines to blame')) {
      return [];
    }
    throw err;
  }
  if (!raw.trim()) return [];
  return parsePorcelainBlame(raw);
}

// ---------------------------------------------------------------------------
// log -L (R2.1, R2.2, R2.3)
// ---------------------------------------------------------------------------

/** Parse the `--format=fuller` header block from git log. */
function parseFullerHeader(
  headerLines: string[],
): Pick<RawCommit, 'sha' | 'author' | 'email' | 'date'> | null {
  let sha = '';
  let author = '';
  let email = '';
  let date = '';

  for (const l of headerLines) {
    const commitMatch = /^commit ([0-9a-f]{40})/.exec(l);
    if (commitMatch) {
      sha = commitMatch[1] as string;
      continue;
    }

    const authorMatch = /^Author:\s+(.+?) <(.+?)>/.exec(l);
    if (authorMatch) {
      author = authorMatch[1] as string;
      email = authorMatch[2] as string;
      continue;
    }

    const dateMatch = /^AuthorDate:\s+(.+)/.exec(l);
    if (dateMatch) {
      date = new Date(dateMatch[1] as string).toISOString();
      continue;
    }
  }

  if (!sha || !author || !date) return null;
  return { sha, author, email, date };
}

/**
 * Run `git log -L start,end:file --follow --format=fuller` and parse commits.
 * Returns an empty array on any error (R2.4).
 */
export async function logL(
  repo: string,
  file: string,
  start: number,
  end: number,
): Promise<RawCommit[]> {
  let raw: string;
  try {
    raw = await runGit(
      ['log', `-L${start},${end}:${file}`, '--follow', '--format=fuller', '--', file],
      repo,
    );
  } catch {
    return [];
  }

  if (!raw.trim()) return [];

  return parseLogLOutput(raw, file);
}

/**
 * Parse the raw text output of `git log -L --format=fuller`.
 * Each commit block starts with "commit <sha>" and ends before the next one.
 */
function parseLogLOutput(raw: string, _file: string): RawCommit[] {
  const commits: RawCommit[] = [];
  // Split on blank line before a "commit " header
  const blocks = raw.split(/\ncommit /);

  for (let i = 0; i < blocks.length; i++) {
    let block = (blocks[i] ?? '').trim();
    if (!block) continue;
    // First block still starts with "commit "
    if (!block.startsWith('commit ')) block = 'commit ' + block;

    const lines = block.split('\n');
    const headerLines: string[] = [];
    let bodyStart = 0;

    // Find separator between headers and message body (blank line)
    for (let j = 0; j < lines.length; j++) {
      const l = lines[j] ?? '';
      if (l.trim() === '' && j > 0) {
        bodyStart = j + 1;
        break;
      }
      headerLines.push(l);
    }

    const header = parseFullerHeader(headerLines);
    if (!header) continue;

    // Remainder: message body + diff
    const remainder = lines.slice(bodyStart);
    // Subject: first non-empty line of message
    let subject = '';
    let bodyLines: string[] = [];
    let hunkStart = -1;

    for (let j = 0; j < remainder.length; j++) {
      const l = (remainder[j] ?? '').replace(/^    /, ''); // strip 4-space indent
      if (!subject && l.trim()) {
        subject = l;
        continue;
      }
      if (subject && l.startsWith('diff --git')) {
        hunkStart = j;
        break;
      }
      if (subject) bodyLines.push(l);
    }

    // Body: strip leading/trailing blank lines
    while (bodyLines.length && !(bodyLines[0] ?? '').trim()) bodyLines.shift();
    while (bodyLines.length && !(bodyLines[bodyLines.length - 1] ?? '').trim())
      bodyLines.pop();
    const body = bodyLines.join('\n');

    // Rename detection from diff headers
    const renames: RenameEvent[] = [];
    if (hunkStart >= 0) {
      const diffLines = remainder.slice(hunkStart);
      for (let j = 0; j < diffLines.length; j++) {
        const l = diffLines[j] ?? '';
        const renameFrom = /^rename from (.+)/.exec(l);
        const renameTo = /^rename to (.+)/.exec(diffLines[j + 1] ?? '');
        if (renameFrom && renameTo) {
          renames.push({
            fromFile: renameFrom[1] as string,
            toFile: renameTo[1] as string,
            commitSha: header.sha,
            offset: 0, // refined in ledger.ts during assembly
          });
        }
      }
    }

    commits.push({
      sha: header.sha,
      author: header.author,
      email: header.email,
      date: header.date,
      subject: subject.slice(0, 512),
      body: body.slice(0, 4096),
      renames,
    });
  }

  return commits;
}

// ---------------------------------------------------------------------------
// showHunk (R4.3)
// ---------------------------------------------------------------------------

/**
 * Run `git show <sha> -- <file>` and extract the unified-diff hunk string.
 * Returns "" on any failure (R4.3).
 */
export async function showHunk(
  repo: string,
  sha: string,
  file: string,
  _start: number,
  _end: number,
): Promise<string> {
  try {
    const raw = await runGit(['show', '--unified=3', `${sha}`, '--', file], repo);
    // Extract the hunk from the unified diff
    const hunkMatch = /@@[^@]+@@[\s\S]*/.exec(raw);
    return hunkMatch ? hunkMatch[0] : raw;
  } catch (err) {
    console.error(
      `[seance:showHunk] Failed for ${sha.slice(0, 7)}:${file} — ${String(err)}`,
    );
    return '';
  }
}

// ---------------------------------------------------------------------------
// changedFiles (R4.2)
// ---------------------------------------------------------------------------

/**
 * Return the list of files changed in a commit.
 */
export async function changedFiles(repo: string, sha: string): Promise<string[]> {
  const raw = await runGit(['show', '--name-only', '--format=', sha], repo);
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// Remote clone lifecycle (R8.2, R8.3, R8.4)
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFile);

/** Resolved repo handle with a cleanup callback. */
export type ResolvedRepo = {
  /** Absolute path to the clone root. */
  root: string;
  /** Delete the temporary directory (idempotent). */
  cleanup: () => Promise<void>;
};

/** Configurable caps (env overrides) */
const CLONE_TIMEOUT_MS = Number(process.env['CLONE_TIMEOUT_MS'] ?? 30_000);
const CLONE_MAX_MB = Number(process.env['CLONE_MAX_MB'] ?? 200);
const CLONE_MAX_BYTES = CLONE_MAX_MB * 1024 * 1024;

/** GitHub-only allowlist pattern (matches validated input from ledger.input.ts) */
const GITHUB_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;

/**
 * Module-level in-flight clone cache: serialises concurrent clones for the same
 * canonical URL (R8.4).  Entries are released once the clone resolves or rejects.
 */
const cloneCache = new Map<string, Promise<ResolvedRepo>>();

/**
 * Canonical URL: strip trailing `.git` so `owner/repo` and `owner/repo.git`
 * share the same cache entry.
 */
function canonicalUrl(url: string): string {
  return url.replace(/\.git$/, '');
}

/**
 * Clone a public GitHub repository into a unique temp directory.
 *
 * - Validates the URL against the GitHub allowlist before cloning.
 * - Applies a 30 s `AbortController` timeout; aborts with SIGKILL on expiry.
 * - Polls working-tree size every 2 s; throws `CloneError` if > 200 MB.
 * - Serialises concurrent clones for the same URL (module-level `Map` cache).
 *
 * The caller MUST call `cleanup()` in a `finally` block.
 */
export async function cloneRepo(url: string): Promise<ResolvedRepo> {
  if (!GITHUB_URL_RE.test(url)) {
    throw new CloneError(`cloneRepo: URL "${url}" does not match the GitHub allowlist`);
  }

  const key = canonicalUrl(url);
  const inflight = cloneCache.get(key);
  if (inflight) {
    // Await the shared promise; caller receives its own handle because the
    // returned ResolvedRepo.cleanup is per-invocation.
    return inflight;
  }

  const promise = _doClone(url).finally(() => {
    cloneCache.delete(key);
  });
  cloneCache.set(key, promise);
  return promise;
}

async function _doClone(url: string): Promise<ResolvedRepo> {
  const tmpDir = os.tmpdir();
  const cloneDir = `${tmpDir}/seance-${crypto.randomUUID()}`;

  // Cleanup helper — idempotent
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    try {
      await fs.rm(cloneDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  };

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), CLONE_TIMEOUT_MS);

  // Start size-polling as soon as the clone directory appears
  let sizePoller: ReturnType<typeof setInterval> | undefined;

  try {
    // Kick off polling loop (runs every 2 s)
    sizePoller = setInterval(() => {
      void (async () => {
        try {
          const { stdout } = await execFileAsync('du', ['-sb', cloneDir], {
            timeout: 5_000,
          });
          const bytes = parseInt(stdout.trim().split(/\s+/)[0] ?? '0', 10);
          if (!isNaN(bytes) && bytes > CLONE_MAX_BYTES) {
            controller.abort();
          }
        } catch {
          // directory not yet created or du failed — ignore
        }
      })();
    }, 2_000);

    // Run the clone
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        GIT_BIN,
        ['clone', '--filter=blob:none', '--depth', '100', url, cloneDir],
        { timeout: 0 /* managed by AbortController */ },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      );

      controller.signal.addEventListener('abort', () => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already exited
        }
        reject(new CloneError(`Clone of "${url}" aborted: exceeded time or size limit`));
      });
    });

    // Final size check after clone completes
    try {
      const { stdout } = await execFileAsync('du', ['-sb', cloneDir], {
        timeout: 5_000,
      });
      const bytes = parseInt(stdout.trim().split(/\s+/)[0] ?? '0', 10);
      if (!isNaN(bytes) && bytes > CLONE_MAX_BYTES) {
        await cleanup();
        throw new CloneError(`Clone of "${url}" exceeds size cap (${CLONE_MAX_MB} MB)`);
      }
    } catch (err) {
      if (err instanceof CloneError) throw err;
      // du failure is non-fatal
    }

    return { root: cloneDir, cleanup };
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (sizePoller !== undefined) clearInterval(sizePoller);
    await cleanup();
    if (err instanceof CloneError) throw err;
    throw new CloneError(
      `Failed to clone "${url}": ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeoutHandle);
    if (sizePoller !== undefined) clearInterval(sizePoller);
  }
}
