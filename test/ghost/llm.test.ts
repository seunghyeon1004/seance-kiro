/**
 * T5 unit tests for src/ghost/llm.ts
 *
 * All tests run without hitting real Anthropic endpoints.
 * Fixture mode is tested by creating a known fixture file.
 * Injectable client tests verify error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askGhost } from '../../src/ghost/llm.js';
import type { AnthropicClient } from '../../src/ghost/llm.js';
import { ConfigError, ParseError } from '../../src/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dir, '../../test/fixtures/ghost-answers');

const VALID_GHOST_ANSWER = {
  claims: [
    {
      kind: 'memory',
      text: 'I added the sleep because the downstream service was not ready.',
      citations: [{ sha7: 'abc1234', quote: 'wait for downstream' }],
    },
  ],
  voice: 'Ada Lovelace, terse and precise',
  sessionId: 'test-session-001',
};

// A prompt whose hash we know ahead of time
const TEST_PROMPT = 'SEANCE_TEST_PROMPT_FOR_FIXTURE_HASH_1234567890';
const TEST_HASH = createHash('sha256').update(TEST_PROMPT).digest('hex').slice(0, 8);

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Ensure fixture dir exists
  await mkdir(FIXTURE_DIR, { recursive: true });

  // Create a known fixture with the right sessionId
  const fixture = { ...VALID_GHOST_ANSWER, sessionId: 'test-session-001' };
  await writeFile(join(FIXTURE_DIR, `${TEST_HASH}.json`), JSON.stringify(fixture));
});

afterEach(() => {
  // Restore environment variables
  delete process.env['ANTHROPIC_FIXTURE'];
  delete process.env['ANTHROPIC_API_KEY'];
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixture mode
// ---------------------------------------------------------------------------

describe('askGhost — fixture mode', () => {
  it('returns the canned answer from fixture file', async () => {
    process.env['ANTHROPIC_FIXTURE'] = '1';
    const result = await askGhost(TEST_PROMPT, 'test-session-001');
    expect(result.claims).toHaveLength(1);
    expect(result.voice).toBe('Ada Lovelace, terse and precise');
    expect(result.sessionId).toBe('test-session-001');
  });

  it('throws ParseError when fixture JSON fails GhostAnswerSchema validation', async () => {
    process.env['ANTHROPIC_FIXTURE'] = '1';
    // Write an invalid fixture
    const badHash = createHash('sha256').update('bad-prompt').digest('hex').slice(0, 8);
    await writeFile(
      join(FIXTURE_DIR, `${badHash}.json`),
      JSON.stringify({ claims: [], voice: '', sessionId: '' }),
    );

    await expect(askGhost('bad-prompt', 'sess')).rejects.toThrow(ParseError);
  });

  it('throws ParseError when fixture file does not exist', async () => {
    process.env['ANTHROPIC_FIXTURE'] = '1';
    const missingPrompt = 'this-prompt-has-no-fixture-file-xyz-999';

    await expect(askGhost(missingPrompt, 'sess')).rejects.toThrow(ParseError);
  });
});

// ---------------------------------------------------------------------------
// ConfigError when API key is missing
// ---------------------------------------------------------------------------

describe('askGhost — config error', () => {
  it('throws ConfigError when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_FIXTURE'];

    await expect(askGhost('some prompt', 'sess')).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when ANTHROPIC_API_KEY is empty string', async () => {
    process.env['ANTHROPIC_API_KEY'] = '';
    delete process.env['ANTHROPIC_FIXTURE'];

    await expect(askGhost('some prompt', 'sess')).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when ANTHROPIC_API_KEY is whitespace only', async () => {
    process.env['ANTHROPIC_API_KEY'] = '   ';
    delete process.env['ANTHROPIC_FIXTURE'];

    await expect(askGhost('some prompt', 'sess')).rejects.toThrow(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// Injectable client — ParseError on bad LLM response
// ---------------------------------------------------------------------------

describe('askGhost — injectable client', () => {
  it('throws ParseError when LLM response has no tool_use block', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key-fake';
    delete process.env['ANTHROPIC_FIXTURE'];

    const fakeClient: AnthropicClient = {
      messages: {
        create: async () => ({
          content: [{ type: 'text', text: 'Hello, I am the ghost.' }],
        }),
      },
    };

    await expect(askGhost('some prompt', 'sess', fakeClient)).rejects.toThrow(ParseError);
  });

  it('throws ParseError when tool_use block fails GhostAnswerSchema', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key-fake';
    delete process.env['ANTHROPIC_FIXTURE'];

    const fakeClient: AnthropicClient = {
      messages: {
        create: async () => ({
          content: [
            {
              type: 'tool_use',
              name: 'ghost_answer',
              input: { claims: [], voice: '', sessionId: '' }, // fails min(1) on claims
            },
          ],
        }),
      },
    };

    await expect(askGhost('some prompt', 'sess', fakeClient)).rejects.toThrow(ParseError);
  });

  it('returns GhostAnswer when client returns valid response', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key-fake';
    delete process.env['ANTHROPIC_FIXTURE'];

    const fakeClient: AnthropicClient = {
      messages: {
        create: async () => ({
          content: [
            {
              type: 'tool_use',
              name: 'ghost_answer',
              input: {
                claims: [
                  {
                    kind: 'silence',
                    text: 'The record is silent.',
                    citations: [],
                    silenceReason: 'No relevant commits',
                  },
                ],
                voice: 'Test ghost',
                sessionId: 'sess',
              },
            },
          ],
        }),
      },
    };

    const result = await askGhost('some prompt', 'sess', fakeClient);
    expect(result.claims).toHaveLength(1);
    expect(result.voice).toBe('Test ghost');
  });
});

// ---------------------------------------------------------------------------
// TimeoutError — fake AbortController
// ---------------------------------------------------------------------------

describe('askGhost — timeout', () => {
  it('throws TimeoutError when AbortController fires', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key-fake';
    process.env['LLM_TIMEOUT_MS'] = '1'; // 1 ms → guaranteed timeout
    delete process.env['ANTHROPIC_FIXTURE'];

    const fakeClient: AnthropicClient = {
      messages: {
        create: (_params, options) => {
          // Simulate abort — throw AbortError when signal fires
          return new Promise((_resolve, reject) => {
            const signal = options?.signal;
            if (signal) {
              signal.addEventListener('abort', () => {
                const err = new Error('AbortError');
                err.name = 'AbortError';
                reject(err);
              });
            }
            // Never resolve — let timeout fire
          });
        },
      },
    };

    const { TimeoutError: TE } = await import('../../src/errors.js');
    await expect(askGhost('some prompt', 'sess', fakeClient)).rejects.toThrow(TE);

    delete process.env['LLM_TIMEOUT_MS'];
  });
});
