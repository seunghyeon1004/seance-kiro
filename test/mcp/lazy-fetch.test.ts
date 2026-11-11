/**
 * seance-mcp addendum (inquisitor second pass, 2026-11-11) — R13.1, R13.2: no git subprocess of
 * the MCP process fetches a missing object from a promisor remote.
 *
 * Real: the crypt built by its script, a real partial clone of it over file://
 * (`--filter=blob:none`, so its history's blobs are missing and its origin is a promisor
 * remote), and the registered `seance` command run as a child process over stdio with the SDK's
 * own Client and getDefaultEnvironment() (no GIT_* variable from the test). Nothing is stubbed.
 *
 * `git rev-list --objects --missing=print HEAD` counts the blobs the clone does not hold without
 * fetching any. Summoning line 7 of legacy/tax.js needs historical blobs (blame reads them), so
 * with lazy fetch on the count would drop; the control at the end shows that it does.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { MESSAGES } from '../../src/mcp/messages.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: os.tmpdir() };
let TMP = '';
let CLONE = '';
let CONTROL = '';
let transport: StdioClientTransport;
let client: Client;

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' });

const missing = (dir: string = CLONE): number =>
  git(dir, ['rev-list', '--objects', '--missing=print', 'HEAD'])
    .split('\n')
    .filter((l) => l.startsWith('?')).length;

type Content = { type: string; text?: string };
const textOf = (r: { content?: unknown }): string =>
  ((r.content as Content[] | undefined) ?? [])[0]?.text ?? '';

beforeAll(async () => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-mcp-lazy-'));
  const src = path.join(TMP, 'crypt');
  execFileSync('bash', [path.join(ROOT, 'scripts/make-crypt.sh'), src], {
    cwd: ROOT,
    env: ENV,
  });
  git(src, ['config', 'uploadpack.allowFilter', 'true']);
  CLONE = path.join(TMP, 'clone');
  CONTROL = path.join(TMP, 'control');
  for (const dir of [CLONE, CONTROL]) {
    git(TMP, [
      '-c',
      'protocol.file.allow=always',
      'clone',
      '-q',
      '--filter=blob:none',
      pathToFileURL(src).href,
      dir,
    ]);
  }

  const env = getDefaultEnvironment();
  for (const k of Object.keys(env)) expect(k.startsWith('GIT_')).toBe(false);
  transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', 'tsx', 'src/mcp/server.ts'],
    cwd: ROOT,
    env,
    stderr: 'pipe',
  });
  client = new Client({ name: 'seance-lazy-test', version: '0.0.0' });
  await client.connect(transport, { timeout: 30_000 });
}, 90_000);

afterAll(async () => {
  await client?.close();
  if (TMP) fs.rmSync(TMP, { recursive: true, force: true });
});

describe('seance-mcp R13.1 — the MCP server never lazy-fetches from a promisor remote', () => {
  it('the clone is partial: its origin is a promisor and blobs are missing', () => {
    expect(git(CLONE, ['config', 'remote.origin.promisor']).trim()).toBe('true');
    expect(missing()).toBeGreaterThan(0);
  });

  it('seance_summon on a line whose history needs a missing blob returns GIT_ERROR and fetches nothing', async () => {
    const before = missing();
    const res = await client.callTool(
      {
        name: 'seance_summon',
        arguments: { repo: CLONE, file: 'legacy/tax.js', startLine: 7, endLine: 7 },
      },
      undefined,
      { timeout: 30_000 },
    );
    expect(missing()).toBe(before);
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe(MESSAGES.GIT_ERROR);
  }, 60_000);

  it('seance_haunting_map on the partial clone fetches nothing either', async () => {
    const before = missing();
    const res = await client.callTool({
      name: 'seance_haunting_map',
      arguments: { repo: CLONE },
    });
    expect(res.isError).toBeFalsy();
    expect(missing()).toBe(before);
  }, 60_000);

  it('control: plain git blame in an identical clone does fetch, so the count can see a fetch', () => {
    const before = missing(CONTROL);
    expect(before).toBe(missing());
    git(CONTROL, ['blame', '--porcelain', '-L7,7', '--', 'legacy/tax.js']);
    expect(missing(CONTROL)).toBeLessThan(before);
  });
});

describe('seance-mcp R13.2 — the entry sets the variables before any other module loads', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/mcp/server.ts'), 'utf8');

  it('the only static import is ./console.js, which imports nothing', () => {
    const statics = Array.from(
      source.matchAll(/^import\s[^;]*?from\s+['"]([^'"]+)['"]/gm),
      (m) => m[1],
    );
    expect(statics).toEqual(['./console.js']);
    const consoleSrc = fs.readFileSync(path.join(ROOT, 'src/mcp/console.ts'), 'utf8');
    expect(consoleSrc).not.toMatch(/^\s*import\s/m);
  });

  it('GIT_NO_LAZY_FETCH=1 and GIT_TERMINAL_PROMPT=0 are set before the first dynamic import', () => {
    const firstImport = source.indexOf('await import(');
    expect(firstImport).toBeGreaterThan(0);
    const lazy = source.indexOf("process.env['GIT_NO_LAZY_FETCH'] = '1'");
    const prompt = source.indexOf("process.env['GIT_TERMINAL_PROMPT'] = '0'");
    expect(lazy).toBeGreaterThan(0);
    expect(prompt).toBeGreaterThan(0);
    expect(lazy).toBeLessThan(firstImport);
    expect(prompt).toBeLessThan(firstImport);
  });
});
