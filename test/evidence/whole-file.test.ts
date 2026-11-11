/**
 * haunting-map T3 — whole-file input and the ledger options (design.md §6.1, §6.2, §11.1).
 *
 * Real git on a crypt built into a temp dir and on purpose-built repositories. The ordering
 * cases (R1.5, R1.8) use a fresh module graph with readHauntingMap replaced by a recorder; the
 * call spy wraps the real execa, so git still runs. No network.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLedger,
  WHOLE_FILE_EMPTY,
  WHOLE_FILE_UNREADABLE,
} from '../../src/evidence/ledger.js';
import { validateWholeFileInput } from '../../src/evidence/ledger.input.js';
import { ValidationError } from '../../src/errors.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let TMP = '';
let CRYPT = '';
let ODD = '';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Tom',
  GIT_AUTHOR_EMAIL: 'tom@x.example',
  GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'Tom',
  GIT_COMMITTER_EMAIL: 'tom@x.example',
  GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z',
  GIT_CONFIG_NOSYSTEM: '1',
  HOME: os.tmpdir(),
};
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-whole-'));
  CRYPT = path.join(TMP, 'crypt');
  execFileSync('bash', [path.join(ROOT, 'scripts/make-crypt.sh'), CRYPT], {
    stdio: 'ignore',
  });

  // a 700-line file, an empty file, a 6 MB file and a directory
  ODD = path.join(TMP, 'odd');
  fs.mkdirSync(path.join(ODD, 'dir'), { recursive: true });
  git(ODD, 'init', '-q', '-b', 'main');
  const long = Array.from({ length: 700 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  fs.writeFileSync(path.join(ODD, 'long.js'), long);
  fs.writeFileSync(path.join(ODD, 'empty.js'), '');
  fs.writeFileSync(path.join(ODD, 'big.txt'), 'x'.repeat(6 * 1024 * 1024));
  fs.writeFileSync(path.join(ODD, 'dir', 'inner.js'), 'inner\n');
  git(ODD, 'add', '-A');
  git(ODD, 'commit', '-q', '-m', 'files');
});
afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
afterEach(() => {
  vi.doUnmock('execa');
  vi.doUnmock('../../src/evidence/git.js');
  vi.doUnmock('../../src/evidence/haunting.read.js');
  vi.resetModules();
  vi.restoreAllMocks();
});

async function refused(file: string, repoUrl = ODD): Promise<ValidationError> {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const err = await buildLedger({ repoUrl, file, wholeFile: true }).catch(
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ValidationError);
  return err as ValidationError;
}

describe('whole-file ledgers (R6.4, R6.5)', () => {
  it('legacy/vendor.js gives range 1–13 and the items e9a5c9c and dcb8969', async () => {
    const r = await buildLedger({
      repoUrl: CRYPT,
      file: 'legacy/vendor.js',
      wholeFile: true,
    });
    expect(r.range).toEqual({ startLine: 1, endLine: 13 });
    expect(r.items.map((i) => i.shortSha).sort()).toEqual(['dcb8969', 'e9a5c9c']);
    expect(r.lines).toHaveLength(13);
  });

  it('a 700-line file gives range 1–500', async () => {
    const r = await buildLedger({ repoUrl: ODD, file: 'long.js', wholeFile: true });
    expect(r.range).toEqual({ startLine: 1, endLine: 500 });
  });

  it('an empty file is refused with WHOLE_FILE_EMPTY, without the path', async () => {
    const err = await refused('empty.js');
    expect(err.message).toBe(WHOLE_FILE_EMPTY);
    expect(err.message).not.toContain('empty.js');
  });

  it.each([
    ['a directory', 'crypt', 'legacy'],
    ['a missing path', 'crypt', 'legacy/missing.js'],
    ['a 6 MB file', 'odd', 'big.txt'],
    ['a directory in another repository', 'odd', 'dir'],
  ])(
    '%s is refused with WHOLE_FILE_UNREADABLE, without the path',
    async (_label, repo, file) => {
      const err = await refused(file, repo === 'crypt' ? CRYPT : ODD);
      expect(err.message).toBe(WHOLE_FILE_UNREADABLE);
      expect(err.message).not.toContain(file);
    },
  );

  it('a range ledger reports the range it was built for', async () => {
    const r = await buildLedger({
      repoUrl: CRYPT,
      file: 'legacy/tax.js',
      startLine: 7,
      endLine: 7,
    });
    expect(r.range).toEqual({ startLine: 7, endLine: 7 });
  });
});

describe('validateWholeFileInput (R6.3)', () => {
  it.each([
    [{ repoUrl: 'crypt', file: '../x', wholeFile: true }],
    [{ repoUrl: 'crypt', file: '/etc/passwd', wholeFile: true }],
    [{ repoUrl: 'https://gitlab.com/o/r', file: 'a.js', wholeFile: true }],
    [{ repoUrl: 'crypt', file: '', wholeFile: true }],
    [{ repoUrl: 'crypt', file: 'a.js', wholeFile: false }],
    [{ repoUrl: 'crypt', file: 'a.js' }],
  ])('refuses %j with ValidationError', (raw) => {
    expect(() => validateWholeFileInput(raw)).toThrow(ValidationError);
  });

  it('keeps the messages of the range schema', () => {
    expect(() =>
      validateWholeFileInput({ repoUrl: 'crypt', file: '../x', wholeFile: true }),
    ).toThrow('file path must not contain ".." path-traversal sequences');
    expect(() =>
      validateWholeFileInput({
        repoUrl: 'https://gitlab.com/o/r',
        file: 'a.js',
        wholeFile: true,
      }),
    ).toThrow('remote URLs must match https://github.com/<owner>/<repo>[.git]');
  });

  it('accepts a valid request, with or without a token', () => {
    expect(
      validateWholeFileInput({
        repoUrl: 'https://github.com/o/r',
        file: 'a.js',
        wholeFile: true,
      }),
    ).toEqual({ repoUrl: 'https://github.com/o/r', file: 'a.js', wholeFile: true });
    expect(
      validateWholeFileInput({
        repoUrl: 'crypt',
        file: 'a.js',
        wholeFile: true,
        githubToken: 't',
      }),
    ).toMatchObject({ githubToken: 't' });
  });
});

describe('the map option (R1.1, R4.4, design.md §6.2)', () => {
  /** A fresh ledger module whose execa records every git argument array. */
  async function spiedLedger(): Promise<{
    ledger: typeof import('../../src/evidence/ledger.js');
    calls: string[][];
  }> {
    const calls: string[][] = [];
    vi.resetModules();
    vi.doMock('execa', async (importOriginal) => {
      const actual = await importOriginal<typeof import('execa')>();
      return {
        ...actual,
        execa: vi.fn((file: string, args: readonly string[], opts: object) => {
          calls.push([...args]);
          return actual.execa(file, args, opts);
        }),
      };
    });
    return { ledger: await import('../../src/evidence/ledger.js'), calls };
  }

  it('without options there is no haunting, and no log --name-only or ls-tree call', async () => {
    const { ledger, calls } = await spiedLedger();
    const r = await ledger.buildLedger({
      repoUrl: CRYPT,
      file: 'legacy/tax.js',
      startLine: 7,
      endLine: 7,
    });
    expect('haunting' in r).toBe(false);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((a) => a[0] === 'ls-tree')).toBe(false);
    expect(calls.some((a) => a[0] === 'log' && a.includes('--name-only'))).toBe(false);
  });

  it('with hauntingMap the crypt gives a map, and the same items as without', async () => {
    const input = { repoUrl: CRYPT, file: 'legacy/tax.js', startLine: 7, endLine: 7 };
    const plain = await buildLedger(input);
    const withMap = await buildLedger(input, { hauntingMap: true });
    expect(withMap.haunting?.kind).toBe('map');
    expect(withMap.items).toEqual(plain.items);
    expect(withMap.lines).toEqual(plain.lines);
    expect(withMap.range).toEqual(plain.range);
  });
});

