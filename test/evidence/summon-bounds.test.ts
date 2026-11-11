/**
 * inquisitor review (2026-11-11) — ward-hardening R11.10–R11.13.
 *
 * Finding 3: for a remote repository, one deadline for the whole summon after the clone
 * (SUMMON_DEADLINE_MS) and one more clone size check after the ledger and map reads.
 * Suspected finding: buildLedger cuts `author` and `email` to the schema's 256 characters.
 *
 * The git layer and the size probe are mocked; buildLedger, the error mapping, the clone
 * pool and the summon route are real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloneError, HistoryError } from '../../src/errors.js';
import type { RawCommit } from '../../src/evidence/git.js';

vi.mock('../../src/evidence/git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/evidence/git.js')>();
  return {
    ...actual,
    blame: vi.fn(async () => []),
    logL: vi.fn(async () => []),
    showHunk: vi.fn(async () => ''),
    changedFiles: vi.fn(async () => []),
    readLines: vi.fn(async () => []),
    logNameOnly: vi.fn(async () => ''),
    lsTreeNames: vi.fn(async () => ''),
    cloneSizeBytes: vi.fn(async () => 1024),
    cloneRepo: vi.fn(),
  };
});

const git = await import('../../src/evidence/git.js');
const { buildLedger } = await import('../../src/evidence/ledger.js');
const { EvidenceItemSchema } = await import('../../src/ghost/schema.js');
const server = await import('../../src/server.js');
const { createApp, clonePool, summonLimiter } = server;

const logL = vi.mocked(git.logL);
const showHunk = vi.mocked(git.showHunk);
const changedFiles = vi.mocked(git.changedFiles);
const cloneRepo = vi.mocked(git.cloneRepo);
const cloneSizeBytes = vi.mocked(git.cloneSizeBytes);

const REMOTE = {
  repoUrl: 'https://github.com/owner/repo',
  file: 'src/a.ts',
  startLine: 1,
  endLine: 1,
};
const LOCAL = { ...REMOTE, repoUrl: '/tmp/seance-local-not-read' };

function commits(n: number, over: Partial<RawCommit> = {}): RawCommit[] {
  return Array.from({ length: n }, (_, i) => ({
    sha: i.toString(16).padStart(40, 'a'),
    author: 'Ada',
    email: 'ada@example.com',
    date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString(),
    subject: `commit ${i}`,
    body: '',
    renames: [],
    ...over,
  }));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let cleanup: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  cleanup = vi.fn(async () => undefined);
  cloneRepo.mockResolvedValue({ root: '/tmp/seance-fake', cleanup, shallow: false });
  cloneSizeBytes.mockResolvedValue(1024);
  logL.mockResolvedValue(commits(3));
  showHunk.mockResolvedValue('');
  changedFiles.mockResolvedValue([]);
  delete process.env['SUMMON_DEADLINE_MS'];
  clonePool.reset();
  summonLimiter.reset();
});

afterEach(() => {
  delete process.env['SUMMON_DEADLINE_MS'];
});

// ---------------------------------------------------------------------------
// Ledger bounds (R11.13)
// ---------------------------------------------------------------------------

describe('buildLedger cuts author and email to 256 characters (R11.13)', () => {
  it('a 300-character author and email become 256, within the schema limits', async () => {
    logL.mockResolvedValue(
      commits(1, { author: 'A'.repeat(300), email: 'e'.repeat(300) }),
    );
    const { items } = await buildLedger(LOCAL);
    expect(items[0]?.author).toBe('A'.repeat(256));
    expect(items[0]?.email).toBe('e'.repeat(256));
    expect(EvidenceItemSchema.shape.author.safeParse(items[0]?.author).success).toBe(
      true,
    );
  });

  it('a short author and email are unchanged', async () => {
    const { items } = await buildLedger(LOCAL);
    expect(items[0]?.author).toBe('Ada');
    expect(items[0]?.email).toBe('ada@example.com');
  });
});

// ---------------------------------------------------------------------------
// Whole-summon deadline (R11.10, R11.11)
// ---------------------------------------------------------------------------

describe('one deadline for a remote summon after the clone (R11.10)', () => {
  it('50 slow per-commit git calls: the summon fails within the deadline and starts no more git calls', async () => {
    process.env['SUMMON_DEADLINE_MS'] = '300';
    logL.mockResolvedValue(commits(50));
    showHunk.mockImplementation(async () => {
      await sleep(40);
      return '';
    });
    const t0 = Date.now();
    const err = await buildLedger(REMOTE).catch((e: unknown) => e);
    const took = Date.now() - t0;
    expect(err).toBeInstanceOf(HistoryError);
    expect(took).toBeLessThan(300 + 200);
    const started = showHunk.mock.calls.length + changedFiles.mock.calls.length;
    expect(showHunk.mock.calls.length).toBeLessThan(50);
    expect(cleanup).toHaveBeenCalledTimes(1);
    await sleep(150);
    expect(showHunk.mock.calls.length + changedFiles.mock.calls.length).toBe(started);
  });

  it('the default deadline is 60 000 ms', async () => {
    const now = vi.spyOn(Date, 'now');
    let t = 1_000_000;
    now.mockImplementation(() => t);
    showHunk.mockImplementation(async () => {
      t += 59_000;
      return '';
    });
    logL.mockResolvedValue(commits(3));
    const err = await buildLedger(REMOTE).catch((e: unknown) => e);
    now.mockRestore();
    expect(err).toBeInstanceOf(HistoryError);
    // first showHunk starts at 0 s and uses 59 s; changedFiles and the second showHunk start
    // at 59 s and it uses 59 more; the next call, at 118 s, is refused
    expect(showHunk).toHaveBeenCalledTimes(2);
  });

  it('a local path and a sample have no summon deadline', async () => {
    process.env['SUMMON_DEADLINE_MS'] = '50';
    logL.mockResolvedValue(commits(5));
    showHunk.mockImplementation(async () => {
      await sleep(20);
      return '';
    });
    const { items } = await buildLedger(LOCAL);
    expect(items).toHaveLength(5);
    expect(cloneSizeBytes).not.toHaveBeenCalled();
  });

  it('a remote summon that finishes in time succeeds', async () => {
    process.env['SUMMON_DEADLINE_MS'] = '5000';
    const { items } = await buildLedger(REMOTE);
    expect(items).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Size check after the reads (R11.12)
// ---------------------------------------------------------------------------

describe('the clone size is checked again after the ledger and map reads (R11.12)', () => {
  it('a clone grown past CLONE_MAX_MB fails with CloneError and is deleted', async () => {
    cloneSizeBytes.mockResolvedValue(201 * 1024 * 1024);
    const err = await buildLedger(REMOTE, { hauntingMap: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloneError);
    expect(cloneSizeBytes).toHaveBeenCalledWith('/tmp/seance-fake');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('the check runs after the map read has settled', async () => {
    const order: string[] = [];
    vi.mocked(git.logNameOnly).mockImplementation(async () => {
      await sleep(30);
      order.push('map');
      return '';
    });
    cloneSizeBytes.mockImplementation(async () => {
      order.push('size');
      return 1024;
    });
    await buildLedger(REMOTE, { hauntingMap: true });
    expect(order).toEqual(['map', 'size']);
  });

  it('a clone at the cap passes', async () => {
    cloneSizeBytes.mockResolvedValue(200 * 1024 * 1024);
    const { items } = await buildLedger(REMOTE);
    expect(items).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Through the route (R11.11)
// ---------------------------------------------------------------------------

describe('POST /api/summon after the deadline (R11.11)', () => {
  const summon = (): Promise<Response> =>
    Promise.resolve(
      createApp({}).fetch(
        new Request('http://localhost/api/summon', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(REMOTE),
        }),
      ),
    );

  it('returns 422 HISTORY_ERROR with the fixed sentence, deletes the clone and frees the slot', async () => {
    process.env['SUMMON_DEADLINE_MS'] = '100';
    logL.mockResolvedValue(commits(50));
    showHunk.mockImplementation(async () => {
      await sleep(30);
      return '';
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await summon();
    log.mockRestore();
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      code: 'HISTORY_ERROR',
      message:
        'Git could not read the history of these lines in time. Try a smaller range, or try again.',
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(clonePool.inUse()).toBe(0);
  });

  it('a clone over the cap after the reads returns 422 CLONE_ERROR and frees the slot', async () => {
    cloneSizeBytes.mockResolvedValue(500 * 1024 * 1024);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await summon();
    log.mockRestore();
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('CLONE_ERROR');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(clonePool.inUse()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// inquisitor second pass (2026-11-11): GitHub enrichment and the deadline (R12.6, R12.7)
// ---------------------------------------------------------------------------

describe('GitHub enrichment under the summon deadline (R12.6, R12.7)', () => {
  const hungFetch = vi.fn(() => new Promise<Response>(() => undefined));
  const withToken = { ...REMOTE, githubToken: 'tok' };

  beforeEach(() => {
    hungFetch.mockClear();
    vi.stubGlobal('fetch', hungFetch);
    logL.mockResolvedValue(commits(50, { subject: 'Fix #1' }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['GITHUB_TIMEOUT_MS'];
  });

  it('a hung GitHub API: buildLedger settles within the deadline plus GITHUB_TIMEOUT_MS and deletes the clone', async () => {
    process.env['SUMMON_DEADLINE_MS'] = '100';
    process.env['GITHUB_TIMEOUT_MS'] = '150';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t0 = Date.now();
    const err = await buildLedger(withToken).catch((e: unknown) => e);
    const took = Date.now() - t0;
    warn.mockRestore();
    expect(err).toBeInstanceOf(HistoryError);
    expect(took).toBeLessThan(100 + 150 + 300);
    expect(hungFetch).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('once the deadline has passed, the enrichment is skipped: no GitHub request starts', async () => {
    process.env['SUMMON_DEADLINE_MS'] = '50';
    changedFiles.mockImplementation(async () => {
      await sleep(80); // the deadline passes during the commit's last git call
      return [];
    });
    const err = await buildLedger(withToken).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HistoryError);
    expect(hungFetch).not.toHaveBeenCalled();
  });

  it('POST /api/summon with a hung GitHub API returns HISTORY_ERROR in bounded time and frees the slot', async () => {
    process.env['SUMMON_DEADLINE_MS'] = '100';
    process.env['GITHUB_TIMEOUT_MS'] = '150';
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t0 = Date.now();
    const res = await createApp({}).fetch(
      new Request('http://localhost/api/summon', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(withToken),
      }),
    );
    const took = Date.now() - t0;
    log.mockRestore();
    warn.mockRestore();
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('HISTORY_ERROR');
    expect(took).toBeLessThan(100 + 150 + 300);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(clonePool.inUse()).toBe(0);
  });
});
