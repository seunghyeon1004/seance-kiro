/**
 * seance-mcp T2 — property tests MCP1–MCP9 for the tool handlers (design.md §8).
 *
 * The handlers are called as plain functions. verify() and renderWardReport() are the real
 * ones; only buildLedger, readHauntingMap and resolveRepo are injected, so no git runs here.
 */

import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { z } from 'zod';
import { verify } from '../../../src/ghost/verifier.js';
import { renderWardReport } from '../../../src/ghost/report.js';
import type {
  EvidenceItem,
  HauntingOutcome,
  LedgerResult,
} from '../../../src/ghost/schema.js';
import { GitError, HistoryError, ValidationError } from '../../../src/errors.js';
import { LedgerStore, MAX_LEDGERS } from '../../../src/mcp/store.js';
import { MESSAGES } from '../../../src/mcp/messages.js';
import { resolveLocalRepo } from '../../../src/mcp/repo.js';
import {
  HauntingOutputShape,
  SummonOutputShape,
  VerifyOutputShape,
  hauntingMapTool,
  summonTool,
  toSummonItem,
  verifyTool,
  type ToolDeps,
  type VerifyArgs,
} from '../../../src/mcp/tools.js';
import { CRYPT_MAP, POSSESSED_MAP } from '../../evidence/haunting.expected.js';
import {
  absPathArb,
  badFileArb,
  fcParams,
  ledgerAndClaimsArb,
  ledgerArb,
  remoteArb,
  textArb,
  type ClaimIn,
} from './arbitraries.js';

const FILE = 'legacy/tax.js';
const META = { file: FILE, lines: { start: 7, end: 7 } };
const ROOT = '/repo/root';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const ledgerResult = (items: EvidenceItem[], truncated = false): LedgerResult => ({
  items,
  truncated,
  buildDurationMs: 0,
});

function deps(over: Partial<ToolDeps> = {}): ToolDeps {
  return {
    cwd: ROOT,
    store: new LedgerStore(),
    buildLedger: async () => ledgerResult([]),
    readHauntingMap: async () => ({ kind: 'note', note: 'no map' }),
    resolveRepo: async () => ROOT,
    ...over,
  };
}

function storeLedger(items: EvidenceItem[]): { store: LedgerStore; id: string } {
  const store = new LedgerStore();
  const id = store.put({
    items,
    file: FILE,
    range: { startLine: 7, endLine: 7 },
    truncated: false,
  });
  return { store, id };
}

const asClaims = (claims: ClaimIn[]): VerifyArgs['claims'] => claims;

function mustOk<T>(o: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!o.ok) throw new Error(`expected success, got: ${o.message}`);
  return o.value;
}

const ALL_MESSAGES: readonly string[] = Object.values(MESSAGES);

