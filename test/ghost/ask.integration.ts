/**
 * T10 — Integration smoke test for the full ghost pipeline.
 *
 * Skipped unless INTEGRATION=1 (set in environment).
 * Uses ANTHROPIC_FIXTURE=1 to avoid real LLM calls.
 *
 * Path exercised:
 *   buildLedger (crypt fixture) → buildPrompt → askGhost (fixture mode) → verify
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLedger } from '../../src/evidence/ledger.js';
import { buildPrompt } from '../../src/ghost/persona.js';
import { askGhost } from '../../src/ghost/llm.js';
import { verify } from '../../src/ghost/verifier.js';
import type { GhostAnswer } from '../../src/ghost/schema.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dir, '../fixtures/ghost-answers');
const CRYPT_REPO = join(__dir, '../fixtures/crypt');
const QUESTION = 'Why is there a hardcoded 3000ms delay in hauntedSleep?';
const SESSION_ID = 'integration-test-session';

const SKIP = process.env['INTEGRATION'] !== '1';

describe('Integration: full ghost pipeline', () => {
  let promptHash = '';

  beforeAll(async () => {
    if (SKIP) return;

    // Build ledger from the crypt fixture repo
    const ledger = await buildLedger({
      repoUrl: CRYPT_REPO,
      file: 'haunted.ts',
      startLine: 1,
      endLine: 5,
    });

    // Compute the prompt hash so we can create the fixture file
    const prompt = buildPrompt(ledger.items, QUESTION, SESSION_ID);
    promptHash = createHash('sha256').update(prompt).digest('hex').slice(0, 8);

    // Ensure fixture exists — create a canonical one if missing
    await mkdir(FIXTURE_DIR, { recursive: true });
    const fixturePath = join(FIXTURE_DIR, `${promptHash}.json`);

    const canonicalAnswer: GhostAnswer = {
      claims: [
        {
          kind: 'silence',
          text: 'The record is silent on the exact reason for 3000ms.',
          citations: [],
          silenceReason:
            'The commit messages do not explicitly state why 3000ms was chosen.',
        },
      ],
      voice: 'The ghost of the crypt fixture author',
      sessionId: SESSION_ID,
    };

    // Write fixture (idempotent)
    await writeFile(fixturePath, JSON.stringify(canonicalAnswer, null, 2));
  });

  it.skipIf(SKIP)(
    'produces a valid VerifierResult with score in [0, 1] and at least one verified claim',
    async () => {
      process.env['ANTHROPIC_FIXTURE'] = '1';

      const ledger = await buildLedger({
        repoUrl: CRYPT_REPO,
        file: 'haunted.ts',
        startLine: 1,
        endLine: 5,
      });

      const prompt = buildPrompt(ledger.items, QUESTION, SESSION_ID);
      const ghostAnswer = await askGhost(prompt, SESSION_ID);
      const result = verify(ledger.items, ghostAnswer);

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.verified.length).toBeGreaterThanOrEqual(1);

      delete process.env['ANTHROPIC_FIXTURE'];
    },
  );
});
