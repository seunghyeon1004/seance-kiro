/**
 * first-seance T9 — the shipped recordings (design.md §12.1, R7.1, R7.2, N7).
 *
 * Runs against the files in recordings/ exactly as the human's recording run wrote them. Both
 * samples are built with their real scripts into temp dirs, and the real buildLedger reads them
 * with real git. No model is called: the recordings are only read, and the live ward
 * (verify, verifyPlanClaims) checks them against the fresh ledgers.
 *
 * When this fails after a change to make-crypt.sh or make-possessed.sh, record again
 * (recordings/README.md). Never edit a recording by hand.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLedger } from '../src/evidence/ledger.js';
import { verifyPlanClaims } from '../src/exorcism/plan.js';
import { MODEL_ID } from '../src/ghost/llm.js';
import { verify } from '../src/ghost/verifier.js';
import { verify as verifyR11_4 } from './ghost/pbt/verifier-r11-4.js';
import {
  RecordingSchema,
  SAMPLE_NAMES,
  SAMPLE_RANGES,
  loadRecording,
  recordingKey,
} from '../src/ghost/recordings.js';
import type { SampleName } from '../src/ghost/recordings.js';
import type { LedgerResult } from '../src/ghost/schema.js';
import { recordingTargets } from '../scripts/record-answers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED = path.join(ROOT, 'recordings');

let tmp: string;
const ledgers = {} as Record<SampleName, LedgerResult>;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-shipped-recordings-'));
  for (const sample of SAMPLE_NAMES) {
    const dir = path.join(tmp, sample);
    execFileSync('bash', [path.join(ROOT, `scripts/make-${sample}.sh`), dir], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    ledgers[sample] = await buildLedger({ repoUrl: dir, ...SAMPLE_RANGES[sample] });
  }
}, 120_000);

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const targets = recordingTargets();

describe('shipped recordings (T9)', () => {
  it('there are exactly eight targets, and recordings/ holds one file per target and nothing else', () => {
    expect(targets).toHaveLength(8);
    const expected = targets.map((t) => `${recordingKey(t)}.json`).sort();
    const shipped = fs
      .readdirSync(SHIPPED)
      .filter((f) => f.endsWith('.json'))
      .sort();
    expect(shipped).toEqual(expected);
  });

  for (const t of targets) {
    const key = recordingKey(t);
    const label = `${key} ${t.kind} ${t.sample}${t.question ? ` "${t.question}"` : ''}`;

    describe(label, () => {
      it('parses, matches its key, names MODEL_ID and saw the freshly built ledger', () => {
        const raw = fs.readFileSync(path.join(SHIPPED, `${key}.json`), 'utf8');
        const rec = RecordingSchema.parse(JSON.parse(raw));
        expect({
          kind: rec.kind,
          sample: rec.sample,
          file: rec.file,
          startLine: rec.startLine,
          endLine: rec.endLine,
          question: rec.question,
        }).toEqual({
          kind: t.kind,
          sample: t.sample,
          file: t.file,
          startLine: t.startLine,
          endLine: t.endLine,
          question: t.question,
        });
        expect(rec.model).toBe(MODEL_ID);
        expect(rec.ledgerShas).toEqual(ledgers[t.sample].items.map((i) => i.shortSha));
        // The server's own loader accepts it from the default directory.
        expect(loadRecording(t, SHIPPED)).toEqual(rec);
      });

      it('the live ward keeps at least one of its claims or steps', () => {
        const rec = loadRecording(t, SHIPPED);
        if (rec === null) throw new Error(`recording ${key} is missing or invalid`);
        const ledger = ledgers[t.sample];
        if (rec.kind === 'ask') {
          const result = verify(ledger.items, rec.answer);
          expect(result.verified.length).toBeGreaterThanOrEqual(1);
        } else {
          const plan = verifyPlanClaims(ledger, rec.plan);
          expect(plan.steps.length).toBeGreaterThanOrEqual(1);
        }
      });

      it('ward-hardening R12.5: every claim lands in the same bucket, with the same reason, as under the R11.4 ward', () => {
        const rec = loadRecording(t, SHIPPED);
        if (rec === null) throw new Error(`recording ${key} is missing or invalid`);
        const items = ledgers[t.sample].items;
        const claimSets =
          rec.kind === 'ask'
            ? [rec.answer.claims]
            : [
                ...rec.plan.steps.map((s) => s.claims),
                ...rec.plan.doNotTouchList.map((d) => d.claims),
              ];
        expect(claimSets.length).toBeGreaterThan(0);
        for (const claims of claimSets) {
          const now = verify(items, { claims });
          const before = verifyR11_4(items, { claims });
          expect(now).toEqual(before);
        }
      });
    });
  }
});
