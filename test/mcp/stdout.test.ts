/**
 * seance-mcp T3 — stdout carries protocol messages only (design.md §9.3; R1.6, R1.7, R11.5).
 *
 * Raw newline-delimited JSON-RPC is written to the registered command's stdin, including two
 * calls that make the server log (a git failure and a refusal). Once every response is in,
 * stdin is ended. Every stdout line must parse as a protocol message, and the logs must be on
 * stderr.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { deserializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { buildSamples, type Samples } from '../e2e/harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let samples: Samples;
let scratch: string;

beforeAll(() => {
  samples = buildSamples();
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-mcp-stdout-'));
}, 60_000);

afterAll(() => {
  fs.rmSync(samples.root, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('stdout of the seance server', () => {
  it('holds protocol messages only; logs go to stderr; stdin end exits 0', async () => {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(ROOT, '.kiro/settings/mcp.json'), 'utf8'),
    ) as { mcpServers: Record<string, { command: string; args: string[] }> };
    const entry = cfg.mcpServers['seance'];
    if (entry === undefined) throw new Error('no seance entry');
    const plain = fs.mkdtempSync(path.join(scratch, 'plain-'));

    const child = spawn(entry.command, entry.args, {
      cwd: ROOT,
      env: getDefaultEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const responses = new Set<number>();
    const allIn = new Promise<void>((resolve) => {
      child.stdout.on('data', (chunk: string) => {
        out += chunk;
        for (const m of out.matchAll(/"id":(\d+)/g)) responses.add(Number(m[1]));
        if ([1, 2, 3, 4, 5].every((id) => responses.has(id))) resolve();
      });
    });
    child.stderr.on('data', (chunk: string) => {
      err += chunk;
    });
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));

    const send = (msg: object): void => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
    };
    send({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'raw', version: '0.0.0' },
      },
    });
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/list', params: {} });
    send({
      id: 3,
      method: 'tools/call',
      params: {
        name: 'seance_summon',
        arguments: {
          repo: samples.crypt,
          file: 'legacy/tax.js',
          startLine: 7,
          endLine: 7,
        },
      },
    });
    send({
      id: 4,
      method: 'tools/call',
      params: {
        name: 'seance_summon',
        arguments: {
          repo: samples.crypt,
          file: 'legacy/missing.js',
          startLine: 1,
          endLine: 1,
        },
      },
    });
    send({
      id: 5,
      method: 'tools/call',
      params: { name: 'seance_haunting_map', arguments: { repo: plain } },
    });

    await allIn;
    child.stdin.end();
    const code = await exited;
    expect(code).toBe(0);

    const lines = out.split('\n').filter((l) => l.trim() !== '');
    const ids: unknown[] = [];
    for (const line of lines) {
      const msg = deserializeMessage(line) as { id?: unknown };
      if ('id' in msg) ids.push(msg.id);
    }
    expect(ids.slice().sort()).toEqual([1, 2, 3, 4, 5]);
    expect(err).toContain('[seance:mcp]');
    expect(err).toContain('seance_summon failed');
    expect(err).toContain('seance_haunting_map refused');
    expect(out).not.toContain('[seance');
  }, 60_000);
});
