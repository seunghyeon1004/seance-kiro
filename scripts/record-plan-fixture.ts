/**
 * Records the canonical exorcism plan fixture from a REAL model call.
 * Builds the sample crypt, takes the ledger for legacy/tax.js line 7, scores it at a
 * fixed time, and saves the model's plan answer under test/fixtures/exorcism-plans/<hash>.json.
 *
 *   ANTHROPIC_API_KEY=... npx tsx scripts/record-plan-fixture.ts          # record
 *   npx tsx scripts/record-plan-fixture.ts --hash-only                    # print the hash only
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLedger } from '../src/evidence/ledger.js';
import { computeScore } from '../src/exorcism/score.js';
import { buildPlanPrompt } from '../src/exorcism/plan.js';
import { askGhost } from '../src/ghost/llm.js';

export const FIXTURE_NOW_MS = Date.UTC(2026, 10, 9, 0, 0, 0);
export const FIXTURE_INPUT = { authorGoneThresholdDays: 365, nowMs: FIXTURE_NOW_MS };
export const FIXTURE_RANGE = { file: 'legacy/tax.js', startLine: 7, endLine: 7 };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-crypt-'));
  try {
    execFileSync('bash', [path.join(root, 'scripts/make-crypt.sh'), dir], {
      stdio: 'ignore',
    });
    const ledger = await buildLedger({ repoUrl: dir, ...FIXTURE_RANGE });
    const scored = computeScore(ledger, FIXTURE_INPUT, FIXTURE_NOW_MS);
    const prompt = buildPlanPrompt(ledger, scored);
    const hash = createHash('sha256').update(prompt).digest('hex').slice(0, 8);
    console.log(
      `prompt hash ${hash}, score ${scored.score}, ledger ${ledger.items.length} items`,
    );
    if (process.argv.includes('--hash-only')) return;
    const answer = await askGhost(prompt, 'fixture-session', undefined, {
      tool: 'refactor_plan',
    });
    const out = path.join(root, 'test/fixtures/exorcism-plans', `${hash}.json`);
    fs.writeFileSync(out, JSON.stringify(answer, null, 2) + '\n');
    console.log(`wrote ${path.relative(root, out)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
