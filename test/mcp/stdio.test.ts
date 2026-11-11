/**
 * seance-mcp T3 — integration over stdio (design.md §9.2; R1.1, R1.2, R1.7, R3.1, R3.3,
 * R4.4, R5.3, R9.2, R11.3, R11.4, R11.6).
 *
 * The registered `seance` command from .kiro/settings/mcp.json runs as a child process, and
 * the SDK's own Client talks to it with StdioClientTransport, as Kiro does. The child gets
 * getDefaultEnvironment() only, so no ANTHROPIC_* or GIT_* variable reaches it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildSamples, REASONS, type Samples } from '../e2e/harness.js';
import { MESSAGES } from '../../src/mcp/messages.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

interface ServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

function seanceEntry(): ServerEntry {
  const cfg = JSON.parse(
    fs.readFileSync(path.join(ROOT, '.kiro/settings/mcp.json'), 'utf8'),
  ) as { mcpServers: Record<string, ServerEntry> };
  const entry = cfg.mcpServers['seance'];
  if (entry === undefined) throw new Error('no seance entry in .kiro/settings/mcp.json');
  return entry;
}

const TRUE_CLAIM = {
  kind: 'memory',
  text: 'The delay exists because the tax vendor rejects requests that arrive too close together.',
  citations: [
    {
      sha7: 'e9a5c9c',
      quote:
        'The vendor returns 429 if two requests from the same account land within 3 seconds',
    },
  ],
};
const FALSE_CLAIM = {
  kind: 'memory',
  text: 'The vendor allows short bursts, so the delay can go.',
  citations: [{ sha7: 'e9a5c9c', quote: 'support confirmed there is a burst allowance' }],
};

type Content = { type: string; text?: string };
const textOf = (r: { content?: unknown }): string =>
  ((r.content as Content[] | undefined) ?? [])[0]?.text ?? '';

let samples: Samples;
let scratch: string;
let transport: StdioClientTransport;
let client: Client;
let stderr = '';

beforeAll(async () => {
  samples = buildSamples();
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-mcp-stdio-'));
  const entry = seanceEntry();
  const env = getDefaultEnvironment();
  for (const k of Object.keys(env)) {
    expect(k.startsWith('ANTHROPIC_')).toBe(false);
    expect(k.startsWith('GIT_')).toBe(false);
  }
  transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args,
    cwd: ROOT,
    env,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  client = new Client({ name: 'seance-test', version: '0.0.0' });
  await client.connect(transport, { timeout: 30_000 });
}, 90_000);

afterAll(async () => {
  fs.rmSync(samples.root, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('the seance server over stdio', () => {
  it('lists exactly the three tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'seance_haunting_map',
      'seance_summon',
      'seance_verify',
    ]);
  });

  it('summons the crypt, verifies one true and one false claim (R11.3, R5.3)', async () => {
    const summon = await client.callTool(
      {
        name: 'seance_summon',
        arguments: {
          repo: samples.crypt,
          file: 'legacy/tax.js',
          startLine: 7,
          endLine: 7,
        },
      },
      undefined,
      { timeout: 30_000 },
    );
    expect(summon.isError).toBeFalsy();
    const sc = summon.structuredContent as {
      ledgerId: string;
      items: { sha7: string }[];
    };
    expect(sc.items.map((i) => i.sha7)).toEqual(['e9a5c9c', '6a959a9']);
    expect(JSON.parse(textOf(summon))).toEqual(sc);

    const verdict = await client.callTool({
      name: 'seance_verify',
      arguments: { ledgerId: sc.ledgerId, claims: [TRUE_CLAIM, FALSE_CLAIM] },
    });
    expect(verdict.isError).toBeFalsy();
    const v = verdict.structuredContent as {
      verified: { index: number; quotes: { field: string }[] }[];
      rejected: { index: number; reason: string }[];
      tally: unknown;
      report: string;
    };
    expect(v.verified).toHaveLength(1);
    expect(v.verified[0]?.index).toBe(0);
    expect(v.verified[0]?.quotes[0]?.field).toBe('body');
    expect(v.rejected).toHaveLength(1);
    expect(v.rejected[0]?.index).toBe(1);
    expect(v.rejected[0]?.reason).toBe(REASONS.F9('e9a5c9c'));
    expect(v.tally).toEqual({ verified: 1, checked: 2, silent: 0 });
    expect(v.report).toContain('**1 of 2 claims passed the ward**');
  }, 60_000);

  it('a silence claim sent with no citations key lands in silent (R5.8)', async () => {
    const summon = await client.callTool(
      {
        name: 'seance_summon',
        arguments: {
          repo: samples.crypt,
          file: 'legacy/tax.js',
          startLine: 7,
          endLine: 7,
        },
      },
      undefined,
      { timeout: 30_000 },
    );
    const { ledgerId } = summon.structuredContent as { ledgerId: string };
    const silence = {
      kind: 'silence',
      text: 'The record is silent on whether the new tax vendor has the same limit.',
      silenceReason: 'Does the new tax vendor have the same limit?',
    };
    expect(Object.keys(silence)).toEqual(['kind', 'text', 'silenceReason']);
    const res = await client.callTool({
      name: 'seance_verify',
      arguments: { ledgerId, claims: [silence] },
    });
    expect(res.isError, textOf(res)).toBeFalsy();
    const v = res.structuredContent as {
      verified: unknown[];
      rejected: unknown[];
      silent: { index: number; text: string; silenceReason: string }[];
      tally: unknown;
    };
    expect(v.verified).toEqual([]);
    expect(v.rejected).toEqual([]);
    expect(v.silent).toEqual([
      { index: 0, text: silence.text, silenceReason: silence.silenceReason },
    ]);
    expect(v.tally).toEqual({ verified: 0, checked: 0, silent: 1 });
  }, 60_000);

  it('refuses a non-repository dir, a ".." file and a remote URL, naming no path (R11.4)', async () => {
    const plain = fs.mkdtempSync(path.join(scratch, 'plain-'));
    const notGit = await client.callTool({
      name: 'seance_summon',
      arguments: { repo: plain, file: 'a.js', startLine: 1, endLine: 1 },
    });
    expect(notGit.isError).toBe(true);
    expect(textOf(notGit)).toBe(MESSAGES.REPO_NOT_GIT);
    for (const p of [plain, os.tmpdir(), fs.realpathSync(os.tmpdir())]) {
      expect(textOf(notGit)).not.toContain(p);
    }

    const dots = await client.callTool({
      name: 'seance_summon',
      arguments: { repo: samples.crypt, file: '../x', startLine: 1, endLine: 1 },
    });
    expect(dots.isError).toBe(true);
    expect(textOf(dots)).toContain('file path must not contain ".."');
    expect(textOf(dots)).not.toContain(samples.root);

    const remote = await client.callTool({
      name: 'seance_summon',
      arguments: {
        repo: 'https://github.com/a/b',
        file: 'a.js',
        startLine: 1,
        endLine: 1,
      },
    });
    expect(remote.isError).toBe(true);
    expect(textOf(remote)).toBe(MESSAGES.REPO_REMOTE);
  });

  it('an unknown ledger id gives LEDGER_UNKNOWN (R4.4)', async () => {
    const res = await client.callTool({
      name: 'seance_verify',
      arguments: { ledgerId: randomUUID(), claims: [TRUE_CLAIM] },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe(MESSAGES.LEDGER_UNKNOWN);
  });

  it('logs to stderr, and exits on its own when stdin closes (R1.6, R1.7)', async () => {
    const pid = transport.pid;
    expect(pid).not.toBeNull();
    const t0 = Date.now();
    await client.close();
    // StdioClientTransport sends SIGTERM only after 2 s; closing sooner means stdin did it
    expect(Date.now() - t0).toBeLessThan(2_000);
    const alive = (): boolean => {
      try {
        process.kill(pid as number, 0);
        return true;
      } catch {
        return false;
      }
    };
    const deadline = Date.now() + 5_000;
    while (alive() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(alive()).toBe(false);
    expect(stderr).toContain('[seance:mcp] ready (3 tools)');
  }, 10_000);
});
