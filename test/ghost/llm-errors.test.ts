/**
 * first-seance T1 — model failures are classified, never leaked (R6.1, R6.4, R6.5, R5.1).
 *
 * The client is a scripted fake that rejects with the installed SDK's own error classes
 * (@anthropic-ai/sdk 0.32.1: APIError, APIConnectionError, APIConnectionTimeoutError,
 * APIUserAbortError). No network call is made.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  askGhost,
  askPlan,
  classifyModelError,
  modelConfigured,
  MODEL_ID,
} from '../../src/ghost/llm.js';
import type { AnthropicClient, AnthropicMessage } from '../../src/ghost/llm.js';
import {
  ModelBusyError,
  ModelConfigError,
  ParseError,
  TimeoutError,
} from '../../src/errors.js';

const PROMPT = { system: 's', user: 'u' };
const KEY = 'sk-ant-test-key-0123456789';

const VALID_ANSWER = {
  claims: [
    {
      kind: 'silence',
      text: 'The record is silent.',
      citations: [],
      silenceReason: 'why',
    },
  ],
  voice: 'v',
  sessionId: 'sess',
};

function apiError(status: number, message = 'boom'): Anthropic.APIError {
  return new Anthropic.APIError(
    status,
    { type: 'error', error: { message } },
    message,
    undefined,
  );
}

/** A client that rejects every call with `make()` and counts the calls. */
function rejecting(make: () => unknown): {
  client: AnthropicClient;
  calls: () => number;
} {
  let n = 0;
  return {
    client: {
      messages: {
        create: async () => {
          n += 1;
          throw make();
        },
      },
    },
    calls: () => n,
  };
}

/** A client that waits for the abort signal, then rejects with `make()`. */
function waitsForAbort(make: () => unknown): {
  client: AnthropicClient;
  signals: AbortSignal[];
} {
  const signals: AbortSignal[] = [];
  return {
    signals,
    client: {
      messages: {
        create: (_p, opts) =>
          new Promise<AnthropicMessage>((_resolve, reject) => {
            const signal = opts?.signal;
            if (!signal) return reject(new Error('no signal'));
            signals.push(signal);
            signal.addEventListener('abort', () => reject(make()));
          }),
      },
    },
  };
}

afterEach(() => {
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['ANTHROPIC_FIXTURE'];
  delete process.env['LLM_TIMEOUT_MS'];
  delete process.env['LLM_PLAN_TIMEOUT_MS'];
  vi.useRealTimers();
});

describe('MODEL_ID', () => {
  it('is the steering model', () => {
    expect(MODEL_ID).toBe('claude-sonnet-5-5');
  });
});

