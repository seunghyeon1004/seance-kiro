/**
 * recordings.ts — recorded answers for the two samples (first-seance design.md §6, R7).
 *
 * When the live model is unavailable, the server may answer a sample's chip question with an
 * answer recorded earlier from a real model call. The recording is never trusted: the server
 * runs it through the live ward against the current ledger, exactly as a live answer (R7.6).
 *
 * Only scripts/record-answers.ts writes the files, run by a human with a real key (R7.2).
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { GhostAnswerWireSchema, RefactorPlanSchema } from './schema.js';

// ---------------------------------------------------------------------------
// Constants (design.md §6.1)
// ---------------------------------------------------------------------------

export const SAMPLE_RANGES = {
  crypt: { file: 'legacy/tax.js', startLine: 7, endLine: 7 },
  possessed: { file: 'auth/throttle.js', startLine: 4, endLine: 4 },
} as const;
export type SampleName = keyof typeof SAMPLE_RANGES;
export const SAMPLE_NAMES: readonly SampleName[] = ['crypt', 'possessed'];

/** The chip questions of R3.2; app.js holds the same lists (checked by a test, §12.1). */
export const SAMPLE_QUESTIONS: Readonly<Record<SampleName, readonly string[]>> = {
  crypt: [
    'Why is there a three second wait here?',
    'Who touched this line last, and why?',
    'Is it safe to delete the wait?',
  ],
  possessed: ['Can I delete this wait?', 'Why does the wait exist?', 'Who changed this?'],
};
export const OTHER_QUESTIONS: readonly string[] = [
  'Why does this line exist?',
  'What would break if I removed it?',
];

// ---------------------------------------------------------------------------
// Key and format (design.md §6.2)
// ---------------------------------------------------------------------------

export interface RecordingTarget {
  readonly kind: 'ask' | 'exorcise';
  readonly sample: SampleName;
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
  /** '' for 'exorcise' */
  readonly question: string;
}

/** sha256(JSON.stringify([kind, sample, file, startLine, endLine, question])), first 16 hex characters. */
export function recordingKey(t: RecordingTarget): string {
  return createHash('sha256')
    .update(
      JSON.stringify([t.kind, t.sample, t.file, t.startLine, t.endLine, t.question]),
    )
    .digest('hex')
    .slice(0, 16);
}

const RecordingBaseSchema = z.object({
  sample: z.enum(['crypt', 'possessed']),
  file: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  question: z.string(),
  /** MODEL_ID at recording time */
  model: z.string().min(1),
  recordedAt: z.string().datetime(),
  /** The ledger the model saw */
  ledgerShas: z.array(z.string().regex(/^[0-9a-f]{7}$/)),
});

/** The answer is the raw ghost_answer tool input and the plan the raw refactor_plan input; the ward checks the claims. */
export const RecordingSchema = z.discriminatedUnion('kind', [
  RecordingBaseSchema.extend({ kind: z.literal('ask'), answer: GhostAnswerWireSchema }),
  RecordingBaseSchema.extend({ kind: z.literal('exorcise'), plan: RefactorPlanSchema }),
]);
export type Recording = z.infer<typeof RecordingSchema>;
export type AskRecording = Extract<Recording, { kind: 'ask' }>;
export type ExorciseRecording = Extract<Recording, { kind: 'exorcise' }>;

// ---------------------------------------------------------------------------
// Lookup (design.md §6.3)
// ---------------------------------------------------------------------------

// src/ghost/recordings.ts → ../.. = project root
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** RECORDINGS_DIR, or <repo root>/recordings. Read per call. */
export function recordingsDir(): string {
  return process.env['RECORDINGS_DIR'] ?? path.join(ROOT, 'recordings');
}

/**
 * A target only for a sample session with that sample's default range, and (for 'ask') a question
 * in SAMPLE_QUESTIONS[sample]. Otherwise null (R7.8).
 */
export function recordingTargetFor(
  entry: { sample?: SampleName; file?: string; startLine?: number; endLine?: number },
  kind: 'ask' | 'exorcise',
  question: unknown,
): RecordingTarget | null {
  const sample = entry.sample;
  if (sample === undefined || !SAMPLE_NAMES.includes(sample)) return null;
  const d = SAMPLE_RANGES[sample];
  if (
    entry.file !== d.file ||
    entry.startLine !== d.startLine ||
    entry.endLine !== d.endLine
  ) {
    return null;
  }
  if (kind === 'exorcise') {
    return {
      kind,
      sample,
      file: d.file,
      startLine: d.startLine,
      endLine: d.endLine,
      question: '',
    };
  }
  if (typeof question !== 'string' || !SAMPLE_QUESTIONS[sample].includes(question))
    return null;
  return {
    kind,
    sample,
    file: d.file,
    startLine: d.startLine,
    endLine: d.endLine,
    question,
  };
}

/**
 * Reads <dir>/<recordingKey(t)>.json. Missing: null. Invalid JSON, a RecordingSchema failure, or
 * target fields that differ from `t`: console.warn and null (R7.9). Synchronous: the files are small.
 */
export function loadRecording(
  t: RecordingTarget,
  dir: string = recordingsDir(),
): Recording | null {
  const file = path.join(dir, `${recordingKey(t)}.json`);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as { code?: unknown }).code !== 'ENOENT') {
      console.warn('[seance] recording unreadable, ignored', { file });
    }
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    console.warn('[seance] recording is not valid JSON, ignored', { file });
    return null;
  }
  const parsed = RecordingSchema.safeParse(json);
  if (!parsed.success) {
    console.warn('[seance] recording fails RecordingSchema, ignored', { file });
    return null;
  }
  const r = parsed.data;
  if (
    r.kind !== t.kind ||
    r.sample !== t.sample ||
    r.file !== t.file ||
    r.startLine !== t.startLine ||
    r.endLine !== t.endLine ||
    r.question !== t.question
  ) {
    console.warn('[seance] recording does not match its key, ignored', { file });
    return null;
  }
  return r;
}
