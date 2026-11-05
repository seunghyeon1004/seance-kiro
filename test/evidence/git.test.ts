/**
 * T3 unit tests for src/evidence/git.ts
 *
 * All git subprocesses are replaced by spies / stubs so no real git call
 * happens in CI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitError } from '../../src/errors.js';

// ---------------------------------------------------------------------------
// We need to spy on the `execa` module before importing git.ts.
// Because git.ts imports execa at module load we use vi.mock to intercept it.
// ---------------------------------------------------------------------------

vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('execa')>();
  return {
    ...actual,
    // execaSync is used at module init to find git — return a fake path
    execaSync: vi.fn(() => ({ stdout: '/usr/bin/git' })),
    execa: vi.fn(),
  };
});

// Import after mock is set up
const { execa, execaSync } = await import('execa');
const { runGit, blame, changedFiles, showHunk } = await import(
  '../../src/evidence/git.js'
);

const mockExeca = vi.mocked(execa);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExecaResult(stdout: string) {
  return Promise.resolve({ stdout, stderr: '', exitCode: 0 });
}

function makeExecaError(message: string) {
  return Promise.reject(Object.assign(new Error(message), { exitCode: 1 }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// runGit — argument array construction
// ---------------------------------------------------------------------------

describe('runGit', () => {
  it('calls execa with the correct binary and args', async () => {
    mockExeca.mockReturnValueOnce(makeExecaResult('hello\n') as never);
    await runGit(['status'], '/repo');
    const call = mockExeca.mock.calls[0];
    // First arg: git binary path (resolved at module init)
    expect(call?.[0]).toMatch(/git$/);
    // Second arg: args array contains 'status'
    expect(call?.[1]).toEqual(['status']);
    // cwd is passed via options
    expect((call?.[2] as { cwd?: string })?.cwd).toBe('/repo');
  });

  it('passes timeout option through', async () => {
    mockExeca.mockReturnValueOnce(makeExecaResult('') as never);
    await runGit(['log'], '/repo', 5_000);
    const opts = mockExeca.mock.calls[0]?.[2] as { timeout?: number };
    expect(opts?.timeout).toBe(5_000);
  });

  it('uses stdio pipe options', async () => {
    mockExeca.mockReturnValueOnce(makeExecaResult('') as never);
    await runGit(['version'], '/repo');
    const opts = mockExeca.mock.calls[0]?.[2] as { stdio?: unknown };
    expect(opts?.stdio).toEqual(['pipe', 'pipe', 'pipe']);
  });

  it('throws GitError on non-zero exit', async () => {
    mockExeca.mockReturnValueOnce(makeExecaError('fatal: not a git repo') as never);
    await expect(runGit(['status'], '/not-a-repo')).rejects.toThrow(GitError);
  });

  it('throws GitError on timeout', async () => {
    mockExeca.mockReturnValueOnce(
      Promise.reject(Object.assign(new Error('Timed out'), { timedOut: true })) as never,
    );
    await expect(runGit(['log'], '/repo', 1)).rejects.toThrow(GitError);
  });
});

// ---------------------------------------------------------------------------
// blame — argument construction
// ---------------------------------------------------------------------------

describe('blame', () => {
  it('passes correct -L flag and file to git blame --porcelain', async () => {
    // Minimal valid porcelain output (no entries → empty array)
    mockExeca.mockReturnValueOnce(makeExecaResult('') as never);
    const result = await blame('/repo', 'src/foo.ts', 10, 20);
    const args = mockExeca.mock.calls[0]?.[1] as string[];
    expect(args).toContain('blame');
    expect(args).toContain('--porcelain');
    expect(args).toContain('-L10,20');
    expect(args).toContain('src/foo.ts');
    expect(result).toEqual([]);
  });

  it('returns empty array when git blame exits with "no lines to blame"', async () => {
    mockExeca.mockReturnValueOnce(
      Promise.reject(
        Object.assign(new Error('no lines to blame'), { exitCode: 128 }),
      ) as never,
    );
    const result = await blame('/repo', 'empty.ts', 1, 5);
    expect(result).toEqual([]);
  });

  it('throws GitError for other non-zero exits', async () => {
    mockExeca.mockReturnValueOnce(makeExecaError('fatal: path not found') as never);
    await expect(blame('/repo', 'missing.ts', 1, 5)).rejects.toThrow(GitError);
  });
});

// ---------------------------------------------------------------------------
// changedFiles — argument construction
// ---------------------------------------------------------------------------

describe('changedFiles', () => {
  it('passes correct args to git show --name-only', async () => {
    mockExeca.mockReturnValueOnce(
      makeExecaResult('src/a.ts\nsrc/b.ts\n') as never,
    );
    const files = await changedFiles('/repo', 'abc1234' + '0'.repeat(33));
    const args = mockExeca.mock.calls[0]?.[1] as string[];
    expect(args).toContain('show');
    expect(args).toContain('--name-only');
    expect(args).toContain('--format=');
    expect(files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('filters out blank lines from output', async () => {
    mockExeca.mockReturnValueOnce(makeExecaResult('\nsrc/a.ts\n\n') as never);
    const files = await changedFiles('/repo', 'abc1234' + '0'.repeat(33));
    expect(files).toEqual(['src/a.ts']);
  });
});

// ---------------------------------------------------------------------------
// showHunk — returns "" on failure
// ---------------------------------------------------------------------------

describe('showHunk', () => {
  const sha = 'a'.repeat(40);

  it('returns the hunk portion of git show output', async () => {
    const diffOutput =
      'diff --git a/src/foo.ts b/src/foo.ts\nindex 123..456 100644\n' +
      '@@ -10,6 +10,7 @@\n context\n+new line\n';
    mockExeca.mockReturnValueOnce(makeExecaResult(diffOutput) as never);
    const result = await showHunk('/repo', sha, 'src/foo.ts', 10, 16);
    expect(result).toContain('@@');
    expect(result).toContain('+new line');
  });

  it('returns empty string on failure (does not throw)', async () => {
    mockExeca.mockReturnValueOnce(makeExecaError('not found') as never);
    const result = await showHunk('/repo', sha, 'missing.ts', 1, 5);
    expect(result).toBe('');
  });
});
