/**
 * repo.ts — resolve the `repo` argument to a local git work tree (seance-mcp R3, design.md §4.1).
 *
 * Remote URLs are refused before the filesystem is touched. Every refusal is one of three
 * fixed sentences, so no path ever leaves this module (R3.5).
 */

import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { runGit as defaultRunGit } from '../evidence/git.js';
import { GitError } from '../errors.js';
import { MESSAGES } from './messages.js';

export class RepoRefusal extends Error {
  constructor(readonly sentence: string) {
    super(sentence);
    this.name = 'RepoRefusal';
  }
}

export interface RepoDeps {
  readonly runGit: (args: string[], cwd: string) => Promise<string>;
  readonly realpath: (p: string) => Promise<string>;
  readonly stat: (p: string) => Promise<{ isDirectory(): boolean }>;
}

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const SCP_RE = /^[^\s/@]+@[^\s/:]+:/;

/** True for `scheme://…` and scp-style `user@host:path`. Pure. */
export function looksRemote(repo: string): boolean {
  return SCHEME_RE.test(repo) || SCP_RE.test(repo);
}

const defaults: RepoDeps = {
  runGit: (args, cwd) => defaultRunGit(args, cwd),
  realpath: (p) => fsp.realpath(p),
  stat: (p) => fsp.stat(p),
};

/** The absolute, symlink-free top level of the git work tree at `repo`. Throws RepoRefusal. */
export async function resolveLocalRepo(
  repo: string,
  cwd: string,
  deps: Partial<RepoDeps> = {},
): Promise<string> {
  const { runGit, realpath, stat } = { ...defaults, ...deps };

  // Step 1 — no filesystem call for a remote (R3.1)
  if (looksRemote(repo)) throw new RepoRefusal(MESSAGES.REPO_REMOTE);

  // Step 2 — an existing directory, symbolic links resolved (R3.2)
  let real: string;
  try {
    real = await realpath(path.resolve(cwd, repo));
    if (!(await stat(real)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new RepoRefusal(MESSAGES.REPO_NOT_DIRECTORY);
  }

  // Step 3 — inside a work tree; a bare repository and .git print "false" (R3.3)
  let inside: string;
  try {
    inside = await runGit(['rev-parse', '--is-inside-work-tree'], real);
  } catch (err) {
    console.error('[seance:mcp] repo is not a work tree', {
      code: err instanceof GitError ? err.code : 'UNKNOWN',
    });
    throw new RepoRefusal(MESSAGES.REPO_NOT_GIT);
  }
  if (inside.trim() !== 'true') throw new RepoRefusal(MESSAGES.REPO_NOT_GIT);

  // Step 4 — the top level, symbolic links resolved (R3.4)
  try {
    const top = (await runGit(['rev-parse', '--show-toplevel'], real)).trim();
    return await realpath(top);
  } catch (err) {
    console.error('[seance:mcp] repo top level could not be read', {
      code: err instanceof GitError ? err.code : 'UNKNOWN',
    });
    throw new RepoRefusal(MESSAGES.REPO_NOT_GIT);
  }
}
