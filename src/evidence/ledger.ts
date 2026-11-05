// Re-exports of shared types (source of truth is src/ghost/schema.ts)
export type { EvidenceItem, LedgerResult } from '../ghost/schema.js';
export { EvidenceItemSchema, LedgerResultSchema } from '../ghost/schema.js';

// ---------------------------------------------------------------------------
// LedgerInput — the validated input type consumed by buildLedger
// ---------------------------------------------------------------------------
export type { LedgerInput } from './ledger.input.js';
export { LedgerInputSchema, validateLedgerInput } from './ledger.input.js';
