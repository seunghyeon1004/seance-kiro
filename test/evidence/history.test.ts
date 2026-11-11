/**
 * first-seance T2 — honest history and the line in question (R8.1, R8.3, R2.1).
 *
 * Real git runs on repositories built in a temp dir: a 3-commit repo made here and the crypt
 * sample built with scripts/make-crypt.sh. The cases that need a failing or silent git use a
 * fresh copy of git.ts (vi.resetModules) with execa mocked, or with GIT_CALL_TIMEOUT_MS=1,
 * so the real-git cases above them are untouched. No network.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isShallowRepo,
  logL,
  readLines,
  SOURCE_MAX_CHARS,
  SOURCE_MAX_LINES,
} from '../../src/evidence/git.js';
import { HistoryError } from '../../src/errors.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let TMP = '';
let REPO = '';
let CRYPT = '';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test Author',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test Author',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
  HOME: os.tmpdir(),
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
}

const LONG_LINE = 'x'.repeat(1000);

/** A repo with three commits: a 60-line a.txt, then line 7 changed, then line 10 changed. */
function makeRepo(dir: string): void {
  fs.mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
  fs.writeFileSync(path.join(dir, 'a.txt'), lines.join('\n') + '\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'one');
  lines[6] = 'line 7, changed';
  fs.writeFileSync(path.join(dir, 'a.txt'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'long.txt'), `short\n${LONG_LINE}\nend\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'two');
  lines[9] = 'line 10, changed';
  fs.writeFileSync(path.join(dir, 'a.txt'), lines.join('\n') + '\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'three');
}

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-history-'));
  REPO = path.join(TMP, 'repo');
  makeRepo(REPO);
  CRYPT = path.join(TMP, 'crypt');
  execFileSync('bash', [path.join(ROOT, 'scripts/make-crypt.sh'), CRYPT], { cwd: ROOT });
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

afterEach(() => {
  vi.doUnmock('execa');
  vi.doUnmock('../../src/evidence/git.js');
  vi.resetModules();
  vi.restoreAllMocks();
  delete process.env['GIT_CALL_TIMEOUT_MS'];
});

// ---------------------------------------------------------------------------
// R8.1 — logL
// ---------------------------------------------------------------------------

describe('logL (R8.1)', () => {
  it('returns the commits of a real range', async () => {
    const commits = await logL(REPO, 'a.txt', 7, 7);
    expect(commits.map((c) => c.subject)).toEqual(['two', 'one']);
  });

  it('throws HistoryError when git log -L exits non-zero (a path git does not know)', async () => {
    await expect(logL(REPO, 'no-such-file.txt', 1, 1)).rejects.toBeInstanceOf(
      HistoryError,
    );
  });

  it('throws HistoryError when git log -L times out (GIT_CALL_TIMEOUT_MS=1)', async () => {
    process.env['GIT_CALL_TIMEOUT_MS'] = '1';
    vi.resetModules();
    const fresh = await import('../../src/evidence/git.js');
    const freshErrors = await import('../../src/errors.js');
    const err = await fresh.logL(REPO, 'a.txt', 1, 60).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(freshErrors.HistoryError);
    expect((err as InstanceType<typeof freshErrors.HistoryError>).code).toBe(
      'HISTORY_ERROR',
    );
  });

  describe('with execa mocked', () => {
    async function mockedGit(execaImpl: () => Promise<unknown>): Promise<{
      git: typeof import('../../src/evidence/git.js');
      errors: typeof import('../../src/errors.js');
    }> {
      vi.resetModules();
      vi.doMock('execa', async (importOriginal) => {
        const actual = await importOriginal<typeof import('execa')>();
        return {
          ...actual,
          execaSync: vi.fn(() => ({ stdout: '/usr/bin/git' })),
          execa: vi.fn(execaImpl),
        };
      });
      return {
        git: await import('../../src/evidence/git.js'),
        errors: await import('../../src/errors.js'),
      };
    }

    it('a runGit rejection becomes HistoryError, not []', async () => {
      const { git: g, errors } = await mockedGit(() =>
        Promise.reject(
          Object.assign(new Error('fatal: bad revision'), { exitCode: 128 }),
        ),
      );
      const err = await g.logL('/repo', 'a.txt', 1, 2).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(errors.HistoryError);
      expect(err).not.toBeInstanceOf(errors.GitError);
      expect((err as Error).message).toContain('fatal: bad revision');
    });

    it('empty output with exit code 0 still returns []', async () => {
      const { git: g } = await mockedGit(() =>
        Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
      );
      expect(await g.logL('/repo', 'a.txt', 1, 2)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// R8.3 — isShallowRepo
// ---------------------------------------------------------------------------

describe('isShallowRepo (R8.3)', () => {
  it('is true for git clone --depth 1 of a 3-commit repo', async () => {
    const dir = path.join(TMP, 'shallow');
    git(TMP, 'clone', '-q', '--depth', '1', `file://${REPO}`, dir);
    expect(await isShallowRepo(dir)).toBe(true);
  });

  it('is false for a full clone', async () => {
    const dir = path.join(TMP, 'full');
    git(TMP, 'clone', '-q', `file://${REPO}`, dir);
    expect(await isShallowRepo(dir)).toBe(false);
  });

  it('is false on any error (not a repository)', async () => {
    const dir = path.join(TMP, 'plain');
    fs.mkdirSync(dir, { recursive: true });
    expect(await isShallowRepo(dir)).toBe(false);
    expect(await isShallowRepo(path.join(TMP, 'missing'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R2.1 — readLines
// ---------------------------------------------------------------------------

describe('readLines (R2.1)', () => {
  it('returns line 7 of legacy/tax.js from the built crypt', async () => {
    const head = git(CRYPT, 'show', 'HEAD:legacy/tax.js').split('\n');
    const lines = await readLines(CRYPT, 'legacy/tax.js', 7, 7);
    expect(lines).toEqual([{ n: 7, text: head[6] }]);
    expect(lines[0]?.text.length).toBeGreaterThan(0);
  });

  it('reads the file as it is at HEAD', async () => {
    expect(await readLines(REPO, 'a.txt', 7, 10)).toEqual([
      { n: 7, text: 'line 7, changed' },
      { n: 8, text: 'line 8' },
      { n: 9, text: 'line 9' },
      { n: 10, text: 'line 10, changed' },
    ]);
  });

  it('cuts a 1,000-character line to 400', async () => {
    const lines = await readLines(REPO, 'long.txt', 1, 3);
    expect(SOURCE_MAX_CHARS).toBe(400);
    expect(lines.map((l) => l.n)).toEqual([1, 2, 3]);
    expect(lines[1]?.text).toBe(LONG_LINE.slice(0, 400));
  });

  it('returns [] for a missing file, and logs a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await readLines(REPO, 'no-such-file.txt', 1, 1)).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('returns at most 40 lines for a 60-line range', async () => {
    expect(SOURCE_MAX_LINES).toBe(40);
    const lines = await readLines(REPO, 'a.txt', 1, 60);
    expect(lines).toHaveLength(40);
    expect(lines[0]).toEqual({ n: 1, text: 'line 1' });
    expect(lines[39]).toEqual({ n: 40, text: 'line 40' });
  });

  it('returns fewer lines when the range runs past the end, and [] past the end', async () => {
    expect((await readLines(REPO, 'a.txt', 58, 70)).map((l) => l.n)).toEqual([
      58, 59, 60,
    ]);
    expect(await readLines(REPO, 'a.txt', 61, 70)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R8.3, R2.1 — buildLedger passes shallow and lines on
// ---------------------------------------------------------------------------

describe('buildLedger (R8.3, R2.1)', () => {
  async function ledgerWithClone(shallow: boolean | undefined): Promise<{
    result: Awaited<
      ReturnType<typeof import('../../src/evidence/ledger.js').buildLedger>
    >;
    cleanup: ReturnType<typeof vi.fn>;
  }> {
    vi.resetModules();
    const cleanup = vi.fn(async () => undefined);
    vi.doMock('../../src/evidence/git.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/evidence/git.js')>();
      return {
        ...actual,
        cloneRepo: vi.fn(async () =>
          shallow === undefined
            ? { root: REPO, cleanup }
            : { root: REPO, cleanup, shallow },
        ),
      };
    });
    const { buildLedger } = await import('../../src/evidence/ledger.js');
    const result = await buildLedger({
      repoUrl: 'https://github.com/owner/repo',
      file: 'a.txt',
      startLine: 7,
      endLine: 8,
    });
    return { result, cleanup };
  }

  it('passes shallow: true on from cloneRepo', async () => {
    const { result, cleanup } = await ledgerWithClone(true);
    expect(result.shallow).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('treats a cloneRepo result with no shallow field as not shallow', async () => {
    const { result } = await ledgerWithClone(undefined);
    expect(result.shallow).toBe(false);
  });

  it('returns the lines, read before cleanup, frozen', async () => {
    const { result } = await ledgerWithClone(false);
    expect(result.lines).toEqual([
      { n: 7, text: 'line 7, changed' },
      { n: 8, text: 'line 8' },
    ]);
    expect(Object.isFrozen(result.lines)).toBe(true);
    for (const l of result.lines ?? []) expect(Object.isFrozen(l)).toBe(true);
  });

  it('a local repository is never shallow', async () => {
    const { buildLedger } = await import('../../src/evidence/ledger.js');
    const result = await buildLedger({
      repoUrl: CRYPT,
      file: 'legacy/tax.js',
      startLine: 7,
      endLine: 7,
    });
    expect(result.shallow).toBe(false);
    expect(result.lines).toHaveLength(1);
  });
});
