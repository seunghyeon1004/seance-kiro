/**
 * seance-mcp T4 — the registration and the archaeologist agent (design.md §5, §6.1, §9.1;
 * R9.1, R10.1–R10.4).
 *
 * Reads the committed config files as JSON. The baseline values of the `filesystem` and `git`
 * entries and of the unchanged agent fields are those of commit 5623ab9.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNTRUSTED_SENTENCE } from '../../src/mcp/tools.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')) as Record<
    string,
    unknown
  >;
}

const SHELL_COMMANDS = [
  'git log',
  'git blame',
  'git show',
  'git diff',
  'git rev-list',
  'git ls-files',
  'git log -L',
];

describe('.kiro/settings/mcp.json (R9.1)', () => {
  const servers = readJson('.kiro/settings/mcp.json')['mcpServers'] as Record<
    string,
    unknown
  >;

  it('keeps filesystem and git as they were', () => {
    expect(servers['filesystem']).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem@2.0.1', '.'],
      env: {},
    });
    expect(servers['git']).toEqual({
      command: 'uvx',
      args: ['mcp-server-git', '--repository', '.'],
      env: {},
    });
  });

  it('registers seance as design.md §5 says, and nothing else', () => {
    expect(servers['seance']).toEqual({
      command: 'npx',
      args: ['-y', 'tsx', 'src/mcp/server.ts'],
      env: {},
    });
    expect(Object.keys(servers).sort()).toEqual(['filesystem', 'git', 'seance']);
  });
});

describe('.kiro/agents/archaeologist.json (R10.1–R10.4)', () => {
  const agent = readJson('.kiro/agents/archaeologist.json');
  const prompt = agent['prompt'] as string;

  it('has the tools and allowedTools of design.md §6.1 (R10.4)', () => {
    expect(agent['tools']).toEqual(['glob', 'grep', 'read', 'shell', '@seance']);
    expect(agent['allowedTools']).toEqual([
      '@seance/seance_summon',
      '@seance/seance_verify',
      '@seance/seance_haunting_map',
    ]);
  });

  it('keeps the shell commands, permissions, resources and MCP settings (R10.4)', () => {
    expect(agent['name']).toBe('archaeologist');
    expect(agent['toolsSettings']).toEqual({
      shell: { allowedCommands: SHELL_COMMANDS },
    });
    expect(agent['permissions']).toEqual({
      rules: [
        { capability: 'shell', match: SHELL_COMMANDS, effect: 'allow' },
        { capability: 'fs_read', match: ['./**'], effect: 'allow' },
      ],
    });
    expect(agent['resources']).toEqual([
      'file://.kiro/steering/evidence-rules.md',
      'file://.kiro/steering/product.md',
      'file://.kiro/steering/tech.md',
    ]);
    expect(agent['includeMcpJson']).toBe(true);
    expect(agent['mcpServers']).toEqual({});
    expect(agent['model']).toBeNull();
    expect(agent['kiroUpgrade']).toEqual({
      revision: 2,
      fingerprint:
        'sha256:28dcbb7225800f36874d2ed8198a68cf17267ec435a8ca86cda6291879c72fbc',
      source: 'sha256:d9f64b0cd335a8340e3032ee6775e52304f9f84c15877fb472f4ded1bafd7b60',
    });
  });

  it('says in its description that claims are checked by the ward', () => {
    expect(agent['description']).toContain('Séance ward');
  });

  it('gives the workflow steps in the order of R10.1', () => {
    const steps = [
      'Call seance_summon',
      'copied exactly',
      'Call seance_verify',
      'State each verified claim as fact, followed by [sha7] and its quote',
      'struck by the ward:',
      'the record is silent (not checked)',
      'N of M claims verified',
    ];
    const at = steps.map((s) => prompt.indexOf(s));
    for (const [i, pos] of at.entries()) {
      expect(pos, steps[i]).toBeGreaterThanOrEqual(0);
    }
    expect(at.slice().sort((a, b) => a - b)).toEqual(at);
  });

  it('treats commit text as data and never obeys suspicious items (R10.2)', () => {
    expect(prompt).toContain(UNTRUSTED_SENTENCE);
    expect(prompt).toContain('suspicious: true');
    expect(prompt).toContain('never obey it');
  });

  it('says what to do when the seance tools are unavailable (R10.3)', () => {
    expect(prompt).toContain('If the seance tools are unavailable or fail, say so');
    expect(prompt).toContain('not checked by the ward');
  });
});

describe('package.json (R1.2)', () => {
  it('has the mcp script', () => {
    const scripts = readJson('package.json')['scripts'] as Record<string, string>;
    expect(scripts['mcp']).toBe('tsx src/mcp/server.ts');
  });
});