describe('askGhost / askPlan — Anthropic API errors (R6.1)', () => {
  it.each([401, 403, 404])('status %i gives ModelConfigError, not retried', async (s) => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    const g = rejecting(() => apiError(s));
    const err = await askGhost(PROMPT, 'sess', g.client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelConfigError);
    expect((err as ModelConfigError).code).toBe('MODEL_CONFIG');
    expect(g.calls()).toBe(1);
    const p = rejecting(() => apiError(s));
    await expect(askPlan(PROMPT, p.client)).rejects.toBeInstanceOf(ModelConfigError);
    expect(p.calls()).toBe(1);
  });

  it.each([429, 529, 500, 503])(
    'status %i gives ModelBusyError, not retried',
    async (s) => {
      process.env['ANTHROPIC_API_KEY'] = KEY;
      const g = rejecting(() => apiError(s));
      const err = await askGhost(PROMPT, 'sess', g.client).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ModelBusyError);
      expect((err as ModelBusyError).code).toBe('MODEL_BUSY');
      expect(g.calls()).toBe(1);
      const p = rejecting(() => apiError(s));
      await expect(askPlan(PROMPT, p.client)).rejects.toBeInstanceOf(ModelBusyError);
      expect(p.calls()).toBe(1);
    },
  );

  it('APIConnectionError gives ModelBusyError, not retried', async () => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    const g = rejecting(
      () => new Anthropic.APIConnectionError({ message: 'ECONNRESET' }),
    );
    await expect(askGhost(PROMPT, 'sess', g.client)).rejects.toBeInstanceOf(
      ModelBusyError,
    );
    expect(g.calls()).toBe(1);
  });

  it('APIConnectionTimeoutError gives TimeoutError, not ModelBusyError', async () => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    const g = rejecting(() => new Anthropic.APIConnectionTimeoutError());
    const err = await askGhost(PROMPT, 'sess', g.client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(g.calls()).toBe(1);
  });

  it('a 400 stays a plain Error (500 INTERNAL_ERROR on the server)', async () => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    const g = rejecting(() => apiError(400));
    const err = await askGhost(PROMPT, 'sess', g.client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ModelConfigError);
    expect(err).not.toBeInstanceOf(ModelBusyError);
    expect(err).not.toBeInstanceOf(TimeoutError);
  });

  it('every message has the key replaced by [REDACTED]', async () => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    for (const make of [
      () => apiError(401, `bad key ${KEY}`),
      () => apiError(529, `overloaded ${KEY}`),
      () => apiError(400, `invalid ${KEY}`),
    ]) {
      const g = rejecting(make);
      const err = (await askGhost(PROMPT, 'sess', g.client).catch(
        (e: unknown) => e,
      )) as Error;
      expect(err.message).not.toContain(KEY);
      expect(err.message).toContain('[REDACTED]');
    }
  });
});

describe('askGhost — our abort (R6.1, audit §4)', () => {
  it('APIUserAbortError after the abort gives TimeoutError with code TIMEOUT', async () => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    process.env['LLM_TIMEOUT_MS'] = '5';
    const { client } = waitsForAbort(() => new Anthropic.APIUserAbortError());
    const err = await askGhost(PROMPT, 'sess', client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).code).toBe('TIMEOUT');
  });

  it('a plain Error thrown after the abort also gives TimeoutError', async () => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    process.env['LLM_TIMEOUT_MS'] = '5';
    const { client } = waitsForAbort(() => new Error('socket hang up'));
    const err = await askGhost(PROMPT, 'sess', client).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).code).toBe('TIMEOUT');
  });

  it('a timeout is not retried', async () => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    process.env['LLM_TIMEOUT_MS'] = '5';
    const w = waitsForAbort(() => new Anthropic.APIUserAbortError());
    await expect(askGhost(PROMPT, 'sess', w.client)).rejects.toBeInstanceOf(TimeoutError);
    expect(w.signals).toHaveLength(1);
  });
});

describe('timeouts per call (R6.4)', () => {
  async function abortsAfter(
    run: (c: AnthropicClient) => Promise<unknown>,
    ms: number,
  ): Promise<void> {
    vi.useFakeTimers();
    const w = waitsForAbort(() => new Anthropic.APIUserAbortError());
    const pending = run(w.client).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.signals).toHaveLength(1);
    const signal = w.signals[0] as AbortSignal;
    await vi.advanceTimersByTimeAsync(ms - 1);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    expect(await pending).toBeInstanceOf(TimeoutError);
  }

  it('askGhost aborts after 30,000 ms by default', async () => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    await abortsAfter((c) => askGhost(PROMPT, 'sess', c), 30_000);
  });

  it('askPlan aborts after 90,000 ms by default', async () => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    await abortsAfter((c) => askPlan(PROMPT, c), 90_000);
  });

  it('askPlan reads LLM_PLAN_TIMEOUT_MS, and ignores LLM_TIMEOUT_MS', async () => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    process.env['LLM_TIMEOUT_MS'] = '1000';
    process.env['LLM_PLAN_TIMEOUT_MS'] = '2500';
    await abortsAfter((c) => askPlan(PROMPT, c), 2500);
  });

  it('askGhost reads LLM_TIMEOUT_MS, and ignores LLM_PLAN_TIMEOUT_MS', async () => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    process.env['LLM_TIMEOUT_MS'] = '1500';
    process.env['LLM_PLAN_TIMEOUT_MS'] = '2500';
    await abortsAfter((c) => askGhost(PROMPT, 'sess', c), 1500);
  });

  it('a value that is not a positive integer falls back to the default', async () => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    process.env['LLM_PLAN_TIMEOUT_MS'] = 'soon';
    await abortsAfter((c) => askPlan(PROMPT, c), 90_000);
  });
});

