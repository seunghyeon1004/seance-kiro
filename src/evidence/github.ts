/**
 * github.ts — GitHub REST API enrichment for issue/PR text.
 *
 * All errors are caught internally; failures return `undefined` — never throws.
 * SSRF guard: host must be exactly `api.github.com` (R6.3).
 * Rate-limit guard: skip call when X-RateLimit-Remaining is "0" (spec §2).
 */

import { z } from 'zod';
import { SsrfError } from '../errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_HOST = 'api.github.com';

/** ward-hardening R12.6: one GitHub request (headers and body) never takes longer than this. */
export const GITHUB_TIMEOUT_DEFAULT_MS = 5_000;

/** GITHUB_TIMEOUT_MS, read per call; a missing or invalid value gives the default. */
function githubTimeoutMs(): number {
  const n = Number(process.env['GITHUB_TIMEOUT_MS']);
  return Number.isFinite(n) && n > 0 ? n : GITHUB_TIMEOUT_DEFAULT_MS;
}

/** Thrown inside fetchGitHubRef when the timeout fires; never leaves the module. */
class GitHubTimeout extends Error {}

// ---------------------------------------------------------------------------
// Zod schema for a minimal GitHub issue/PR response (R6.4)
// ---------------------------------------------------------------------------

const GitHubIssueSchema = z.object({
  title: z.string(),
  body: z
    .string()
    .nullable()
    .transform((v) => v ?? ''),
});

// ---------------------------------------------------------------------------
// parseGitHubRemote (R8.1)
// ---------------------------------------------------------------------------

const GITHUB_URL_RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/;

/**
 * Extract `{ owner, repo }` from a `https://github.com/…` URL.
 * Returns `null` for non-GitHub or malformed URLs.
 */
export function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
  const m = GITHUB_URL_RE.exec(url);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2];
  if (!owner || !repo) return null;
  return { owner, repo };
}

// ---------------------------------------------------------------------------
// SSRF guard (R6.3)
// ---------------------------------------------------------------------------

/**
 * Build an API URL and validate the host is exactly `api.github.com`.
 * Throws SsrfError if the constructed URL has a different host.
 *
 * We construct the URL ourselves and check it — we never follow redirects to
 * other hosts (the fetch options below disable redirects).
 */
function buildApiUrl(owner: string, repo: string, refNumber: string): URL {
  const n = refNumber.replace(/^#/, '');
  const url = new URL(`https://${ALLOWED_HOST}/repos/${owner}/${repo}/issues/${n}`);
  if (url.hostname !== ALLOWED_HOST) {
    throw new SsrfError(
      `SSRF guard: API URL hostname "${url.hostname}" is not "${ALLOWED_HOST}"`,
    );
  }
  return url;
}

// ---------------------------------------------------------------------------
// fetchGitHubRef (R6.1, R6.2, R6.3, R6.4)
// ---------------------------------------------------------------------------

/**
 * Fetch the title and body of a GitHub PR or issue reference (e.g. `"#42"`).
 *
 * - Returns `{ title, body }` on success.
 * - Returns `undefined` on any failure (network error, rate-limit, missing
 *   token, non-GitHub repo, Zod parse failure, timeout) — never rethrows.
 * - ward-hardening R12.6: the request and its body are bounded by GITHUB_TIMEOUT_MS (5000 ms by
 *   default). The fetch gets an AbortSignal, and the whole call is raced against the same
 *   timer, so even a fetch that ignores the signal cannot hold the summon.
 */
export async function fetchGitHubRef(
  owner: string,
  repo: string,
  ref: string,
  token?: string,
): Promise<{ title: string; body: string } | undefined> {
  const ms = githubTimeoutMs();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new GitHubTimeout(`GitHub request for ${ref} timed out after ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([
      fetchGitHubRefOnce(owner, repo, ref, token, controller.signal),
      timeout,
    ]);
  } catch (err) {
    console.warn(
      `[seance:github] ${err instanceof GitHubTimeout ? err.message : `Request for ${ref} failed: ${String(err)}`}`,
    );
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGitHubRefOnce(
  owner: string,
  repo: string,
  ref: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<{ title: string; body: string } | undefined> {
  let url: URL;
  try {
    url = buildApiUrl(owner, repo, ref);
  } catch (err) {
    // SsrfError is caught here — return undefined, never throw outside (R6.2)
    console.warn(`[seance:github] SSRF guard triggered for ref ${ref}: ${String(err)}`);
    return undefined;
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'seance/0.1.0',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers,
      // Do not follow redirects to other origins (SSRF R6.3)
      redirect: 'error',
      signal,
    });
  } catch (err) {
    console.warn(
      `[seance:github] Network error fetching ${ref} for ${owner}/${repo}: ${String(err)}`,
    );
    return undefined;
  }

  // Rate-limit guard: if remaining is 0, skip now to protect quota
  const remaining = response.headers.get('X-RateLimit-Remaining');
  if (remaining === '0') {
    console.warn(
      `[seance:github] Rate limit exhausted for GitHub API; skipping ref ${ref}`,
    );
    return undefined;
  }

  if (!response.ok) {
    console.warn(`[seance:github] Non-OK response ${response.status} for ref ${ref}`);
    return undefined;
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    console.warn(`[seance:github] Failed to parse JSON for ref ${ref}: ${String(err)}`);
    return undefined;
  }

  const parsed = GitHubIssueSchema.safeParse(json);
  if (!parsed.success) {
    console.warn(
      `[seance:github] Zod validation failed for ref ${ref}: ${parsed.error.message}`,
    );
    return undefined;
  }

  return { title: parsed.data.title, body: parsed.data.body };
}
