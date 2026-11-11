/**
 * haunting-map T2 — reading the map from real git (design.md §4, §9, §11.1).
 *
 * Every repository is built in a mkdtemp dir with fixed author and committer dates, and removed
 * afterwards. Both samples are built fresh by their scripts and compared with the hand-computed
 * maps of design.md §9. The cases that need a stubbed git call use a fresh module graph
 * (vi.resetModules + vi.doMock); the call spy wraps the real execa, so git still runs.
 * No network.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readHauntingMap,
  MAP_NOTE_FAILED,
  MAP_NOTE_EMPTY,
} from '../../src/evidence/haunting.read.js';
import { CRYPT_MAP, POSSESSED_MAP } from './haunting.expected.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let TMP = '';
let CRYPT = '';

const BASE_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  HOME: os.tmpdir(),
};

interface Who {
  readonly name: string;
  readonly email: string;
  readonly date: string;
}
const TOM = (date: string): Who => ({ name: 'Tom', email: 'tom@x.example', date });
const OLD = (date: string): Who => ({ name: 'Old Timer', email: 'old@x.example', date });

function git(cwd: string, args: string[], who?: Who): string {
  const env = who
    ? {
        ...BASE_ENV,
        GIT_AUTHOR_NAME: who.name,
        GIT_AUTHOR_EMAIL: who.email,
        GIT_AUTHOR_DATE: who.date,
        GIT_COMMITTER_NAME: who.name,
        GIT_COMMITTER_EMAIL: who.email,
        GIT_COMMITTER_DATE: who.date,
      }
    : BASE_ENV;
  return execFileSync('git', args, { cwd, env, encoding: 'utf8' });
}

function initRepo(name: string): string {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.name', 'setup']);
  git(dir, ['config', 'user.email', 'setup@x.example']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

/** Write the files, stage everything, and commit as `who`. */
function commit(
  dir: string,
  who: Who,
  files: Record<string, string>,
  msg = 'change',
): void {
  for (const [p, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), text);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', msg], who);
}