describe('order of the reader (R1.5, R1.8)', () => {
  /** A fresh ledger module with readHauntingMap and the given git helpers replaced. */
  async function orderedLedger(
    events: string[],
    gitOverrides: (actual: typeof import('../../src/evidence/git.js')) => object,
    mapDelayMs = 0,
  ): Promise<typeof import('../../src/evidence/ledger.js')> {
    vi.resetModules();
    vi.doMock('../../src/evidence/haunting.read.js', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('../../src/evidence/haunting.read.js')>();
      return {
        ...actual,
        readHauntingMap: vi.fn(async () => {
          events.push('map started');
          await new Promise((r) => setTimeout(r, mapDelayMs));
          events.push('map settled');
          return { kind: 'note' as const, note: actual.MAP_NOTE_EMPTY };
        }),
      };
    });
    vi.doMock('../../src/evidence/git.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/evidence/git.js')>();
      return { ...actual, ...gitOverrides(actual) };
    });
    return import('../../src/evidence/ledger.js');
  }

  it('starts readHauntingMap before the first blame call', async () => {
    const events: string[] = [];
    const ledger = await orderedLedger(events, (actual) => ({
      blame: vi.fn(async (...a: Parameters<typeof actual.blame>) => {
        events.push('blame');
        return actual.blame(...a);
      }),
    }));
    await ledger.buildLedger(
      { repoUrl: CRYPT, file: 'legacy/tax.js', startLine: 7, endLine: 7 },
      { hauntingMap: true },
    );
    expect(events.indexOf('map started')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('map started')).toBeLessThan(events.indexOf('blame'));
  });

  it('starts readHauntingMap before the whole-file line count', async () => {
    const events: string[] = [];
    const ledger = await orderedLedger(events, (actual) => ({
      lineCountAtHead: vi.fn(async (...a: Parameters<typeof actual.lineCountAtHead>) => {
        events.push('count');
        return actual.lineCountAtHead(...a);
      }),
    }));
    await ledger.buildLedger(
      { repoUrl: CRYPT, file: 'legacy/vendor.js', wholeFile: true },
      { hauntingMap: true },
    );
    expect(events.indexOf('map started')).toBeLessThan(events.indexOf('count'));
  });

  it('when the ledger fails with HistoryError, cleanup runs only after the reader settled', async () => {
    const events: string[] = [];
    const ledger = await orderedLedger(
      events,
      () => ({
        cloneRepo: vi.fn(async () => ({
          root: CRYPT,
          shallow: false,
          cleanup: vi.fn(async () => {
            events.push('cleanup');
          }),
        })),
        blame: vi.fn(async () => []),
        logL: vi.fn(async () => {
          events.push('ledger failed');
          // imported at call time, so it is the instance the fresh ledger module sees
          const { HistoryError } = await import('../../src/errors.js');
          throw new HistoryError('git log -L failed');
        }),
      }),
      50,
    );
    const freshErrors = await import('../../src/errors.js');
    const err = await ledger
      .buildLedger(
        {
          repoUrl: 'https://github.com/o/r',
          file: 'legacy/tax.js',
          startLine: 7,
          endLine: 7,
        },
        { hauntingMap: true },
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(freshErrors.HistoryError);
    expect(events).toEqual(['map started', 'ledger failed', 'map settled', 'cleanup']);
  });
});
