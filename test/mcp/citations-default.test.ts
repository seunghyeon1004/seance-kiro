/**
 * seance-mcp T7 — a claim's `citations` is optional at the MCP boundary and defaults to []
 * (R5.8; design.md §3.2 addendum).
 *
 * Found in the third real run (docs/kiro-evidence/seance-mcp-session.txt): seance_verify
 * refused a silence claim sent without a `citations` field with "Required at
 * claims[4].citations". A silence claim has no citations by definition, so the field must
 * not be required to reach the ward. A memory or speculation claim without the field still
 * reaches the ward, which strikes it with its own reason. The ward itself is unchanged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EvidenceItem, LedgerResult } from '../../src/ghost/schema.js';
import { verify } from '../../src/ghost/verifier.js';
import { createSeanceMcpServer } from '../../src/mcp/app.js';
import { LedgerStore } from '../../src/mcp/store.js';
import { VerifyInputShape, verifyTool, type VerifyResult } from '../../src/mcp/tools.js';

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

const SILENCE = {
  kind: 'silence',
  text: 'The record is silent on how the 3-second figure was measured.',
  silenceReason: 'How was the 3-second figure measured?',
} as const;
const MEMORY_BARE = {
  kind: 'memory',
  text: 'The vendor rejects close requests.',
} as const;
const SPECULATION_BARE = {
  kind: 'speculation',
  text: 'A queue would probably replace the delay.',
} as const;

const VerifyInput = z.object(VerifyInputShape);
const ID = '00000000-0000-4000-8000-000000000000';

describe('the boundary shape', () => {
  it('accepts a claim with no citations key and gives it citations: []', () => {
    const parsed = VerifyInput.parse({ ledgerId: ID, claims: [SILENCE, MEMORY_BARE] });
    expect(parsed.claims[0]?.citations).toEqual([]);
    expect(parsed.claims[1]?.citations).toEqual([]);
  });

  it('still refuses citations that are not an array', () => {
    expect(
      VerifyInput.safeParse({ ledgerId: ID, claims: [{ ...SILENCE, citations: 'x' }] })
        .success,
    ).toBe(false);
    expect(
      VerifyInput.safeParse({ ledgerId: ID, claims: [{ ...SILENCE, citations: null }] })
        .success,
    ).toBe(false);
  });
});

describe('verifyTool after the boundary', () => {
  function run(claims: unknown[]): VerifyResult {
    const store = new LedgerStore();
    const id = store.put({
      items: LEDGER.items,
      file: 'legacy/tax.js',
      range: { startLine: 7, endLine: 7 },
      truncated: false,
    });
    const out = verifyTool(VerifyInput.parse({ ledgerId: id, claims }), { store });
    if (!out.ok) throw new Error(out.message);
    return out.value;
  }

  it('puts a silence claim without the field in silent, never in verified', () => {
    const r = run([SILENCE]);
    expect(r.verified).toEqual([]);
    expect(r.rejected).toEqual([]);
    expect(r.silent).toEqual([
      { index: 0, text: SILENCE.text, silenceReason: SILENCE.silenceReason },
    ]);
    expect(r.tally).toEqual({ verified: 0, checked: 0, silent: 1 });
  });

  it("strikes a memory or speculation claim without the field with the ward's own reason", () => {
    const r = run([MEMORY_BARE, SPECULATION_BARE]);
    expect(r.verified).toEqual([]);
    expect(r.rejected.map((x) => x.index)).toEqual([0, 1]);
    expect(r.rejected[0]?.reason).toContain(
      'A memory claim needs at least one citation.',
    );
    expect(r.rejected[1]?.reason).toContain(
      'A speculation claim needs at least one citation.',
    );
    // the same verdict as the ward on the defaulted claims
    const ward = verify(LEDGER.items, {
      claims: [MEMORY_BARE, SPECULATION_BARE].map((c) => ({ ...c, citations: [] })),
    });
    expect(r.rejected.map((x) => x.reason)).toEqual(ward.rejected.map((x) => x.reason));
  });
});

describe('over the SDK client', () => {
  let server: McpServer;
  let client: Client;

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    server = createSeanceMcpServer({
      cwd: '/repo/root',
      store: new LedgerStore(),
      resolveRepo: async () => '/repo/root',
      buildLedger: async () => LEDGER,
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'seance-test', version: '0.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    vi.restoreAllMocks();
  });

  it('a silence claim with no citations key lands in silent; a bare memory claim is struck', async () => {
    const summon = await client.callTool({
      name: 'seance_summon',
      arguments: { file: 'legacy/tax.js', startLine: 7, endLine: 7 },
    });
    const ledgerId = (summon.structuredContent as { ledgerId: string }).ledgerId;
    const res = await client.callTool({
      name: 'seance_verify',
      arguments: { ledgerId, claims: [SILENCE, MEMORY_BARE] },
    });
    expect(res.isError).toBeFalsy();
    const v = res.structuredContent as VerifyResult;
    expect(v.verified).toEqual([]);
    expect(v.silent.map((s) => s.index)).toEqual([0]);
    expect(v.rejected.map((r) => r.index)).toEqual([1]);
    expect(v.rejected[0]?.reason).toContain(
      'A memory claim needs at least one citation.',
    );
    expect(v.tally).toEqual({ verified: 0, checked: 1, silent: 1 });
  });

  it('publishes citations as optional with default []', async () => {
    const { tools } = await client.listTools();
    const verifyTool = tools.find((t) => t.name === 'seance_verify');
    const claims = (
      verifyTool?.inputSchema.properties as Record<string, Record<string, unknown>>
    )['claims'];
    const item = claims?.['items'] as {
      required: string[];
      properties: Record<string, { default?: unknown }>;
    };
    expect(item.required.slice().sort()).toEqual(['kind', 'text']);
    expect(item.properties['citations']?.default).toEqual([]);
  });
});
