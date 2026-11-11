/**
 * seance-mcp T1 — the ledger store (R4.1–R4.3, design.md §4.2).
 */

import { describe, expect, it } from 'vitest';
import { LedgerStore, MAX_LEDGERS, type StoredLedger } from '../../src/mcp/store.js';
import type { EvidenceItem } from '../../src/ghost/schema.js';

function item(n: number): EvidenceItem {
  const sha = n.toString(16).padStart(40, '0');
  return {
    id: `E${n + 1}`,
    sha,
    shortSha: sha.slice(0, 7),
    author: 'Dmitri Volkov',
    email: 'dmitri@example.com',
    date: '2020-02-11T09:05:00.000Z',
    subject: `subject ${n}`,
    body: '',
    hunk: '',
    files: [],
    refs: [],
    suspiciousMessage: false,
  };
}

function ledger(n: number): StoredLedger {
  return {
    items: [item(n)],
    file: 'legacy/tax.js',
    range: { startLine: 7, endLine: 7 },
    truncated: false,
  };
}

describe('LedgerStore', () => {
  it('holds at most MAX_LEDGERS (50) and evicts the first stored at 51 (R4.2)', () => {
    expect(MAX_LEDGERS).toBe(50);
    const store = new LedgerStore();
    const ids: string[] = [];
    for (let i = 0; i < 51; i++) ids.push(store.put(ledger(i)));
    expect(store.size).toBe(50);
    expect(store.get(ids[0] as string)).toBeUndefined();
    expect(store.get(ids[1] as string)?.items[0]?.subject).toBe('subject 1');
    expect(store.get(ids[50] as string)?.items[0]?.subject).toBe('subject 50');
  });

  it('a read does not change the eviction order (R4.2)', () => {
    const store = new LedgerStore();
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push(store.put(ledger(i)));
    expect(store.get(ids[0] as string)).toBeDefined();
    store.put(ledger(50));
    expect(store.get(ids[0] as string)).toBeUndefined();
    expect(store.get(ids[1] as string)).toBeDefined();
  });

  it('ids are UUID v4 by default (R4.1)', () => {
    const store = new LedgerStore();
    const id = store.put(ledger(0));
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('a stored entry, its items and its range are frozen (R4.3)', () => {
    const store = new LedgerStore();
    const id = store.put(ledger(0));
    const got = store.get(id);
    expect(got).toBeDefined();
    if (got === undefined) return;
    expect(Object.isFrozen(got)).toBe(true);
    expect(Object.isFrozen(got.items)).toBe(true);
    expect(Object.isFrozen(got.items[0])).toBe(true);
    expect(Object.isFrozen(got.range)).toBe(true);
  });

  it('a newId that repeats an id makes put throw (R4.1)', () => {
    const store = new LedgerStore(MAX_LEDGERS, () => 'same-id');
    store.put(ledger(0));
    expect(() => store.put(ledger(1))).toThrow();
    expect(store.size).toBe(1);
  });
});
