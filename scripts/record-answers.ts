/**
 * Records the answers the server falls back on when the model is unavailable
 * (first-seance design.md §6.4, R7.1, R7.2).
 *
 * A HUMAN WITH A REAL ANTHROPIC_API_KEY RUNS THIS SCRIPT. The files it writes come from real
 * model calls with the live prompt, and nobody edits them by hand: never edit a recording,
 * record it again instead. The server runs every recording through the live ward against the
 * current ledger before showing it, so a recording is never trusted as it stands.
 *
 *   ANTHROPIC_API_KEY=… npx tsx scripts/record-answers.ts   # write the eight files into recordings/
 *   npx tsx scripts/record-answers.ts --keys-only           # print the eight targets and keys, no model call
 *
 * RECORDINGS_DIR overrides the output directory. The command refuses to run without a key or
 * with ANTHROPIC_FIXTURE=1, because a fixture is not a model answer.
 *
 * For each sample it builds the repository with scripts/make-<sample>.sh into a temp dir, takes
 * the ledger for the sample's default range, asks each chip question with buildPrompt and
 * askGhost, asks for one plan with buildPlanPrompt and askPlan, and writes
 * <dir>/<recordingKey(target)>.json. These are the same prompt builders and model calls the
 * live server uses.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLedger } from '../src/evidence/ledger.js';
import { computeScore } from '../src/exorcism/score.js';
import { buildPlanPrompt, verifyPlanClaims } from '../src/exorcism/plan.js';
import { MODEL_ID, askGhost, askPlan } from '../src/ghost/llm.js';
import type { AnthropicClient } from '../src/ghost/llm.js';
import { buildPrompt } from '../src/ghost/persona.js';
import { verify } from '../src/ghost/verifier.js';
import {
  RecordingSchema,
  SAMPLE_NAMES,
  SAMPLE_QUESTIONS,
  SAMPLE_RANGES,
  recordingKey,
  recordingsDir,
} from '../src/ghost/recordings.js';
import type { Recording, RecordingTarget, SampleName } from '../src/ghost/recordings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The session id written into the recording prompts. */
const RECORDING_SESSION_ID = 'recording';

export const REFUSAL =
  'Recordings come from the real model: set ANTHROPIC_API_KEY and unset ANTHROPIC_FIXTURE.';

export interface RecordOptions {
  outDir: string;
  /** Tests inject a scripted client; the command line never does. */
  client?: AnthropicClient;
  /** Default SAMPLE_NAMES. */
  samples?: readonly SampleName[];
  /** Haunting score time for the plan prompt; default Date.now(). */
  nowMs?: number;
  log?: (line: string) => void;
}

/** The targets of the given samples, in order: each chip question, then the plan. */
export function recordingTargets(
  samples: readonly SampleName[] = SAMPLE_NAMES,
): RecordingTarget[] {
  return samples.flatMap((sample) => [
    ...SAMPLE_QUESTIONS[sample].map(
      (question): RecordingTarget => ({
        kind: 'ask',
        sample,
        ...SAMPLE_RANGES[sample],
        question,
      }),
    ),
    { kind: 'exorcise', sample, ...SAMPLE_RANGES[sample], question: '' },
  ]);
}

/** Builds each sample into a temp dir with its make script, then records every chip answer and one plan. Returns the written paths. */
export async function recordAnswers(opts: RecordOptions): Promise<string[]> {
  if (process.env['ANTHROPIC_FIXTURE'] === '1') {
    throw new Error(
      'record-answers: ANTHROPIC_FIXTURE=1 would record fixtures, not model answers',
    );
  }
  const log = opts.log ?? ((line: string) => console.log(line));
  const nowMs = opts.nowMs ?? Date.now();
  const written: string[] = [];

  for (const sample of opts.samples ?? SAMPLE_NAMES) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `seance-record-${sample}-`));
    try {
      const repo = path.join(tmp, sample);
      execFileSync('bash', [path.join(root, `scripts/make-${sample}.sh`), repo], {
        cwd: root,
        stdio: 'ignore',
      });
      const range = SAMPLE_RANGES[sample];
      const ledger = await buildLedger({ repoUrl: repo, ...range });
      const ledgerShas = ledger.items.map((i) => i.shortSha);

      for (const target of recordingTargets([sample])) {
        const base = {
          sample,
          file: target.file,
          startLine: target.startLine,
          endLine: target.endLine,
          question: target.question,
          model: MODEL_ID,
          recordedAt: new Date().toISOString(),
          ledgerShas,
        };
        let rec: Recording;
        let tally: string;
        if (target.kind === 'ask') {
          const answer = await askGhost(
            buildPrompt(ledger.items, target.question, RECORDING_SESSION_ID),
            RECORDING_SESSION_ID,
            opts.client,
          );
          rec = RecordingSchema.parse({ kind: 'ask', ...base, answer });
          const r = verify(ledger.items, answer);
          tally = `${r.verified.length} of ${r.verified.length + r.rejected.length} claims verified, ${r.silent.length} silent`;
        } else {
          const scored = computeScore(
            ledger,
            { authorGoneThresholdDays: 365, nowMs },
            nowMs,
          );
          const plan = await askPlan(buildPlanPrompt(ledger, scored), opts.client);
          rec = RecordingSchema.parse({ kind: 'exorcise', ...base, plan });
          tally = `plan score ${verifyPlanClaims(ledger, plan).verifierScore.toFixed(2)}`;
        }
        const key = recordingKey(target);
        const out = path.join(opts.outDir, `${key}.json`);
        fs.writeFileSync(out, JSON.stringify(rec, null, 2) + '\n');
        written.push(out);
        log(`${key}  ${describeTarget(target)}  (${tally})`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  return written;
}

function describeTarget(t: RecordingTarget): string {
  const where = `${t.sample} ${t.file}:${t.startLine}-${t.endLine}`;
  return t.kind === 'ask' ? `ask ${where} "${t.question}"` : `exorcise ${where}`;
}

async function main(): Promise<void> {
  if (process.argv.includes('--keys-only')) {
    for (const t of recordingTargets())
      console.log(`${recordingKey(t)}  ${describeTarget(t)}`);
    return;
  }
  const key = process.env['ANTHROPIC_API_KEY'];
  if (!key || key.trim() === '' || process.env['ANTHROPIC_FIXTURE'] === '1') {
    console.error(REFUSAL);
    process.exitCode = 1;
    return;
  }
  const outDir = recordingsDir();
  fs.mkdirSync(outDir, { recursive: true });
  const written = await recordAnswers({ outDir });
  console.log(
    `wrote ${written.length} recordings into ${path.relative(root, outDir) || '.'}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