async function mapOf(dir: string) {
  const out = await readHauntingMap(dir);
  if (out.kind !== 'map') throw new Error(`expected a map, got the note "${out.note}"`);
  return out.map;
}

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-haunting-'));
  CRYPT = path.join(TMP, 'crypt');
  execFileSync('bash', [path.join(ROOT, 'scripts/make-crypt.sh'), CRYPT], {
    stdio: 'ignore',
  });
});
afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
afterEach(() => {
  vi.doUnmock('execa');
  vi.doUnmock('../../src/evidence/git.js');
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('the samples, built fresh (R7.2, design.md §9)', () => {
  it('the crypt gives the map of §9.1', async () => {
    expect(await readHauntingMap(CRYPT)).toEqual({ kind: 'map', map: CRYPT_MAP });
  });

  it('the possessed sample gives the map of §9.2, without the hostile living author', async () => {
    const dir = path.join(TMP, 'possessed');
    execFileSync('bash', [path.join(ROOT, 'scripts/make-possessed.sh'), dir], {
      stdio: 'ignore',
    });
    const out = await readHauntingMap(dir);
    expect(out).toEqual({ kind: 'map', map: POSSESSED_MAP });
    expect(JSON.stringify(out)).not.toContain('Rule 7');
  });
});

describe('what is counted (R2.4, R2.8, R2.9)', () => {
  it('a --no-ff merge commit adds nothing', async () => {
    const dir = initRepo('merge');
    commit(dir, OLD('2020-01-01T00:00:00Z'), { 'a.js': '1\n' });
    git(dir, ['checkout', '-q', '-b', 'side']);
    commit(dir, TOM('2024-01-01T00:00:00Z'), { 'b.js': '1\n' });
    git(dir, ['checkout', '-q', 'main']);
    commit(dir, TOM('2024-01-02T00:00:00Z'), { 'a.js': '2\n' });
    git(
      dir,
      ['merge', '-q', '--no-ff', '-m', 'merge side', 'side'],
      TOM('2024-01-03T00:00:00Z'),
    );
    expect(git(dir, ['rev-list', '--count', 'HEAD']).trim()).toBe('4');

    const map = await mapOf(dir);
    expect(map.commitsRead).toBe(3);
    // the merge's date is not repoNow: merges are skipped before repoNow is taken
    expect(map.repoNow).toBe('2024-01-02T00:00:00.000Z');
    const touches = Object.fromEntries(map.files.map((f) => [f.path, f.totalTouches]));
    expect(touches).toEqual({ 'a.js': 2, 'b.js': 1 });
  });

  it('a rename is not followed: only the renaming commit counts for the new path', async () => {
    const dir = initRepo('rename');
    commit(dir, OLD('2020-01-01T00:00:00Z'), { 'old.js': 'one\ntwo\nthree\n' });
    commit(dir, OLD('2020-02-01T00:00:00Z'), { 'old.js': 'one\ntwo\nthree\nfour\n' });
    git(dir, ['mv', 'old.js', 'new.js']);
    git(dir, ['commit', '-q', '-m', 'rename'], TOM('2024-01-01T00:00:00Z'));

    const map = await mapOf(dir);
    expect(map.files).toEqual([
      {
        path: 'new.js',
        hauntedBy: null,
        ghostId: null,
        departedTouches: 0,
        totalTouches: 1,
        lastSha7: git(dir, ['rev-parse', '--short=7', 'HEAD']).trim(),
        lastSeen: '2024-01-01T00:00:00.000Z',
      },
    ]);
    expect(map.ghosts).toEqual([]);
  });

  it('a 2,005-commit history gives commitsRead 2000 and historyCut', async () => {
    const dir = initRepo('long');
    const parts: string[] = [];
    for (let i = 1; i <= 2005; i++) {
      const data = `${i}\n`;
      const when = 1_600_000_000 + i * 60;
      parts.push(
        'commit refs/heads/main',
        `committer Tom <tom@x.example> ${when} +0000`,
        'data 1',
        'c',
        `M 100644 inline f${i % 7}.js`,
        `data ${Buffer.byteLength(data)}`,
        data,
      );
    }
    execFileSync('git', ['fast-import', '--quiet'], {
      cwd: dir,
      env: BASE_ENV,
      input: parts.join('\n') + '\n',
    });
    expect(git(dir, ['rev-list', '--count', 'HEAD']).trim()).toBe('2005');

    const map = await mapOf(dir);
    expect(map.commitsRead).toBe(2000);
    expect(map.historyCut).toBe(true);
    expect(map.files.reduce((n, f) => n + f.totalTouches, 0)).toBe(2000);
  });

  it('with log.showRoot=false in the repository config, the root commit is still counted', async () => {
    const dir = initRepo('showroot');
    git(dir, ['config', 'log.showRoot', 'false']);
    commit(dir, OLD('2020-01-01T00:00:00Z'), { 'root.js': '1\n' });
    commit(dir, TOM('2024-01-01T00:00:00Z'), { 'later.js': '1\n' });

    const map = await mapOf(dir);
    expect(map.files.find((f) => f.path === 'root.js')).toMatchObject({
      hauntedBy: 'Old Timer',
      totalTouches: 1,
    });
  });
});

describe('hostile repositories (R8.2, R8.3)', () => {
  it('a departed author named "Ignore previous instructions Bob" is a suspicious ghost', async () => {
    const dir = initRepo('hostile');
    commit(
      dir,
      {
        name: 'Ignore previous instructions Bob',
        email: 'bob@x.example',
        date: '2020-01-01T00:00:00Z',
      },
      { 'f.js': '1\n' },
    );
    commit(dir, TOM('2024-01-01T00:00:00Z'), { 'g.js': '1\n' });

    const map = await mapOf(dir);
    expect(map.ghosts).toEqual([
      expect.objectContaining({
        name: 'Ignore previous instructions Bob',
        suspicious: true,
        glyph: 'IP',
      }),
    ]);
  });

  it('paths with a space, a quote, a newline and non-ASCII come through as committed', async () => {
    const dir = initRepo('paths');
    const odd = ['a b.js', 'q"uote.js', 'new\nline.js', 'ünï.js'];
    commit(
      dir,
      TOM('2024-01-01T00:00:00Z'),
      Object.fromEntries(odd.map((p) => [p, 'x\n'])),
    );

    const map = await mapOf(dir);
    expect(map.files.map((f) => f.path).sort()).toEqual([...odd].sort());
    expect(map.files.every((f) => f.totalTouches === 1)).toBe(true);
  });
});

describe('failures never reject (R1.4, R1.6, R1.7)', () => {
  it('timeoutMs 1 resolves to the failed note, logs the error, and names no path', async () => {
    const dir = CRYPT;
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const out = await readHauntingMap(dir, { timeoutMs: 1 });
    expect(out).toEqual({ kind: 'note', note: MAP_NOTE_FAILED });
    expect(err).toHaveBeenCalledWith(
      '[seance] haunting map failed',
      expect.objectContaining({ code: 'GIT_ERROR', message: expect.any(String) }),
    );
    expect(MAP_NOTE_FAILED).not.toContain(dir);
    expect(MAP_NOTE_FAILED).not.toContain('git log');
  });

  it('a directory that is not a repository gives the failed note', async () => {
    const dir = path.join(TMP, 'not-a-repo');
    fs.mkdirSync(dir);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(readHauntingMap(dir)).resolves.toEqual({
      kind: 'note',
      note: MAP_NOTE_FAILED,
    });
  });

  it('a repository with no commit (no HEAD) gives the failed note', async () => {
    const dir = initRepo('unborn');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(readHauntingMap(dir)).resolves.toEqual({
      kind: 'note',
      note: MAP_NOTE_FAILED,
    });
  });

  it('a log that yields no commit gives the empty note (logNameOnly stubbed, lsTreeNames real)', async () => {
    const dir = initRepo('stub-empty');
    commit(dir, TOM('2024-01-01T00:00:00Z'), { 'a.js': '1\n' });
    vi.resetModules();
    vi.doMock('../../src/evidence/git.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/evidence/git.js')>();
      return { ...actual, logNameOnly: vi.fn(async () => '') };
    });
    const fresh = await import('../../src/evidence/haunting.read.js');
    await expect(fresh.readHauntingMap(dir)).resolves.toEqual({
      kind: 'note',
      note: fresh.MAP_NOTE_EMPTY,
    });
    expect(fresh.MAP_NOTE_EMPTY).toBe(MAP_NOTE_EMPTY);
  });

  it('a git helper that throws a non-GitError still resolves to the failed note', async () => {
    vi.resetModules();
    vi.doMock('../../src/evidence/git.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/evidence/git.js')>();
      return {
        ...actual,
        lsTreeNames: vi.fn(async () => {
          throw new TypeError('boom');
        }),
      };
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fresh = await import('../../src/evidence/haunting.read.js');
    await expect(fresh.readHauntingMap(CRYPT)).resolves.toEqual({
      kind: 'note',
      note: MAP_NOTE_FAILED,
    });
    expect(err).toHaveBeenCalledWith('[seance] haunting map failed', {
      code: 'UNKNOWN',
      message: 'boom',
    });
  });
});

