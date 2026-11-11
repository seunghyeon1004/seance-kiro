/**
 * Unit tests for src/ghost/llm.ts
 *
 * All tests run without hitting real Anthropic endpoints.
 * Fixture mode is tested with synthetic fixture files these tests write themselves.
 * Injectable client tests check the request shape and error handling.
 *
 * ward-hardening T2: system parameter, promptHash, tool schemas, retry rule,
 * askPlan and per-directory fixture loading, DEBUG rule (R1.2, R5.1, R5.7, R7.7).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askGhost, askPlan, promptHash } from '../../src/ghost/llm.js';
import type {
  AnthropicClient,
  AnthropicCreateParams,
  AnthropicMessage,
} from '../../src/ghost/llm.js';
import type { ModelPrompt } from '../../src/ghost/persona.js';
import { ConfigError, ParseError } from '../../src/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dir = dirname(fileURLToPath(import.meta.url));
const GHOST_DIR = join(__dir, '../../test/fixtures/ghost-answers');
const PLAN_DIR = join(__dir, '../../test/fixtures/exorcism-plans');

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

const VALID_PLAN = {
  characterizationTests: ['it waits 3 seconds before calling the vendor'],
  steps: [
    {
      description: 'Name the delay constant.',
      rationale: 'The number is explained by the commit.',
      claims: [
        {
          kind: 'memory',
          text: 'The wait is for the downstream service.',
          citations: [{ sha7: 'abc1234', quote: 'wait for downstream' }],
        },
      ],
      reversible: true,
    },
  ],
  doNotTouchList: [],
  summary: 'Name the constant and keep the wait.',
};

// Synthetic prompts whose fixture files these tests write themselves
const TEST_PROMPT: ModelPrompt = {
  system: 'SEANCE_TEST_SYSTEM_FOR_FIXTURE_HASH',
  user: 'SEANCE_TEST_PROMPT_FOR_FIXTURE_HASH_1234567890',
};
const BAD_PROMPT: ModelPrompt = { system: 'SEANCE_TEST_SYSTEM', user: 'bad-prompt' };
const PLAN_PROMPT: ModelPrompt = { system: 'SEANCE_TEST_PLAN', user: 'plan-prompt' };
const GHOST_ONLY_PROMPT: ModelPrompt = { system: 'SEANCE_TEST_GHOST_ONLY', user: 'g' };

function expectedHash(p: ModelPrompt): string {
  return createHash('sha256')
    .update(p.system + '\n\u0000\n' + p.user)
    .digest('hex')
    .slice(0, 8);
}

const TEST_HASH = expectedHash(TEST_PROMPT);
const BAD_HASH = expectedHash(BAD_PROMPT);
const PLAN_HASH = expectedHash(PLAN_PROMPT);
const GHOST_ONLY_HASH = expectedHash(GHOST_ONLY_PROMPT);

/** A scripted client that records every request and replies from a list. */
function scriptedClient(replies: AnthropicMessage[]): {
  client: AnthropicClient;
  calls: AnthropicCreateParams[];
} {
  const calls: AnthropicCreateParams[] = [];
  let i = 0;
  const client: AnthropicClient = {
    messages: {
      create: async (params) => {
        calls.push(params);
        const reply = replies[Math.min(i, replies.length - 1)];
        i += 1;
        if (reply === undefined) throw new Error('no scripted reply');
        return reply;
      },
    },
  };
  return { client, calls };
}

function toolReply(name: string, input: unknown): AnthropicMessage {
  return { content: [{ type: 'tool_use', name, input }] };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await mkdir(GHOST_DIR, { recursive: true });
  await writeFile(
    join(GHOST_DIR, `${TEST_HASH}.json`),
    JSON.stringify(VALID_GHOST_ANSWER),
  );
  await writeFile(
    join(GHOST_DIR, `${BAD_HASH}.json`),
    JSON.stringify({ claims: [], voice: '', sessionId: '' }),
  );
});

afterEach(async () => {
  delete process.env['ANTHROPIC_FIXTURE'];
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['DEBUG'];
  vi.restoreAllMocks();
  // Plan-mode and cross-directory fixtures are removed after each test
  await rm(join(PLAN_DIR, `${PLAN_HASH}.json`), { force: true });
  await rm(join(GHOST_DIR, `${PLAN_HASH}.json`), { force: true });
  await rm(join(PLAN_DIR, `${GHOST_ONLY_HASH}.json`), { force: true });
});

