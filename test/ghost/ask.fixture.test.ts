/**
 * ghost-verifier T10: end-to-end ghost path on the sample crypt with a recorded answer.
 *
 * test/fixtures/ghost-answers/b0b2564e.json was recorded from a real model call by
 * `scripts/record-plan-fixture.ts --ghost` (FIXTURE_QUESTION on legacy/tax.js line 7).
 * This test rebuilds the crypt with real git, then runs buildPrompt -> askGhost (fixture mode,
 * real loader) -> verify. It replaces test/ghost/ask.integration.ts, which pointed at a crypt
 * directory that did not exist and was not picked up by the vitest include pattern.
 *
 * ward-hardening T2/T8: fixtures are keyed by promptHash({ system, user }) (R5.7). The fixture
 * was recorded again with the { system, user } prompt layout.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLedger } from '../../src/evidence/ledger.js';
import { buildPrompt } from '../../src/ghost/persona.js';
import type { ModelPrompt } from '../../src/ghost/persona.js';
import { askGhost, promptHash } from '../../src/ghost/llm.js';
import { verify } from '../../src/ghost/verifier.js';
import type { LedgerResult } from '../../src/ghost/schema.js';
import {
  FIXTURE_QUESTION,
  FIXTURE_RANGE,
  FIXTURE_SESSION_ID,
} from '../../scripts/record-plan-fixture.js';

let dir: string;
let ledger: LedgerResult;
let prompt: ModelPrompt;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-crypt-'));
  execFileSync('bash', [path.resolve(__dirname, '../../scripts/make-crypt.sh'), dir], {
    stdio: 'ignore',
  });
  ledger = await buildLedger({ repoUrl: dir, ...FIXTURE_RANGE });
  prompt = buildPrompt(ledger.items, FIXTURE_QUESTION, FIXTURE_SESSION_ID);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('ghost on the sample crypt with a recorded answer (T10)', () => {
  it('the recorded fixture exists under the prompt hash', () => {
    const hash = promptHash(prompt);
    expect(hash).toBe('b0b2564e');
    expect(
      fs.existsSync(path.resolve(__dirname, `../fixtures/ghost-answers/${hash}.json`)),
    ).toBe(true);
  });

  it('askGhost in fixture mode + verify gives a valid result with verified claims', async () => {
    const prev = process.env['ANTHROPIC_FIXTURE'];
    process.env['ANTHROPIC_FIXTURE'] = '1';
    try {
      const answer = await askGhost(prompt, FIXTURE_SESSION_ID);
      const result = verify(ledger.items, answer);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.verified.length).toBeGreaterThanOrEqual(1);
      // ward-hardening R4.1: every claim lands in exactly one of the three buckets
      expect(result.verified.length + result.rejected.length + result.silent.length).toBe(
        answer.claims.length,
      );
      // R1.1: every verified claim carries one found quote per citation
      for (const v of result.verified) {
        expect(v.quotes).toHaveLength(v.claim.citations.length);
      }
    } finally {
      if (prev === undefined) delete process.env['ANTHROPIC_FIXTURE'];
      else process.env['ANTHROPIC_FIXTURE'] = prev;
    }
  });
});