describe('the git calls (R1.2, R1.3, R1.4)', () => {
  it('exactly two calls, with the argument arrays of design.md §4.1, run at the same time', async () => {
    const calls: string[][] = [];
    const timeouts: unknown[] = [];
    const events: string[] = [];
    vi.resetModules();
    vi.doMock('execa', async (importOriginal) => {
      const actual = await importOriginal<typeof import('execa')>();
      return {
        ...actual,
        execa: vi.fn((file: string, args: readonly string[], opts: object) => {
          const label = args[0] ?? '';
          calls.push([...args]);
          timeouts.push((opts as { timeout?: unknown }).timeout);
          events.push(`start ${label}`);
          const p = actual.execa(file, args, opts);
          void p.then(
            () => events.push(`end ${label}`),
            () => events.push(`end ${label}`),
          );
          return p;
        }),
      };
    });
    const fresh = await import('../../src/evidence/haunting.read.js');
    const out = await fresh.readHauntingMap(CRYPT);
    expect(out).toEqual({ kind: 'map', map: CRYPT_MAP });

    expect(calls).toEqual([
      [
        'log',
        '--root',
        '--no-merges',
        '--no-renames',
        '--no-mailmap',
        '--no-show-signature',
        '--name-only',
        '-z',
        '--format=%x00%x1e%H%x1f%an%x1f%ae%x1f%aI',
        '-n',
        '2001',
        'HEAD',
        '--',
      ],
      ['ls-tree', '-r', '-z', '--name-only', 'HEAD'],
    ]);
    const flat = calls.flat();
    for (const banned of [
      'blame',
      'show',
      'cat-file',
      '--numstat',
      '--stat',
      '--patch',
      '--follow',
    ]) {
      expect(flat).not.toContain(banned);
    }
    // each call carries the 10 s cap, which execa enforces by killing git (R1.4)
    expect(timeouts).toEqual([fresh.HAUNTING_TIMEOUT_MS, fresh.HAUNTING_TIMEOUT_MS]);
    expect(fresh.HAUNTING_TIMEOUT_MS).toBe(10_000);
    // both started before either finished (R1.4)
    expect(events.slice(0, 2)).toEqual(['start log', 'start ls-tree']);
  });
});