// ---------------------------------------------------------------------------
// promptHash (R5.7)
// ---------------------------------------------------------------------------

describe('promptHash', () => {
  it('is sha256(system + "\\n\\u0000\\n" + user), first 8 hex characters', () => {
    expect(promptHash(TEST_PROMPT)).toBe(TEST_HASH);
    expect(promptHash(TEST_PROMPT)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('separates system from user, so moving text across the boundary changes it', () => {
    expect(promptHash({ system: 'ab', user: 'c' })).not.toBe(
      promptHash({ system: 'a', user: 'bc' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Fixture mode
// ---------------------------------------------------------------------------

describe('askGhost — fixture mode', () => {
  it('returns the canned answer from ghost-answers/<promptHash>.json', async () => {
    process.env['ANTHROPIC_FIXTURE'] = '1';
    const result = await askGhost(TEST_PROMPT, 'test-session-001');
    expect(result.claims).toHaveLength(1);
    expect(result.voice).toBe('Ada Lovelace, terse and precise');
    expect(result.sessionId).toBe('test-session-001');
  });

  it('throws ParseError when the fixture fails the envelope schema', async () => {
    process.env['ANTHROPIC_FIXTURE'] = '1';
    await expect(askGhost(BAD_PROMPT, 'sess')).rejects.toThrow(ParseError);
  });

  it('throws ParseError when the fixture file does not exist', async () => {
    process.env['ANTHROPIC_FIXTURE'] = '1';
    await expect(
      askGhost({ system: 's', user: 'this-prompt-has-no-fixture-file-xyz-999' }, 'sess'),
    ).rejects.toThrow(ParseError);
  });

  it('does not fall back to exorcism-plans', async () => {
    process.env['ANTHROPIC_FIXTURE'] = '1';
    await writeFile(
      join(PLAN_DIR, `${GHOST_ONLY_HASH}.json`),
      JSON.stringify(VALID_GHOST_ANSWER),
    );
    expect(existsSync(join(GHOST_DIR, `${GHOST_ONLY_HASH}.json`))).toBe(false);
    await expect(askGhost(GHOST_ONLY_PROMPT, 'sess')).rejects.toThrow(ParseError);
  });
});

describe('askPlan — fixture mode (R7.7)', () => {
  it('reads exorcism-plans/<promptHash>.json as the raw tool input', async () => {
    process.env['ANTHROPIC_FIXTURE'] = '1';
    await writeFile(join(PLAN_DIR, `${PLAN_HASH}.json`), JSON.stringify(VALID_PLAN));
    const plan = await askPlan(PLAN_PROMPT);
    expect(plan.summary).toBe('Name the constant and keep the wait.');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.claims).toEqual(VALID_PLAN.steps[0]?.claims);
  });

  it('refuses the old 0000000 answer envelope', async () => {
    process.env['ANTHROPIC_FIXTURE'] = '1';
    await writeFile(
      join(PLAN_DIR, `${PLAN_HASH}.json`),
      JSON.stringify({
        voice: 'exorcist',
        sessionId: 's',
        claims: [
          {
            kind: 'memory',
            text: JSON.stringify(VALID_PLAN),
            citations: [{ sha7: '0000000' }],
          },
        ],
      }),
    );
    await expect(askPlan(PLAN_PROMPT)).rejects.toThrow(ParseError);
  });

  it('does not fall back to ghost-answers', async () => {
    process.env['ANTHROPIC_FIXTURE'] = '1';
    await writeFile(join(GHOST_DIR, `${PLAN_HASH}.json`), JSON.stringify(VALID_PLAN));
    await expect(askPlan(PLAN_PROMPT)).rejects.toThrow(ParseError);
  });
});

// ---------------------------------------------------------------------------
// ConfigError when API key is missing
// ---------------------------------------------------------------------------

describe('askGhost / askPlan — config error', () => {
  const p: ModelPrompt = { system: 's', user: 'u' };

  it('throws ConfigError when ANTHROPIC_API_KEY is not set', async () => {
    await expect(askGhost(p, 'sess')).rejects.toThrow(ConfigError);
    await expect(askPlan(p)).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when ANTHROPIC_API_KEY is empty string', async () => {
    process.env['ANTHROPIC_API_KEY'] = '';
    await expect(askGhost(p, 'sess')).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when ANTHROPIC_API_KEY is whitespace only', async () => {
    process.env['ANTHROPIC_API_KEY'] = '   ';
    await expect(askGhost(p, 'sess')).rejects.toThrow(ConfigError);
  });

  it('still requires the key with an injected client', async () => {
    const { client, calls } = scriptedClient([
      toolReply('ghost_answer', VALID_GHOST_ANSWER),
    ]);
    await expect(askGhost(p, 'sess', client)).rejects.toThrow(ConfigError);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Injectable client — request shape (R5.1, R1.2)
// ---------------------------------------------------------------------------

describe('askGhost — request shape', () => {
  beforeEach(() => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key-fake';
  });

  it('sends system as the system parameter and user as the only message', async () => {
    const { client, calls } = scriptedClient([
      toolReply('ghost_answer', VALID_GHOST_ANSWER),
    ]);
    await askGhost(TEST_PROMPT, 'sess', client);
    expect(calls).toHaveLength(1);
    const params = calls[0];
    expect(params?.system).toBe(TEST_PROMPT.system);
    expect(params?.messages).toEqual([{ role: 'user', content: TEST_PROMPT.user }]);
    expect(params?.tools.map((t) => t.name)).toEqual(['ghost_answer']);
  });

  it('askPlan sends the same layout with the refactor_plan tool', async () => {
    const { client, calls } = scriptedClient([toolReply('refactor_plan', VALID_PLAN)]);
    const plan = await askPlan(PLAN_PROMPT, client);
    expect(plan.summary).toBe(VALID_PLAN.summary);
    expect(calls[0]?.system).toBe(PLAN_PROMPT.system);
    expect(calls[0]?.messages).toEqual([{ role: 'user', content: PLAN_PROMPT.user }]);
    expect(calls[0]?.tools.map((t) => t.name)).toEqual(['refactor_plan']);
  });
});

// ---------------------------------------------------------------------------
// Tool schemas (R1.2)
// ---------------------------------------------------------------------------

type JsonSchema = {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  enum?: string[];
};

async function toolSchema(kind: 'ghost' | 'plan'): Promise<JsonSchema> {
  process.env['ANTHROPIC_API_KEY'] = 'test-key-fake';
  if (kind === 'ghost') {
    const { client, calls } = scriptedClient([
      toolReply('ghost_answer', VALID_GHOST_ANSWER),
    ]);
    await askGhost(TEST_PROMPT, 'sess', client);
    return calls[0]?.tools[0]?.input_schema as JsonSchema;
  }
  const { client, calls } = scriptedClient([toolReply('refactor_plan', VALID_PLAN)]);
  await askPlan(PLAN_PROMPT, client);
  return calls[0]?.tools[0]?.input_schema as JsonSchema;
}

function expectQuotedCitation(citations: JsonSchema | undefined): void {
  expect(citations?.maxItems).toBe(10);
  const c = citations?.items;
  expect(c?.required).toEqual(['sha7', 'quote']);
  expect(c?.properties?.['quote']).toEqual({
    type: 'string',
    minLength: 8,
    maxLength: 500,
  });
}

describe('tool schemas', () => {
  it('ghost_answer requires quotes, caps claims, citations and silence text', async () => {
    const s = await toolSchema('ghost');
    const claims = s.properties?.['claims'];
    expect(claims?.maxItems).toBe(50);
    const branches = claims?.items?.oneOf ?? [];
    expect(branches).toHaveLength(3);
    for (const b of branches.slice(0, 2)) {
      expect(b.required).toContain('citations');
      expectQuotedCitation(b.properties?.['citations']);
    }
    const silence = branches[2];
    expect(silence?.properties?.['kind']?.enum).toEqual(['silence']);
    expect(silence?.properties?.['text']?.maxLength).toBe(300);
    expect(silence?.properties?.['silenceReason']?.maxLength).toBe(300);
  });

  it('refactor_plan requires quotes and caps claims and citations', async () => {
    const s = await toolSchema('plan');
    const step = s.properties?.['steps']?.items;
    const entry = s.properties?.['doNotTouchList']?.items;
    for (const holder of [step, entry]) {
      const claims = holder?.properties?.['claims'];
      expect(claims?.maxItems).toBe(50);
      expectQuotedCitation(claims?.items?.properties?.['citations']);
    }
  });
});

// ---------------------------------------------------------------------------
// Retry rule
// ---------------------------------------------------------------------------

describe('askGhost — retry', () => {
  beforeEach(() => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key-fake';
  });

  it('a quoteless claim does not trigger the retry; it reaches the caller', async () => {
    const quoteless = {
      claims: [{ kind: 'memory', text: 'It is safe.', citations: [{ sha7: 'abc1234' }] }],
      voice: 'v',
      sessionId: 'sess',
    };
    const { client, calls } = scriptedClient([toolReply('ghost_answer', quoteless)]);
    const answer = await askGhost(TEST_PROMPT, 'sess', client);
    expect(calls).toHaveLength(1);
    expect(answer.claims).toEqual(quoteless.claims);
  });

  it('an envelope failure triggers exactly one retry', async () => {
    const { client, calls } = scriptedClient([
      toolReply('ghost_answer', { claims: [], voice: '', sessionId: '' }),
      toolReply('ghost_answer', VALID_GHOST_ANSWER),
    ]);
    const answer = await askGhost(TEST_PROMPT, 'sess', client);
    expect(calls).toHaveLength(2);
    expect(answer.voice).toBe(VALID_GHOST_ANSWER.voice);
  });

  it('two envelope failures throw ParseError after two calls', async () => {
    const { client, calls } = scriptedClient([
      { content: [{ type: 'text', text: 'Hello, I am the ghost.' }] },
    ]);
    await expect(askGhost(TEST_PROMPT, 'sess', client)).rejects.toThrow(ParseError);
    expect(calls).toHaveLength(2);
  });

  it('askPlan retries once on a plan that fails RefactorPlanSchema', async () => {
    const { client, calls } = scriptedClient([
      toolReply('refactor_plan', { steps: [] }),
      toolReply('refactor_plan', VALID_PLAN),
    ]);
    const plan = await askPlan(PLAN_PROMPT, client);
    expect(calls).toHaveLength(2);
    expect(plan.summary).toBe(VALID_PLAN.summary);
  });

  it('returns the answer when the client replies with a valid silence claim', async () => {
    const { client } = scriptedClient([
      toolReply('ghost_answer', {
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
      }),
    ]);
    const result = await askGhost(TEST_PROMPT, 'sess', client);
    expect(result.claims).toHaveLength(1);
    expect(result.voice).toBe('Test ghost');
  });
});

// ---------------------------------------------------------------------------
// DEBUG rule
// ---------------------------------------------------------------------------

describe('DEBUG logging', () => {
  it('logs system and the length of user, never ledger text', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key-fake';
    process.env['DEBUG'] = '1';
    const LEDGER_TEXT = 'ledger-secret-subject-q7z';
    const prompt: ModelPrompt = {
      system: 'SYSTEM-RULES-TEXT',
      user: `<ledger>\n<evidence id="E1"><subject>${LEDGER_TEXT}</subject></evidence>\n</ledger>`,
    };
    const answer = {
      claims: [
        {
          kind: 'memory',
          text: 'It says so.',
          citations: [{ sha7: 'abc1234', quote: LEDGER_TEXT }],
        },
      ],
      voice: 'v',
      sessionId: 'sess',
    };
    const lines: string[] = [];
    vi.spyOn(console, 'debug').mockImplementation((...args: unknown[]) => {
      lines.push(
        args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
      );
    });
    const { client } = scriptedClient([toolReply('ghost_answer', answer)]);
    await askGhost(prompt, 'sess', client);
    const out = lines.join('\n');
    expect(out).toContain('SYSTEM-RULES-TEXT');
    expect(out).toContain(String(prompt.user.length));
    expect(out).not.toContain(LEDGER_TEXT);
  });
});

// ---------------------------------------------------------------------------
// TimeoutError — fake AbortController
// ---------------------------------------------------------------------------

describe('askGhost — timeout', () => {
  it('throws TimeoutError when AbortController fires', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key-fake';
    process.env['LLM_TIMEOUT_MS'] = '1'; // 1 ms → guaranteed timeout

    const fakeClient: AnthropicClient = {
      messages: {
        create: (_params, options) => {
          return new Promise((_resolve, reject) => {
            const signal = options?.signal;
            if (signal) {
              signal.addEventListener('abort', () => {
                const err = new Error('AbortError');
                err.name = 'AbortError';
                reject(err);
              });
            }
          });
        },
      },
    };

    const { TimeoutError: TE } = await import('../../src/errors.js');
    const err = await askGhost({ system: 's', user: 'u' }, 'sess', fakeClient).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TE);
    // first-seance T1: the code the server and the page read (design.md §4.1)
    expect((err as InstanceType<typeof TE>).code).toBe('TIMEOUT');

    delete process.env['LLM_TIMEOUT_MS'];
  });
});
