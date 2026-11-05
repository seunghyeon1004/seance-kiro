/**
 * Integration test for buildLedger against the crypt fixture repository.
 *
 * This file is excluded from the default Vitest run (vitest.config.ts excludes
 * `*.integration.ts`).  Run explicitly with:
 *
 *   INTEGRATION=1 npx vitest --run test/evidence/ledger.integration.ts
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { buildLedger } from '../../src/evidence/ledger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRYPT_REPO = path.resolve(__dirname, '../fixtures/crypt');

const INTEGRATION = process.env['INTEGRATION'] === '1';

describe.skipIf(!INTEGRATION)('buildLedger — integration against crypt fixture', () => {
  it('builds a ledger with at least one valid EvidenceItem', async () => {
    const result = await buildLedger({
      repoUrl: CRYPT_REPO,
      file: 'haunted.ts',
      startLine: 1,
      endLine: 6,
    });

    // Basic shape
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
    expect(result.buildDurationMs).toBeGreaterThanOrEqual(0);

    // Every item must have all required fields
    for (const item of result.items) {
      expect(item.id).toMatch(/^E\d+$/);
      expect(item.sha).toHaveLength(40);
      expect(item.sha).toMatch(/^[0-9a-f]+$/);
      expect(item.shortSha).toHaveLength(7);
      expect(item.sha.startsWith(item.shortSha)).toBe(true);
      expect(item.author).toBeTruthy();
      expect(item.email).toBeTruthy();
      expect(typeof item.date).toBe('string');
      expect(isNaN(Date.parse(item.date))).toBe(false);
      expect(typeof item.subject).toBe('string');
      expect(typeof item.body).toBe('string');
      expect(typeof item.hunk).toBe('string');
      expect(Array.isArray(item.files)).toBe(true);
      expect(Array.isArray(item.refs)).toBe(true);
    }
  });

  it('detects the Fixes #7 reference from the crypt fixture', async () => {
    const result = await buildLedger({
      repoUrl: CRYPT_REPO,
      file: 'haunted.ts',
      startLine: 1,
      endLine: 6,
    });

    const refsAcrossItems = result.items.flatMap((item) => item.refs);
    expect(refsAcrossItems).toContain('#7');
  });

  it('records build timing', async () => {
    const result = await buildLedger({
      repoUrl: CRYPT_REPO,
      file: 'haunted.ts',
      startLine: 1,
      endLine: 6,
    });

    // R12.1 — local repo should complete well under 10 s
    expect(result.buildDurationMs).toBeLessThan(10_000);
  });
});
