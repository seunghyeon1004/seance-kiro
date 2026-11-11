/**
 * store.ts — the in-memory ledger store of the MCP server (seance-mcp R4, design.md §4.2).
 *
 * Ledgers built by seance_summon are kept here, frozen, under a random UUID v4. At most
 * `max` are held; storing one more evicts the one stored first. Reading does not refresh an
 * entry. Nothing is written to disk, and the repository root is not stored.
 */

import { randomUUID } from 'node:crypto';
import type { EvidenceItem, LineRange } from '../ghost/schema.js';

export const MAX_LEDGERS = 50;

export interface StoredLedger {
  readonly items: readonly EvidenceItem[]; // as frozen by buildLedger
  readonly file: string; // repository-relative, as validated
  readonly range: LineRange;
  readonly truncated: boolean;
}

export class LedgerStore {
  private readonly entries = new Map<string, StoredLedger>();

  constructor(
    private readonly max: number = MAX_LEDGERS,
    private readonly newId: () => string = randomUUID,
  ) {}

  /** Freezes `ledger`, stores it under a new id, evicts the oldest entry beyond `max`. */
  put(ledger: StoredLedger): string {
    const id = this.newId();
    if (this.entries.has(id))
      throw new Error('LedgerStore: the id generator repeated an id');
    ledger.items.forEach((i) => Object.freeze(i));
    const frozen: StoredLedger = Object.freeze({
      items: Object.freeze([...ledger.items]),
      file: ledger.file,
      range: Object.freeze({
        startLine: ledger.range.startLine,
        endLine: ledger.range.endLine,
      }),
      truncated: ledger.truncated,
    });
    this.entries.set(id, frozen);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return id;
  }

  /** No effect on eviction order (R4.2). */
  get(id: string): StoredLedger | undefined {
    return this.entries.get(id);
  }

  get size(): number {
    return this.entries.size;
  }
}
