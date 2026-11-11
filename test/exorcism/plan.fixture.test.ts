/**
 * exorcism-plan T7: the canonical recorded plan fixture.
 *
 * test/fixtures/exorcism-plans/464f2680.json was recorded from a real model call by
 * scripts/record-plan-fixture.ts (sample crypt, legacy/tax.js line 7, scored at a fixed time).
 * These tests rebuild the same ledger with real git, check the fixture's shape, and run
 * buildPlan in fixture mode (ANTHROPIC_FIXTURE=1) through the real loader.
 *
 * ward-hardening T2: fixtures are keyed by promptHash({ system, user }) and a plan fixture
 * holds the raw refactor_plan tool input, with no answer envelope (R5.7, R7.7). The fixture
 * was recorded again with the { system, user } prompt layout (T8).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { buildLedger } from '../../src/evidence/ledger.js';
import { computeScore } from '../../src/exorcism/score.js';
import { buildPlan, buildPlanPrompt } from '../../src/exorcism/plan.js';
import { promptHash } from '../../src/ghost/llm.js';
import { RefactorPlanSchema } from '../../src/ghost/schema.js';
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
  hash = promptHash(buildPlanPrompt(ledger, scored));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const CitedClaimSchema = z.object({
  citations: z.array(z.object({ sha7: z.string() })),
});

describe('canonical exorcism plan fixture (T7)', () => {
  it('exists under the prompt hash of the sample crypt ledger', () => {
    expect(hash).toBe('464f2680');
    expect(fs.existsSync(path.join(FIXTURE_DIR, `${hash}.json`))).toBe(true);
  });

  it('holds the raw refactor_plan tool input, citing the ledger', () => {
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, `${hash}.json`), 'utf8'),
    );
    const plan = RefactorPlanSchema.parse(raw);
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan.doNotTouchList.length).toBeGreaterThanOrEqual(1);
    const shas = new Set(ledger.items.map((i) => i.shortSha));
    const dntShas = plan.doNotTouchList.flatMap((d) =>
      d.claims.flatMap((c) => CitedClaimSchema.parse(c).citations.map((x) => x.sha7)),
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