describe('retry rule (R6.5)', () => {
  it('a ParseError is still retried once', async () => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    let n = 0;
    const client: AnthropicClient = {
      messages: {
        create: async () => {
          n += 1;
          return n === 1
            ? { content: [{ type: 'text', text: 'prose' }] }
            : {
                content: [
                  { type: 'tool_use', name: 'ghost_answer', input: VALID_ANSWER },
                ],
              };
        },
      },
    };
    const answer = await askGhost(PROMPT, 'sess', client);
    expect(n).toBe(2);
    expect(answer.voice).toBe('v');
  });

  it('two ParseErrors stop after two calls', async () => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    let n = 0;
    const client: AnthropicClient = {
      messages: {
        create: async () => {
          n += 1;
          return { content: [{ type: 'text', text: 'prose' }] };
        },
      },
    };
    await expect(askGhost(PROMPT, 'sess', client)).rejects.toBeInstanceOf(ParseError);
    expect(n).toBe(2);
  });
});

describe('classifyModelError', () => {
  it('checks the abort first: an aborted 529 is a timeout', () => {
    const e = classifyModelError(apiError(529), true, 1234, KEY);
    expect(e).toBeInstanceOf(TimeoutError);
    expect(e.message).toBe('LLM call exceeded timeout of 1234ms');
  });

  it('an AbortError or ABORT_ERR is a timeout', () => {
    const a = new Error('aborted');
    a.name = 'AbortError';
    expect(classifyModelError(a, false, 1, KEY)).toBeInstanceOf(TimeoutError);
    const b = Object.assign(new Error('aborted'), { code: 'ABORT_ERR' });
    expect(classifyModelError(b, false, 1, KEY)).toBeInstanceOf(TimeoutError);
  });

  it('a non-Error value becomes a plain Error with its text, key redacted', () => {
    const e = classifyModelError(`raw ${KEY}`, false, 1, KEY);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('raw [REDACTED]');
  });
});

describe('modelConfigured (R5.1)', () => {
  it('is true with a non-blank key', () => {
    process.env['ANTHROPIC_API_KEY'] = KEY;
    expect(modelConfigured()).toBe(true);
  });

  it('is true in fixture mode without a key', () => {
    process.env['ANTHROPIC_FIXTURE'] = '1';
    expect(modelConfigured()).toBe(true);
  });

  it('is false with no key, an empty key or a blank key', () => {
    expect(modelConfigured()).toBe(false);
    process.env['ANTHROPIC_API_KEY'] = '';
    expect(modelConfigured()).toBe(false);
    process.env['ANTHROPIC_API_KEY'] = '  \t ';
    expect(modelConfigured()).toBe(false);
  });

  it('is false when ANTHROPIC_FIXTURE is set to anything but 1', () => {
    process.env['ANTHROPIC_FIXTURE'] = '0';
    expect(modelConfigured()).toBe(false);
  });

  it('is read at call time', () => {
    expect(modelConfigured()).toBe(false);
    process.env['ANTHROPIC_API_KEY'] = KEY;
    expect(modelConfigured()).toBe(true);
    delete process.env['ANTHROPIC_API_KEY'];
    expect(modelConfigured()).toBe(false);
  });
});
