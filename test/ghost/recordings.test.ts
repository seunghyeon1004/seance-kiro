/**
 * first-seance T3 — recorded answers: eligibility, loading and the recording script
 * (R7.1, R7.2, R7.8, R7.9).
 *
 * recordAnswers runs with a scripted client (CryptClient) into a temp dir; no test calls the
 * model or the network (N7). The command line is run with `npx tsx` and no key.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OTHER_QUESTIONS,
  RecordingSchema,
  SAMPLE_NAMES,
  SAMPLE_QUESTIONS,
  SAMPLE_RANGES,
  loadRecording,
  recordingKey,
  recordingTargetFor,
} from '../../src/ghost/recordings.js';
import type { RecordingTarget, SampleName } from '../../src/ghost/recordings.js';
import { MODEL_ID } from '../../src/ghost/llm.js';
import { buildLedger } from '../../src/evidence/ledger.js';
import { recordAnswers } from '../../scripts/record-answers.js';
import { CryptClient } from './scripted-clients.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-rec-'));

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function freshDir(name: string): string {
  const d = path.join(TMP, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function defaultEntry(sample: SampleName): {
  sample: SampleName;
  file: string;
  startLine: number;
  endLine: number;
} {
  return { sample, ...SAMPLE_RANGES[sample] };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('the sample questions and ranges (design.md §6.1)', () => {
  it('match R3.2 exactly', () => {
    expect(SAMPLE_NAMES).toEqual(['crypt', 'possessed']);
    expect(SAMPLE_RANGES).toEqual({
      crypt: { file: 'legacy/tax.js', startLine: 7, endLine: 7 },
      possessed: { file: 'auth/throttle.js', startLine: 4, endLine: 4 },
    });
    expect(SAMPLE_QUESTIONS).toEqual({
      crypt: [
        'Why is there a three second wait here?',
        'Who touched this line last, and why?',
        'Is it safe to delete the wait?',
      ],
      possessed: [
        'Can I delete this wait?',
        'Why does the wait exist?',
        'Who changed this?',
      ],
    });
    expect(OTHER_QUESTIONS).toEqual([
      'Why does this line exist?',
      'What would break if I removed it?',
    ]);
  });
});

// ---------------------------------------------------------------------------
// recordingTargetFor (R7.8)
// ---------------------------------------------------------------------------

describe('recordingTargetFor (R7.8)', () => {
  for (const sample of SAMPLE_NAMES) {
    for (const question of SAMPLE_QUESTIONS[sample]) {
      it(`${sample}: "${question}" has an ask target`, () => {
        expect(recordingTargetFor(defaultEntry(sample), 'ask', question)).toEqual({
          kind: 'ask',
          sample,
          ...SAMPLE_RANGES[sample],
          question,
        });
      });
    }
    it(`${sample}: the exorcism has a target with an empty question`, () => {
      expect(recordingTargetFor(defaultEntry(sample), 'exorcise', 'ignored')).toEqual({
        kind: 'exorcise',
        sample,
        ...SAMPLE_RANGES[sample],
        question: '',
      });
    });
  }

  it('null for another file, range, question or repository', () => {
    const crypt = defaultEntry('crypt');
    const q = SAMPLE_QUESTIONS.crypt[0];
    expect(recordingTargetFor({ ...crypt, file: 'legacy/invoice.js' }, 'ask', q)).toBe(
      null,
    );
    expect(recordingTargetFor({ ...crypt, startLine: 6 }, 'ask', q)).toBe(null);
    expect(recordingTargetFor({ ...crypt, endLine: 8 }, 'ask', q)).toBe(null);
    expect(recordingTargetFor({ ...crypt, startLine: 6 }, 'exorcise', '')).toBe(null);
    expect(recordingTargetFor(crypt, 'ask', 'Why is the sky blue?')).toBe(null);
    expect(recordingTargetFor(crypt, 'ask', OTHER_QUESTIONS[0])).toBe(null);
    // a possessed question on crypt, and the other way round
    expect(recordingTargetFor(crypt, 'ask', SAMPLE_QUESTIONS.possessed[0])).toBe(null);
    expect(
      recordingTargetFor(defaultEntry('possessed'), 'ask', SAMPLE_QUESTIONS.crypt[0]),
    ).toBe(null);
    // the question must match exactly
    expect(recordingTargetFor(crypt, 'ask', ` ${q}`)).toBe(null);
    expect(recordingTargetFor(crypt, 'ask', q?.toLowerCase())).toBe(null);
    expect(recordingTargetFor(crypt, 'ask', 42)).toBe(null);
    expect(recordingTargetFor(crypt, 'ask', undefined)).toBe(null);
    // a GitHub or local session has no sample, even with the same file and range
    const { sample: _drop, ...noSample } = crypt;
    expect(recordingTargetFor(noSample, 'ask', q)).toBe(null);
    expect(recordingTargetFor(noSample, 'exorcise', '')).toBe(null);
    expect(recordingTargetFor({}, 'exorcise', '')).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// recordingKey (R7.1)
// ---------------------------------------------------------------------------

describe('recordingKey (R7.1)', () => {
  it('is the first 16 hex characters of sha256 over the six fields', async () => {
    const { createHash } = await import('node:crypto');
    const t: RecordingTarget = {
      kind: 'ask',
      sample: 'crypt',
      ...SAMPLE_RANGES.crypt,
      question: 'Why is there a three second wait here?',
    };
    const expected = createHash('sha256')
      .update(
        JSON.stringify([t.kind, t.sample, t.file, t.startLine, t.endLine, t.question]),
      )
      .digest('hex')
      .slice(0, 16);
    expect(recordingKey(t)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// loadRecording (R7.9)
// ---------------------------------------------------------------------------

const TARGET: RecordingTarget = {
  kind: 'ask',
  sample: 'crypt',
  ...SAMPLE_RANGES.crypt,
  question: 'Why is there a three second wait here?',
};

function validRecording(t: RecordingTarget = TARGET): Record<string, unknown> {
  return {
    kind: t.kind,
    sample: t.sample,
    file: t.file,
    startLine: t.startLine,
    endLine: t.endLine,
    question: t.question,
    model: MODEL_ID,
    recordedAt: '2026-11-11T12:00:00.000Z',
    ledgerShas: ['abc1234'],
    answer: {
      voice: 'v',
      sessionId: 'recording',
      claims: [{ kind: 'memory', text: 'x', citations: [{ sha7: 'abc1234' }] }],
    },
  };
}

describe('loadRecording (R7.9)', () => {
  it('reads a valid file named by the key', () => {
    const dir = freshDir('load-valid');
    fs.writeFileSync(
      path.join(dir, `${recordingKey(TARGET)}.json`),
      JSON.stringify(validRecording()),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rec = loadRecording(TARGET, dir);
    expect(rec?.kind).toBe('ask');
    expect(rec?.question).toBe(TARGET.question);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads RECORDINGS_DIR per call when no dir is given', () => {
    const dir = freshDir('load-env');
    fs.writeFileSync(
      path.join(dir, `${recordingKey(TARGET)}.json`),
      JSON.stringify(validRecording()),
    );
    const before = process.env['RECORDINGS_DIR'];
    try {
      process.env['RECORDINGS_DIR'] = dir;
      expect(loadRecording(TARGET)?.kind).toBe('ask');
      process.env['RECORDINGS_DIR'] = freshDir('load-env-empty');
      expect(loadRecording(TARGET)).toBe(null);
    } finally {
      if (before === undefined) delete process.env['RECORDINGS_DIR'];
      else process.env['RECORDINGS_DIR'] = before;
    }
  });

  it('a missing file gives null without a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(loadRecording(TARGET, freshDir('load-missing'))).toBe(null);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid JSON', () => '{ not json'],
    [
      'a schema failure (no answer)',
      () => {
        const { answer: _a, ...rest } = validRecording();
        return JSON.stringify(rest);
      },
    ],
    [
      'a schema failure (a bad ledger hash)',
      () => JSON.stringify({ ...validRecording(), ledgerShas: ['XYZ'] }),
    ],
    [
      'a schema failure (an answer envelope with no claims)',
      () =>
        JSON.stringify({
          ...validRecording(),
          answer: { voice: 'v', sessionId: 's', claims: [] },
        }),
    ],
    [
      'target fields that differ from the key (another question)',
      () =>
        JSON.stringify(
          validRecording({ ...TARGET, question: 'Is it safe to delete the wait?' }),
        ),
    ],
    [
      'target fields that differ from the key (another range)',
      () => JSON.stringify(validRecording({ ...TARGET, startLine: 6 })),
    ],
    [
      'target fields that differ from the key (another kind)',
      () =>
        JSON.stringify({
          ...validRecording(),
          kind: 'exorcise',
          answer: undefined,
          plan: {
            characterizationTests: ['t'],
            steps: [{ description: 'd', rationale: 'r', claims: [{}], reversible: true }],
            doNotTouchList: [],
            summary: 's',
          },
        }),
    ],
  ])('%s gives null and a console.warn', (_name, content) => {
    const dir = freshDir(`load-bad-${Math.random().toString(16).slice(2)}`);
    fs.writeFileSync(path.join(dir, `${recordingKey(TARGET)}.json`), content());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(loadRecording(TARGET, dir)).toBe(null);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// recordAnswers with a scripted client (R7.1)
// ---------------------------------------------------------------------------

function allTargets(): RecordingTarget[] {
  return SAMPLE_NAMES.flatMap((sample) => [
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

describe('recordAnswers (R7.1)', { timeout: 60_000 }, () => {
  const out = path.join(TMP, 'recorded');
  let written: string[] = [];
  let client: CryptClient;
  const shas: Partial<Record<SampleName, string[]>> = {};

  beforeAll(async () => {
    fs.mkdirSync(out);
    process.env['ANTHROPIC_API_KEY'] = 'test-dummy-key-not-a-secret';
    delete process.env['ANTHROPIC_FIXTURE'];
    client = new CryptClient();
    try {
      written = await recordAnswers({ outDir: out, client, log: () => undefined });
    } finally {
      delete process.env['ANTHROPIC_API_KEY'];
    }
    // The sample ledgers, built independently with the same scripts
    for (const sample of SAMPLE_NAMES) {
      const dir = path.join(TMP, `ledger-${sample}`);
      execFileSync('bash', [path.join(ROOT, `scripts/make-${sample}.sh`), dir], {
        cwd: ROOT,
      });
      const ledger = await buildLedger({ repoUrl: dir, ...SAMPLE_RANGES[sample] });
      shas[sample] = ledger.items.map((i) => i.shortSha);
    }
  }, 60_000);

  it('writes exactly eight files, named by recordingKey', () => {
    const expected = allTargets().map((t) => `${recordingKey(t)}.json`);
    expect(new Set(expected).size).toBe(8);
    expect(fs.readdirSync(out).sort()).toEqual([...expected].sort());
    expect(written.map((p) => path.basename(p)).sort()).toEqual([...expected].sort());
    expect(written.every((p) => path.dirname(p) === out)).toBe(true);
  });

  it('each file is valid, matches its target, names MODEL_ID and the ledger it saw', () => {
    for (const t of allTargets()) {
      const raw = fs.readFileSync(path.join(out, `${recordingKey(t)}.json`), 'utf8');
      expect(raw.endsWith('}\n')).toBe(true);
      const rec = RecordingSchema.parse(JSON.parse(raw));
      expect([
        rec.kind,
        rec.sample,
        rec.file,
        rec.startLine,
        rec.endLine,
        rec.question,
      ]).toEqual([t.kind, t.sample, t.file, t.startLine, t.endLine, t.question]);
      expect(rec.model).toBe(MODEL_ID);
      expect(rec.ledgerShas).toEqual(shas[t.sample]);
      expect(rec.ledgerShas.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(rec.recordedAt))).toBe(false);
      if (rec.kind === 'ask') {
        expect(rec.answer.claims).toHaveLength(2);
      } else {
        expect(rec.plan.steps).toHaveLength(1);
      }
      // loadRecording accepts what the script wrote
      expect(loadRecording(t, out)).toEqual(rec);
    }
  });

  it('made one model call per target, with the live prompt for each question', () => {
    expect(client.calls).toHaveLength(8);
    const asked = client.calls
      .filter((p) => p.tools[0]?.name === 'ghost_answer')
      .map(
        (p) => /<question>([\s\S]*)<\/question>/.exec(p.messages[0]?.content ?? '')?.[1],
      );
    expect(asked).toEqual([...SAMPLE_QUESTIONS.crypt, ...SAMPLE_QUESTIONS.possessed]);
    expect(client.calls.filter((p) => p.tools[0]?.name === 'refactor_plan')).toHaveLength(
      2,
    );
  });

  it('refuses fixture mode, so a fixture can never become a recording', async () => {
    const dir = freshDir('fixture-mode');
    process.env['ANTHROPIC_FIXTURE'] = '1';
    try {
      await expect(
        recordAnswers({ outDir: dir, client: new CryptClient(), log: () => undefined }),
      ).rejects.toThrow(/ANTHROPIC_FIXTURE/);
    } finally {
      delete process.env['ANTHROPIC_FIXTURE'];
    }
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The command line (R7.2)
// ---------------------------------------------------------------------------

const REFUSAL =
  'Recordings come from the real model: set ANTHROPIC_API_KEY and unset ANTHROPIC_FIXTURE.';

function runCli(
  args: string[],
  env: Record<string, string | undefined>,
): { status: number | null; stdout: string; stderr: string } {
  const base: Record<string, string | undefined> = { ...process.env };
  delete base['ANTHROPIC_API_KEY'];
  delete base['ANTHROPIC_FIXTURE'];
  const r = spawnSync('npx', ['tsx', 'scripts/record-answers.ts', ...args], {
    cwd: ROOT,
    env: { ...base, ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe(
  'scripts/record-answers.ts on the command line (R7.2)',
  { timeout: 90_000 },
  () => {
    it('with no key: exits 1 with the message and writes nothing', () => {
      const dir = freshDir('cli-nokey');
      const r = runCli([], { RECORDINGS_DIR: dir });
      expect(r.status).toBe(1);
      expect(r.stderr.trim()).toBe(REFUSAL);
      expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('with a blank key, or a key and ANTHROPIC_FIXTURE=1: exits 1 and writes nothing', () => {
      const dir = freshDir('cli-fixture');
      for (const env of [
        { ANTHROPIC_API_KEY: '   ' },
        { ANTHROPIC_API_KEY: 'test-dummy-key-not-a-secret', ANTHROPIC_FIXTURE: '1' },
      ]) {
        const r = runCli([], { RECORDINGS_DIR: dir, ...env });
        expect(r.status).toBe(1);
        expect(r.stderr.trim()).toBe(REFUSAL);
      }
      expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('--keys-only prints the eight keys without a model call or a key', () => {
      const dir = freshDir('cli-keys');
      const r = runCli(['--keys-only'], { RECORDINGS_DIR: dir });
      expect(r.status).toBe(0);
      const keys = [...r.stdout.matchAll(/\b([0-9a-f]{16})\b/g)].map((m) => m[1]);
      expect(keys).toEqual(allTargets().map(recordingKey));
      expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('the header says a human with a real key runs it and never edits the output', () => {
      const src = fs.readFileSync(path.join(ROOT, 'scripts/record-answers.ts'), 'utf8');
      const header = src.slice(0, src.indexOf('*/'));
      expect(header).toMatch(/human/i);
      expect(header).toMatch(/real (ANTHROPIC_API_KEY|key)/i);
      expect(header).toMatch(/never edit/i);
    });
  },
);