describe('seance-mcp properties', () => {
  // MCP1 — ward parity (R5.2–R5.4, R5.6)
  test.prop([ledgerAndClaimsArb], fcParams)(
    'MCP1: verifyTool reports exactly what verify() and renderWardReport() say',
    ({ items, claims }) => {
      const { store, id } = storeLedger(items);
      const res = mustOk(
        verifyTool({ ledgerId: id, claims: asClaims(claims) }, { store }),
      );
      const ward = verify(items, { claims });

      expect(res.verified.map((v) => v.index)).toEqual(ward.verified.map((v) => v.index));
      expect(res.rejected.map((r) => r.index)).toEqual(ward.rejected.map((r) => r.index));
      expect(res.silent.map((s) => s.index)).toEqual(ward.silent.map((s) => s.index));
      ward.verified.forEach((v, k) => {
        const got = res.verified[k];
        expect(got?.text).toBe(v.claim.text);
        expect(got?.kind).toBe(v.claim.kind);
        expect(got?.quotes).toEqual(v.quotes);
        expect(got?.citations).toEqual(v.claim.citations);
        expect(got?.speculative).toBe(v.speculative);
      });
      ward.rejected.forEach((r, k) => {
        const got = res.rejected[k];
        expect(got?.text).toBe(r.text);
        expect(got?.kind).toBe(r.kind);
        expect(got?.reason).toBe(r.reason);
      });
      ward.silent.forEach((s, k) => {
        expect(res.silent[k]?.text).toBe(s.claim.text);
        expect(res.silent[k]?.silenceReason).toBe(s.claim.silenceReason);
      });
      expect(res.tally).toEqual({
        verified: ward.verified.length,
        checked: ward.verified.length + ward.rejected.length,
        silent: ward.silent.length,
      });
      expect(res.report).toBe(renderWardReport(ward, META));
    },
  );

  // MCP2 — no silence and no absent or shared sha7 in verified (R5.6)
  test.prop([ledgerAndClaimsArb], fcParams)(
    'MCP2: verified never holds a silence claim or a citation of an absent or shared sha7',
    ({ items, claims }) => {
      const { store, id } = storeLedger(items);
      const res = mustOk(
        verifyTool({ ledgerId: id, claims: asClaims(claims) }, { store }),
      );
      for (const v of res.verified) {
        const sent = claims[v.index];
        expect(sent?.kind).not.toBe('silence');
        for (const c of sent?.citations ?? []) {
          expect(items.filter((i) => i.shortSha === c.sha7)).toHaveLength(1);
        }
      }
    },
  );

  // MCP3 — any 8-to-500-character piece of a returned field is a quote the ward finds (R2.4)
  test.prop(
    [
      ledgerArb.filter((l) => l.length > 0),
      fc.nat(),
      fc.constantFrom('subject' as const, 'body' as const, 'hunk' as const),
      fc.nat({ max: 6000 }),
      fc.integer({ min: 8, max: 500 }),
    ],
    fcParams,
  )(
    'MCP3: a quote copied from a summon item field is verified',
    (items, pick, field, start, len) => {
      const unique = items.filter(
        (i) => items.filter((j) => j.shortSha === i.shortSha).length === 1,
      );
      fc.pre(unique.length > 0);
      const item = unique[pick % unique.length] as EvidenceItem;
      const source = toSummonItem(item)[field];
      fc.pre(source.length >= 8);
      const s = start % source.length;
      const q = source.slice(s, s + len);
      fc.pre(q.trim().length >= 8 && q.length <= 500);

      const { store, id } = storeLedger(items);
      const res = mustOk(
        verifyTool(
          {
            ledgerId: id,
            claims: [
              {
                kind: 'memory',
                text: 'The record says so.',
                citations: [{ sha7: item.shortSha, quote: q }],
              },
            ],
          },
          { store },
        ),
      );
      expect(res.rejected).toEqual([]);
      expect(res.verified).toHaveLength(1);
    },
  );

  // MCP4 — the summon item shape (R2.4, R2.5)
  test.prop([ledgerArb.filter((l) => l.length > 0)], fcParams)(
    'MCP4: toSummonItem has exactly the seven fields, mapped as specified',
    (items) => {
      for (const item of items) {
        const s = toSummonItem(item);
        expect(Object.keys(s).sort()).toEqual(
          ['author', 'body', 'date', 'hunk', 'sha7', 'subject', 'suspicious'].sort(),
        );
        expect(s.sha7).toBe(item.shortSha);
        expect(s.hunk).toBe(item.hunk.slice(0, 4000));
        expect(s.suspicious).toBe(item.suspiciousMessage);
        expect(s.subject).toBe(item.subject);
        expect(s.body).toBe(item.body);
        expect(s.author).toBe(item.author);
        expect(s.date).toBe(item.date);
      }
    },
  );

  // MCP5 — the store (R4.1, R4.2)
  test.prop([fc.integer({ min: 0, max: 130 }), fc.nat()], fcParams)(
    'MCP5: after n puts the store holds the last min(n, 50), in any read order',
    (n, seed) => {
      const store = new LedgerStore();
      const ids: string[] = [];
      for (let k = 0; k < n; k++) {
        ids.push(
          store.put({
            items: [],
            file: `f${k}`,
            range: { startLine: 1, endLine: 1 },
            truncated: false,
          }),
        );
      }
      const keep = Math.min(n, MAX_LEDGERS);
      expect(store.size).toBe(keep);
      expect(new Set(ids).size).toBe(n);
      const kept = ids.slice(n - keep).map((id, k) => [id, n - keep + k] as const);
      // a deterministic shuffle of the read order
      const order = [...kept].sort(
        (a, b) => ((a[1] * 7919 + seed) % 101) - ((b[1] * 7919 + seed) % 101),
      );
      for (const [id, k] of order) expect(store.get(id)?.file).toBe(`f${k}`);
      for (const id of ids.slice(0, n - keep)) expect(store.get(id)).toBeUndefined();
    },
  );

  // MCP6 — no leak (R3.5, R7.3)
  const errorArb = fc
    .tuple(
      absPathArb,
      fc.constantFrom('git', 'history', 'validation', 'error', 'string', 'object'),
    )
    .map(([p, kind]) => {
      const msg = `failed in ${p}\n    at f (${p}/x.js:1:1)`;
      switch (kind) {
        case 'git':
          return { p, err: new GitError(msg) as unknown };
        case 'history':
          return { p, err: new HistoryError(msg) as unknown };
        case 'validation':
          return { p, err: new ValidationError(msg) as unknown };
        case 'error':
          return { p, err: new Error(msg) as unknown };
        case 'string':
          return { p, err: msg as unknown };
        default:
          return { p, err: { message: msg } as unknown };
      }
    });

  test.prop(
    [errorArb, fc.constantFrom('buildLedger', 'resolveRepo', 'haunting')],
    fcParams,
  )(
    'MCP6: a thrown error becomes a fixed sentence with no path or stack line',
    async ({ p, err }, where) => {
      const thrower = async (): Promise<never> => {
        throw err;
      };
      const outcome =
        where === 'haunting'
          ? await hauntingMapTool({}, deps({ resolveRepo: thrower }))
          : await summonTool(
              { file: FILE, startLine: 7, endLine: 7 },
              deps(
                where === 'buildLedger'
                  ? { buildLedger: thrower }
                  : { resolveRepo: thrower },
              ),
            );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(ALL_MESSAGES).toContain(outcome.message);
      expect(outcome.message).not.toContain(p);
      expect(outcome.message).not.toContain('\n    at ');
    },
  );

  // MCP7 — refusals before git (R2.2, R3.1)
  test.prop([badFileArb], fcParams)(
    'MCP7a: a file with ".." or a leading "/" is refused and buildLedger is never called',
    async (file) => {
      const buildLedger = vi.fn(async () => ledgerResult([]));
      const outcome = await summonTool(
        { file, startLine: 1, endLine: 1 },
        deps({ buildLedger }),
      );
      expect(outcome.ok).toBe(false);
      expect(buildLedger).not.toHaveBeenCalled();
    },
  );

  test.prop([remoteArb, fc.boolean()], fcParams)(
    'MCP7b: a remote repo is refused before realpath and before buildLedger',
    async (repo, haunting) => {
      const realpath = vi.fn(async (x: string) => x);
      const buildLedger = vi.fn(async () => ledgerResult([]));
      const readHauntingMap = vi.fn(
        async (): Promise<HauntingOutcome> => ({ kind: 'note', note: 'x' }),
      );
      const d = deps({
        buildLedger,
        readHauntingMap,
        resolveRepo: (r, cwd) => resolveLocalRepo(r, cwd, { realpath }),
      });
      const outcome = haunting
        ? await hauntingMapTool({ repo }, d)
        : await summonTool({ repo, file: FILE, startLine: 1, endLine: 1 }, d);
      expect(outcome).toEqual({ ok: false, message: MESSAGES.REPO_REMOTE });
      expect(realpath).not.toHaveBeenCalled();
      expect(buildLedger).not.toHaveBeenCalled();
      expect(readHauntingMap).not.toHaveBeenCalled();
    },
  );

  // MCP8 — determinism and an unchanged ledger (R4.3, R5.7, N4)
  test.prop([ledgerAndClaimsArb], fcParams)(
    'MCP8: verifyTool twice gives deep-equal results and leaves the ledger unchanged',
    ({ items, claims }) => {
      const before = structuredClone(items);
      const { store, id } = storeLedger(items);
      const a = verifyTool({ ledgerId: id, claims: asClaims(claims) }, { store });
      const b = verifyTool({ ledgerId: id, claims: asClaims(claims) }, { store });
      expect(b).toEqual(a);
      expect(structuredClone(store.get(id)?.items)).toEqual(before);
    },
  );

  // MCP9 — every success passes its output shape (R7.1)
  test.prop([ledgerAndClaimsArb, fc.boolean()], fcParams)(
    'MCP9a: summon and verify results pass their output shapes',
    async ({ items, claims }, truncated) => {
      const d = deps({ buildLedger: async () => ledgerResult(items, truncated) });
      const summon = mustOk(
        await summonTool({ file: FILE, startLine: 7, endLine: 7 }, d),
      );
      expect(z.object(SummonOutputShape).strict().safeParse(summon).success).toBe(true);
      const res = mustOk(
        verifyTool({ ledgerId: summon.ledgerId, claims: asClaims(claims) }, d),
      );
      const parsed = z.object(VerifyOutputShape).strict().safeParse(res);
      expect(parsed.success ? 'ok' : parsed.error.message).toBe('ok');
    },
  );

  const outcomeArb: fc.Arbitrary<HauntingOutcome> = fc.oneof(
    fc.constantFrom<HauntingOutcome>(
      { kind: 'map', map: CRYPT_MAP },
      { kind: 'map', map: POSSESSED_MAP },
    ),
    textArb(200)
      .filter((t) => t.length > 0)
      .map((note): HauntingOutcome => ({ kind: 'note', note })),
  );

  test.prop([outcomeArb], fcParams)(
    'MCP9b: haunting results pass their output shape and carry map or note, never both',
    async (outcome) => {
      const res = mustOk(
        await hauntingMapTool({}, deps({ readHauntingMap: async () => outcome })),
      );
      expect(z.object(HauntingOutputShape).strict().safeParse(res).success).toBe(true);
      expect(('map' in res ? 1 : 0) + ('note' in res ? 1 : 0)).toBe(1);
    },
  );
});
