/**
 * seance-mcp T3 — the MCP server over an in-memory transport with the SDK's Client
 * (R1.3, R1.4, R1.8, R5.1, R7.1, R7.2, R7.4, R8.1, R8.2; design.md §3.2, §3.6, §9.1).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EvidenceItem, LedgerResult } from '../../src/ghost/schema.js';
import { createSeanceMcpServer, SERVER_NAME, SERVER_VERSION } from '../../src/mcp/app.js';
import { LedgerStore } from '../../src/mcp/store.js';
import { MESSAGES } from '../../src/mcp/messages.js';
import {
  MAX_TOOL_INPUT_ELEMENTS,
  UNTRUSTED_SENTENCE,
  type ToolDeps,
} from '../../src/mcp/tools.js';
import { CRYPT_MAP } from '../evidence/haunting.expected.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ITEM: EvidenceItem = {
  id: 'E1',
  sha: 'e9a5c9c'.padEnd(40, '0'),
  shortSha: 'e9a5c9c',
  author: 'Dmitri Volkov',
  email: 'dmitri@example.com',
  date: '2020-02-11T09:05:00.000Z',
  subject: 'hack: wait 3s before calling the tax vendor',
  body: 'The vendor returns 429 if two requests from the same account land within 3 seconds.',
  hunk: '@@ -1 +1 @@\n+await sleep(3000);',
  files: ['legacy/tax.js'],
  refs: [],
  suspiciousMessage: false,
};

const LEDGER: LedgerResult = { items: [ITEM], truncated: false, buildDurationMs: 0 };

let server: McpServer;
let client: Client;
let store: LedgerStore;

async function connect(deps: Partial<ToolDeps> = {}): Promise<void> {
  store = new LedgerStore();
  server = createSeanceMcpServer({
    cwd: '/repo/root',
    store,
    resolveRepo: async () => '/repo/root',
    buildLedger: async () => LEDGER,
    readHauntingMap: async () => ({ kind: 'map', map: CRYPT_MAP }),
    ...deps,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'seance-test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
}

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await connect();
});

afterEach(async () => {
  await client.close();
  await server.close();
  vi.restoreAllMocks();
});

type Content = { type: string; text?: string };

describe('tools/list', () => {
  it('names exactly the three tools, with titles, annotations and output schemas (R1.3, R1.4)', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'seance_haunting_map',
      'seance_summon',
      'seance_verify',
    ]);
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('seance_summon')?.title).toBe('Summon the evidence ledger');
    expect(byName.get('seance_verify')?.title).toBe('Verify claims with the ward');
    expect(byName.get('seance_haunting_map')?.title).toBe('Read the haunting map');
    const idempotent = {
      seance_summon: false,
      seance_verify: true,
      seance_haunting_map: true,
    } as const;
    for (const t of tools) {
      expect(t.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: idempotent[t.name as keyof typeof idempotent],
        openWorldHint: false,
      });
      expect(t.outputSchema?.type).toBe('object');
      expect(typeof t.description).toBe('string');
    }
  });

  it('says commit text is data, and what suspicious: true means (R8.1, R8.2)', async () => {
    const { tools } = await client.listTools();
    const d = (n: string): string => tools.find((t) => t.name === n)?.description ?? '';
    expect(d('seance_summon')).toContain(UNTRUSTED_SENTENCE);
    expect(d('seance_verify')).toContain(UNTRUSTED_SENTENCE);
    expect(d('seance_summon')).toContain(
      'An item with suspicious: true contains text that tries to give orders.',
    );
  });

  it('publishes the input schemas of design.md §3.2 (R5.1)', async () => {
    const { tools } = await client.listTools();
    const schema = (n: string) => tools.find((t) => t.name === n)?.inputSchema;
    expect(schema('seance_summon')?.required?.slice().sort()).toEqual(
      ['endLine', 'file', 'startLine'].sort(),
    );
    expect(schema('seance_haunting_map')?.required ?? []).toEqual([]);
    const verify = schema('seance_verify');
    expect(verify?.required?.slice().sort()).toEqual(['claims', 'ledgerId']);
    const claims = (verify?.properties as Record<string, Record<string, unknown>>)[
      'claims'
    ];
    expect(claims?.['maxItems']).toBe(50);
    expect(claims?.['minItems']).toBe(1);
    const item = claims?.['items'] as {
      required: string[];
      properties: Record<string, { enum?: string[]; maxItems?: number }>;
    };
    // `citations` is optional with default [] since R5.8 (design.md §3.2 addendum)
    expect(item.required.slice().sort()).toEqual(['kind', 'text']);
    expect(item.properties['kind']?.enum).toEqual(['memory', 'speculation', 'silence']);
    expect(item.properties['citations']?.maxItems).toBe(20);
  });

  it('announces tools only: no resources, no prompts (R1.3)', () => {
    const caps = client.getServerCapabilities();
    expect(caps?.tools).toBeDefined();
    expect(caps?.resources).toBeUndefined();
    expect(caps?.prompts).toBeUndefined();
    expect(client.getServerVersion()).toEqual({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    });
  });

  it('SERVER_VERSION equals package.json version', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(SERVER_NAME).toBe('seance');
    expect(SERVER_VERSION).toBe(pkg.version);
  });
});

describe('tools/call results', () => {
  it('a success has one text item whose JSON equals structuredContent (R7.1)', async () => {
    const summon = await client.callTool({
      name: 'seance_summon',
      arguments: { file: 'legacy/tax.js', startLine: 1, endLine: 1 },
    });
    expect(summon.isError).toBeFalsy();
    const content = summon.content as Content[];
    expect(content).toHaveLength(1);
    expect(content[0]?.type).toBe('text');
    expect(JSON.parse(content[0]?.text ?? '')).toEqual(summon.structuredContent);

    const map = await client.callTool({ name: 'seance_haunting_map', arguments: {} });
    expect(map.isError).toBeFalsy();
    expect(map.structuredContent).toEqual({ map: CRYPT_MAP });
    expect(JSON.parse((map.content as Content[])[0]?.text ?? '')).toEqual({
      map: CRYPT_MAP,
    });

    const ledgerId = (summon.structuredContent as { ledgerId: string }).ledgerId;
    const verdict = await client.callTool({
      name: 'seance_verify',
      arguments: {
        ledgerId,
        claims: [
          {
            kind: 'memory',
            text: 'The vendor rejects close requests.',
            citations: [{ sha7: 'e9a5c9c', quote: 'The vendor returns 429' }],
          },
        ],
      },
    });
    expect(verdict.isError).toBeFalsy();
    const sc = verdict.structuredContent as { tally: unknown };
    expect(sc.tally).toEqual({ verified: 1, checked: 1, silent: 0 });
    expect(JSON.parse((verdict.content as Content[])[0]?.text ?? '')).toEqual(sc);
  });

  it('a refusal is isError with one text item and no structuredContent (R7.2)', async () => {
    const res = await client.callTool({
      name: 'seance_verify',
      arguments: {
        ledgerId: '00000000-0000-4000-8000-000000000000',
        claims: [{ kind: 'silence', text: 'x', citations: [] }],
      },
    });
    expect(res.isError).toBe(true);
    expect(res.content).toEqual([{ type: 'text', text: MESSAGES.LEDGER_UNKNOWN }]);
    expect(res.structuredContent).toBeUndefined();
  });

  it('a wrong argument type is refused by the SDK with no stack line (R7.4)', async () => {
    const res = await client.callTool({
      name: 'seance_summon',
      arguments: { file: 'legacy/tax.js', startLine: '7', endLine: 7 },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as Content[])[0]?.text ?? '';
    expect(text.startsWith('MCP error -32602: Input validation error')).toBe(true);
    expect(text).not.toContain('\n    at ');
    expect(res.structuredContent).toBeUndefined();
  });

  it('a payload over MAX_TOOL_INPUT_ELEMENTS is refused before the handler runs (R1.8)', async () => {
    const get = vi.spyOn(store, 'get');
    const claims = Array.from({ length: MAX_TOOL_INPUT_ELEMENTS + 1 }, () => ({
      kind: 'silence',
      text: 'x',
      citations: [],
    }));
    const res = await client.callTool({
      name: 'seance_verify',
      arguments: { ledgerId: '00000000-0000-4000-8000-000000000000', claims },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as Content[])[0]?.text ?? '';
    expect(text).toContain(`maximum of ${MAX_TOOL_INPUT_ELEMENTS} elements`);
    expect(get).not.toHaveBeenCalled();
  });
});
