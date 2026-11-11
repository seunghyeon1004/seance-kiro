/**
 * haunting-map T6 — R1.3 with real git: the map reader downloads no blob on a blob-less clone.
 *
 * The crypt is built by its script into a mkdtemp dir, the source allows filters
 * (uploadpack.allowFilter), and it is cloned over file:// with `--filter=blob:none --depth 100`,
 * as src/evidence/git.ts clones a remote. `git rev-list --objects --missing=print HEAD` counts the
 * blobs the clone does not hold (it never fetches them). The count is the same before and after
 * readHauntingMap. As a control that the count can see a fetch, `git log -L` (which reads blobs)
 * lowers it. This automates the check a human ran on 2026-11-11 (4 missing before and after the
 * map reads, 2 after `git log -L`). No network: the only transport is file://.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readHauntingMap } from '../../src/evidence/haunting.read.js';
import { CRYPT_MAP } from './haunting.expected.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: os.tmpdir() };
let TMP = '';
let CLONE = '';

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' });

/** Objects reachable from HEAD that the clone does not hold; rev-list prints them as `?<oid>`. */
const missing = (): number =>
  git(CLONE, ['rev-list', '--objects', '--missing=print', 'HEAD'])
    .split('\n')
    .filter((l) => l.startsWith('?')).length;

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-blobless-'));
  const src = path.join(TMP, 'crypt');
  execFileSync('bash', [path.join(ROOT, 'scripts/make-crypt.sh'), src], {
    cwd: ROOT,
    env: ENV,
  });
  git(src, ['config', 'uploadpack.allowFilter', 'true']);
  CLONE = path.join(TMP, 'clone');
  git(TMP, [
    '-c',
    'protocol.file.allow=always',
    'clone',
    '-q',
    '--filter=blob:none',
    '--depth',
    '100',
    pathToFileURL(src).href,
    CLONE,
  ]);
}, 60_000);

afterAll(() => {
  if (TMP) fs.rmSync(TMP, { recursive: true, force: true });
});

describe('R1.3 — no blob download on a --filter=blob:none clone (real git, file://)', () => {
  it('the clone is partial: some blobs of the history are missing', () => {
    expect(git(CLONE, ['config', 'remote.origin.promisor']).trim()).toBe('true');
    expect(missing()).toBeGreaterThan(0);
  });

  it('readHauntingMap draws the crypt map and leaves the missing count unchanged', async () => {
    const before = missing();
    const out = await readHauntingMap(CLONE);
    expect(out).toEqual({ kind: 'map', map: CRYPT_MAP });
    expect(missing()).toBe(before);
  });

  it('control: git log -L reads blobs, so the count drops', () => {
    const before = missing();
    git(CLONE, ['log', '-L', '7,7:legacy/tax.js', '--format=%h', 'HEAD']);
    expect(missing()).toBeLessThan(before);
  });
});
