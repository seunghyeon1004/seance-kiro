/**
 * Records the canonical exorcism plan fixture from a REAL model call.
 * Builds the sample crypt, takes the ledger for legacy/tax.js line 7, scores it at a
 * fixed time, and saves the model's raw refactor_plan tool input under
 * test/fixtures/exorcism-plans/<promptHash>.json.
 *
 *   ANTHROPIC_API_KEY=... npx tsx scripts/record-plan-fixture.ts          # record the plan
 *   ANTHROPIC_API_KEY=... npx tsx scripts/record-plan-fixture.ts --ghost  # record a ghost answer
 *   add --hash-only to either to print the prompt hash without a model call
 *
 * The --ghost mode records test/fixtures/ghost-answers/<promptHash>.json for FIXTURE_QUESTION
 * on the same ledger (buildPrompt with FIXTURE_SESSION_ID).
 *
 * Files are keyed by promptHash({ system, user }) from src/ghost/llm.ts (ward-hardening R5.7).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLedger } from '../src/evidence/ledger.js';
import { computeScore } from '../src/exorcism/score.js';
import { buildPlanPrompt } from '../src/exorcism/plan.js';
import { askGhost, askPlan, promptHash } from '../src/ghost/llm.js';
import { buildPrompt } from '../src/ghost/persona.js';

export const FIXTURE_NOW_MS = Date.UTC(2026, 10, 9, 0, 0, 0);
export const FIXTURE_INPUT = { authorGoneThresholdDays: 365, nowMs: FIXTURE_NOW_MS };
export const FIXTURE_RANGE = { file: 'legacy/tax.js', startLine: 7, endLine: 7 };
export const FIXTURE_QUESTION =
  'Why does taxFor wait 3 seconds before calling the vendor?';
export const FIXTURE_SESSION_ID = 'fixture-session';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-crypt-'));
  try {
    execFileSync('bash', [path.join(root, 'scripts/make-crypt.sh'), dir], {
      stdio: 'ignore',
    });
    const ledger = await buildLedger({ repoUrl: dir, ...FIXTURE_RANGE });
    const ghost = process.argv.includes('--ghost');
    const scored = computeScore(ledger, FIXTURE_INPUT, FIXTURE_NOW_MS);
    const prompt = ghost
      ? buildPrompt(ledger.items, FIXTURE_QUESTION, FIXTURE_SESSION_ID)
      : buildPlanPrompt(ledger, scored);
    const hash = promptHash(prompt);
    console.log(
      `prompt hash ${hash}, score ${scored.score}, ledger ${ledger.items.length} items`,
    );
    if (process.argv.includes('--hash-only')) return;
    // Plan mode writes the raw refactor_plan tool input (validated by RefactorPlanSchema)
    const answer = ghost
      ? await askGhost(prompt, FIXTURE_SESSION_ID)
      : await askPlan(prompt);
    const dirName = ghost ? 'ghost-answers' : 'exorcism-plans';
    const out = path.join(root, 'test/fixtures', dirName, `${hash}.json`);
    fs.writeFileSync(out, JSON.stringify(answer, null, 2) + '\n');
    console.log(`wrote ${path.relative(root, out)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
