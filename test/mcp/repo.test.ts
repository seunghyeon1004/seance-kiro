/**
 * seance-mcp T1 — local repository resolution (R3.1–R3.5, design.md §4.1).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSamples, type Samples } from '../e2e/harness.js';
import { looksRemote, resolveLocalRepo, RepoRefusal } from '../../src/mcp/repo.js';
import { MESSAGES } from '../../src/mcp/messages.js';

let samples: Samples;
let scratch: string;

beforeAll(() => {
  samples = buildSamples();
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-mcp-repo-'));
}, 60_000);

afterAll(() => {
  fs.rmSync(samples.root, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
});

/** The refusal for `repo`, checked to be a RepoRefusal with no path in its message (R3.5). */
async function refusal(repo: string, cwd: string): Promise<RepoRefusal> {
  let caught: unknown;
  try {
    await resolveLocalRepo(repo, cwd);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RepoRefusal);
  const r = caught as RepoRefusal;
  for (const s of [repo, cwd, scratch, os.tmpdir(), fs.realpathSync(os.tmpdir())]) {
    expect(r.message).not.toContain(s);
    expect(r.sentence).not.toContain(s);
  }
  return r;
}

describe('looksRemote (R3.1)', () => {
  it.each([
    ['https://github.com/a/b', true],
    ['git@github.com:a/b.git', true],
    ['ssh://x', true],
    ['file:///x', true],
    ['.', false],
    ['./x', false],
    ['/abs/x', false],
    ['a@b', false],
    ['dir/a@b:c', false],
  ])('%s → %s', (repo, expected) => {
    expect(looksRemote(repo)).toBe(expected);
  });
});

describe('resolveLocalRepo refusals', () => {
  it('a remote string is refused with REPO_REMOTE before any filesystem call (R3.1)', async () => {
    const realpath = vi.fn(async (p: string) => p);
    const stat = vi.fn(async () => ({ isDirectory: () => true }));
    const runGit = vi.fn(async () => 'true');
    for (const repo of ['https://github.com/a/b', 'git@github.com:a/b.git']) {
      await expect(
        resolveLocalRepo(repo, scratch, { realpath, stat, runGit }),
      ).rejects.toMatchObject({ sentence: MESSAGES.REPO_REMOTE });
    }
    expect(realpath).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    expect(runGit).not.toHaveBeenCalled();
  });

  it('a missing path gives REPO_NOT_DIRECTORY with no path in it (R3.2, R3.5)', async () => {
    const r = await refusal(path.join(scratch, 'no-such-dir'), scratch);
    expect(r.sentence).toBe(MESSAGES.REPO_NOT_DIRECTORY);
  });

  it('a regular file gives REPO_NOT_DIRECTORY (R3.2)', async () => {
    const file = path.join(scratch, 'plain.txt');
    fs.writeFileSync(file, 'x');
    const r = await refusal(file, scratch);
    expect(r.sentence).toBe(MESSAGES.REPO_NOT_DIRECTORY);
  });

  it('a directory outside any work tree gives REPO_NOT_GIT (R3.3, R3.5)', async () => {
    const dir = fs.mkdtempSync(path.join(scratch, 'plain-'));
    const r = await refusal(dir, scratch);
    expect(r.sentence).toBe(MESSAGES.REPO_NOT_GIT);
  });

  it('a bare repository gives REPO_NOT_GIT (R3.3)', async () => {
    const dir = fs.mkdtempSync(path.join(scratch, 'bare-'));
    execFileSync('git', ['init', '--bare', '-q', dir]);
    const r = await refusal(dir, scratch);
    expect(r.sentence).toBe(MESSAGES.REPO_NOT_GIT);
  });

  it('a .git directory gives REPO_NOT_GIT (R3.3)', async () => {
    const r = await refusal(path.join(samples.crypt, '.git'), scratch);
    expect(r.sentence).toBe(MESSAGES.REPO_NOT_GIT);
  });

  it('a relative path is checked against cwd and its refusal names no path (R3.5)', async () => {
    const r = await refusal('relative/missing', scratch);
    expect(r.sentence).toBe(MESSAGES.REPO_NOT_DIRECTORY);
  });
});

describe('resolveLocalRepo successes (R3.2, R3.4)', () => {
  it('a subdirectory of the crypt resolves to the crypt top level', async () => {
    const real = fs.realpathSync(samples.crypt);
    await expect(resolveLocalRepo('legacy', samples.crypt)).resolves.toBe(real);
  });

  it('"." with cwd set to the crypt resolves to it', async () => {
    const real = fs.realpathSync(samples.crypt);
    await expect(resolveLocalRepo('.', samples.crypt)).resolves.toBe(real);
  });

  it('a symlink to the crypt resolves to the crypt real path', async () => {
    const link = path.join(scratch, 'crypt-link');
    fs.symlinkSync(samples.crypt, link);
    const real = fs.realpathSync(samples.crypt);
    await expect(resolveLocalRepo(link, scratch)).resolves.toBe(real);
  });
});
