/**
 * exorcism-plan T7: the canonical recorded plan fixture.
 *
 * test/fixtures/exorcism-plans/5de303db.json was recorded from a real model call by
 * scripts/record-plan-fixture.ts (sample crypt, legacy/tax.js line 7, scored at a fixed time).
 * These tests rebuild the same ledger with real git, check the fixture's shape, and run
 * buildPlan in fixture mode (ANTHROPIC_FIXTURE=1) through the real loader.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLedger } from '../../src/evidence/ledger.js';
import { computeScore } from '../../src/exorcism/score.js';
import { buildPlan, buildPlanPrompt } from '../../src/exorcism/plan.js';
import { GhostAnswerSchema, RefactorPlanSchema } from '../../src/ghost/schema.js';
import type { LedgerResult, ScoredResult } from '../../src/ghost/schema.js';
import {
  FIXTURE_INPUT,
  FIXTURE_NOW_MS,
  FIXTURE_RANGE,
} from '../../scripts/record-plan-fixture.js';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/exorcism-plans');
let dir: string;
let ledger: LedgerResult;
let scored: ScoredResult;
let hash: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-crypt-'));
  execFileSync('bash', [path.resolve(__dirname, '../../scripts/make-crypt.sh'), dir], {
    stdio: 'ignore',
  });
  ledger = await buildLedger({ repoUrl: dir, ...FIXTURE_RANGE });
  scored = computeScore(ledger, FIXTURE_INPUT, FIXTURE_NOW_MS);
  hash = createHash('sha256')
    .update(buildPlanPrompt(ledger, scored))
    .digest('hex')
    .slice(0, 8);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('canonical exorcism plan fixture (T7)', () => {
  it('exists under the prompt hash of the sample crypt ledger', () => {
    expect(hash).toBe('5de303db');
    expect(fs.existsSync(path.join(FIXTURE_DIR, `${hash}.json`))).toBe(true);
  });

  it('has the GhostAnswer shape with a RefactorPlan in its first claim, citing the ledger', () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, `${hash}.json`), 'utf8'),
    );
    const answer = GhostAnswerSchema.parse(raw);
    const plan = RefactorPlanSchema.parse(JSON.parse(answer.claims[0]!.text));
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan.doNotTouchList.length).toBeGreaterThanOrEqual(1);
    const shas = new Set(ledger.items.map((i) => i.shortSha));
    const dntShas = plan.doNotTouchList.flatMap((d) =>
      d.claims.flatMap((c) => c.citations.map((x) => x.sha7)),
    );
    expect(dntShas.some((s) => shas.has(s))).toBe(true);
  });

  it('buildPlan in fixture mode loads it through the real loader and the ward verifies it', async () => {
    const prev = process.env['ANTHROPIC_FIXTURE'];
    process.env['ANTHROPIC_FIXTURE'] = '1';
    try {
      const plan = await buildPlan(
        ledger,
        scored,
        '550e8400-e29b-41d4-a716-446655440000',
      );
      expect(plan.verifierScore).toBeGreaterThan(0);
      expect(plan.verifierScore).toBeLessThanOrEqual(1);
    } finally {
      if (prev === undefined) delete process.env['ANTHROPIC_FIXTURE'];
      else process.env['ANTHROPIC_FIXTURE'] = prev;
    }
  });
});