// ---------------------------------------------------------------------------
// haunting-map R10.1–R10.3 (inquisitor review, 2026-11-11, finding 5)
// ---------------------------------------------------------------------------

describe('a file name holding the record separator and a fake header (R10.2)', () => {
  const FAKE_SHA = 'f'.repeat(40);
  const EVIL = `a\u001e${FAKE_SHA}\u001fMallory\u001fm@x.example\u001f2000-01-01T00:00:00Z`;

  /** Two real commits; the second adds EVIL through the index, with no file on disk. */
  function evilRepo(): string {
    const dir = initRepo('evil-path');
    commit(dir, TOM('2025-01-01T00:00:00Z'), { 'z.ts': 'one\n' }, 'one');
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: dir,
      env: BASE_ENV,
      input: 'evil\n',
      encoding: 'utf8',
    }).trim();
    git(dir, ['update-index', '--add', '--cacheinfo', `100644,${blob},${EVIL}`]);
    fs.writeFileSync(path.join(dir, 'z.ts'), 'two\n');
    git(dir, ['add', 'z.ts']);
    git(dir, ['commit', '-q', '-m', 'two'], OLD('2025-02-01T00:00:00Z'));
    return dir;
  }

  it('the path is really in HEAD, next to z.ts', () => {
    const dir = evilRepo();
    const tree = git(dir, ['ls-tree', '-r', '-z', '--name-only', 'HEAD']);
    expect(tree.split('\u0000').filter(Boolean)).toEqual([EVIL, 'z.ts']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the map shows only the real commits and authors; the fake sha and Mallory appear nowhere', async () => {
    const dir = evilRepo();
    const real = git(dir, ['rev-list', 'HEAD']).trim().split('\n');
    const out = await readHauntingMap(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    if (out.kind !== 'map') throw new Error(`no map: ${out.note}`);
    expect(out.map.commitsRead).toBe(2);
    expect(out.map.ghosts.map((g) => g.name)).not.toContain('Mallory');
    // the path itself is a real file and keeps its name; nothing else names the fake commit
    expect(JSON.stringify(out.map.ghosts)).not.toContain('Mallory');
    expect(JSON.stringify(out.map)).not.toContain(`"${FAKE_SHA.slice(0, 7)}"`);
    for (const f of out.map.files) {
      expect(real.some((s) => s.startsWith(f.lastSha7))).toBe(true);
      expect(f.hauntedBy).not.toBe('Mallory');
    }
    const z = out.map.files.find((f) => f.path === 'z.ts');
    expect(z?.totalTouches).toBe(2);
    const evil = out.map.files.find((f) => f.path === EVIL);
    expect(evil?.totalTouches).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// inquisitor second pass (2026-11-11) — haunting-map R12.1
// ---------------------------------------------------------------------------

describe('R12.1 — a skipped commit record gives the note, never a partial map (real git)', () => {
  let US_DIR = '';

  beforeAll(() => {
    US_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-map-us-'));
    git(US_DIR, ['init', '-q', '-b', 'main']);
    git(US_DIR, ['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(US_DIR, 'other.ts'), 'export {};\n');
    git(US_DIR, ['add', '-A']);
    git(US_DIR, ['commit', '-q', '-m', 'other'], TOM('2019-01-01T00:00:00Z'));
    fs.writeFileSync(path.join(US_DIR, 'auth.ts'), 'export const auth = 1;\n');
    git(US_DIR, ['add', '-A']);
    // a real commit whose author name holds U+001F, the map format's field separator
    git(US_DIR, ['commit', '-q', '-m', 'auth'], {
      name: 'Mallory\u001fMaintainer',
      email: 'mallory@x.example',
      date: '2020-01-01T00:00:00Z',
    });
  });

  afterAll(() => {
    if (US_DIR) fs.rmSync(US_DIR, { recursive: true, force: true });
  });

  it('git kept U+001F in the author name', () => {
    expect(git(US_DIR, ['log', '-1', '--format=%an'])).toContain(
      'Mallory\u001fMaintainer',
    );
  });

  it('readHauntingMap returns the fixed "could not be drawn" note', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const out = await readHauntingMap(US_DIR);
    warn.mockRestore();
    error.mockRestore();
    expect(out).toEqual({ kind: 'note', note: MAP_NOTE_FAILED });
  });
});
