/**
 * evidence-ledger T6: cloneRepo lifecycle, without network.
 * child_process.execFile is mocked so that "git clone" and "du" are under test control.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promisify } from 'node:util';

type Cb = (err: Error | null, stdout?: string, stderr?: string) => void;
const state: {
  clone: 'hang' | 'ok';
  duBytes: number;
  killed: number;
  calls: string[][];
} = {
  clone: 'hang',
  duBytes: 0,
  killed: 0,
  calls: [],
};

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const execFile = vi.fn((cmd: string, args: string[], _opts: unknown, cb: Cb) => {
    state.calls.push([cmd, ...args]);
    if (state.clone === 'ok') setTimeout(() => cb(null, '', ''), 5);
    return {
      kill: () => {
        state.killed++;
        return true;
      },
    };
  });
  // git.ts uses promisify(execFile) for "du": resolve with { stdout } like the real one.
  (execFile as unknown as Record<symbol, unknown>)[promisify.custom] = async (
    cmd: string,
    args: string[],
  ) => {
    state.calls.push([cmd, ...args]);
    // du -sk reports KiB
    return {
      stdout: `${Math.ceil(state.duBytes / 1024)}\t${args[args.length - 1]}\n`,
      stderr: '',
    };
  };
  return { ...actual, execFile };
});

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const git = await import('../../src/evidence/git.js');
  const errors = await import('../../src/errors.js');
  return { cloneRepo: git.cloneRepo, CloneError: errors.CloneError };
}

beforeEach(() => {
  state.clone = 'hang';
  state.duBytes = 0;
  state.killed = 0;
  state.calls = [];
});
afterEach(() => {
  delete process.env['CLONE_TIMEOUT_MS'];
  delete process.env['CLONE_MAX_MB'];
});

describe('cloneRepo (T6)', () => {
  it('rejects a URL outside the GitHub allowlist before running git', async () => {
    const { cloneRepo, CloneError } = await load({});
    await expect(cloneRepo('https://gitlab.com/a/b')).rejects.toBeInstanceOf(CloneError);
    await expect(cloneRepo('file:///etc')).rejects.toBeInstanceOf(CloneError);
    expect(state.calls).toHaveLength(0);
  });

  it('aborts a clone that exceeds the time limit, kills git and throws CloneError', async () => {
    const { cloneRepo, CloneError } = await load({ CLONE_TIMEOUT_MS: '50' });
    await expect(cloneRepo('https://github.com/owner/repo')).rejects.toBeInstanceOf(
      CloneError,
    );
    expect(state.killed).toBe(1);
    const clone = state.calls.find((c) => c[1] === 'clone');
    expect(clone).toContain('--filter=blob:none');
  });

  it('rejects a finished clone whose working tree is over the size cap', async () => {
    state.clone = 'ok';
    state.duBytes = 3 * 1024 * 1024;
    const { cloneRepo, CloneError } = await load({ CLONE_MAX_MB: '1' });
    await expect(cloneRepo('https://github.com/owner/big')).rejects.toBeInstanceOf(
      CloneError,
    );
    expect(state.calls).toContainEqual(expect.arrayContaining(['du', '-sk']));
  });

  it('returns a temp dir and an idempotent cleanup when the clone succeeds within limits', async () => {
    state.clone = 'ok';
    state.duBytes = 1024;
    const { cloneRepo } = await load({});
    const r = await cloneRepo('https://github.com/owner/small.git');
    expect(r.root).toMatch(/seance-[0-9a-f-]{36}$/);
    await r.cleanup();
    await r.cleanup();
  });
  it('serialises concurrent clones of the same repo and gives each caller its own directory', async () => {
    state.clone = 'ok';
    state.duBytes = 1024;
    const { cloneRepo } = await load({});
    const [a, b] = await Promise.all([
      cloneRepo('https://github.com/owner/same'),
      cloneRepo('https://github.com/owner/same.git'),
    ]);
    expect(a.root).not.toBe(b.root);
    expect(state.calls.filter((c) => c[1] === 'clone')).toHaveLength(2);
  });
});
