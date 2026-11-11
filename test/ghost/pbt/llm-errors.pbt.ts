/**
 * first-seance T1 — CP11, the model error map (R6.1, R6.3, N6).
 *
 * For any APIError status in 400–599, any message and any key, classifyModelError gives
 * ModelConfigError for 401/403/404, ModelBusyError for 429/529/5xx and a plain Error
 * otherwise. With aborted === true it gives TimeoutError whatever the error. No resulting
 * message contains the key.
 */

import { describe, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import Anthropic from '@anthropic-ai/sdk';
import { classifyModelError } from '../../../src/ghost/llm.js';
import { ModelBusyError, ModelConfigError, TimeoutError } from '../../../src/errors.js';

const SEED = process.env['FAST_CHECK_SEED']
  ? parseInt(process.env['FAST_CHECK_SEED'], 10)
  : undefined;
const fcParams: fc.Parameters<unknown> = {
  numRuns: 1000,
  ...(SEED !== undefined ? { seed: SEED } : {}),
};

/** Keys shaped like real ones, so none can be a substring of the fixed wording. */
const keyArb = fc
  .stringOf(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-',
    ),
    { minLength: 8, maxLength: 40 },
  )
  .map((s) => `sk-ant-${s}`);

/** Any text, with the key written into it zero or more times. */
const messageArb = (key: string): fc.Arbitrary<string> =>
  fc
    .array(fc.oneof(fc.fullUnicodeString({ maxLength: 20 }), fc.constant(key)), {
      maxLength: 5,
    })
    .map((xs) => xs.join(''));

const statusArb = fc.integer({ min: 400, max: 599 });

const kind = (status: number): 'config' | 'busy' | 'other' =>
  status === 401 || status === 403 || status === 404
    ? 'config'
    : status === 429 || status >= 500
      ? 'busy'
      : 'other';

describe('CP11 — model error map (R6.1, R6.3)', () => {
  test.prop(
    [
      keyArb.chain((k) => fc.tuple(fc.constant(k), statusArb, messageArb(k))),
      fc.integer({ min: 1, max: 1e6 }),
    ],
    fcParams,
  )('status decides the class; the key never survives', ([key, status, msg], ms) => {
    const err = new Anthropic.APIError(status, { message: msg }, msg, undefined);
    const out = classifyModelError(err, false, ms, key);
    const k = kind(status);
    if (k === 'config') {
      expect(out).toBeInstanceOf(ModelConfigError);
    } else if (k === 'busy') {
      expect(out).toBeInstanceOf(ModelBusyError);
    } else {
      expect(out).not.toBeInstanceOf(ModelConfigError);
      expect(out).not.toBeInstanceOf(ModelBusyError);
      expect(out).not.toBeInstanceOf(TimeoutError);
      expect(out).toBeInstanceOf(Error);
    }
    expect(out.message).not.toContain(key);
  });

  const anyError = (key: string): fc.Arbitrary<unknown> =>
    fc.oneof(
      fc
        .tuple(statusArb, messageArb(key))
        .map(([s, m]) => new Anthropic.APIError(s, { message: m }, m, undefined)),
      messageArb(key).map((m) => new Anthropic.APIConnectionError({ message: m })),
      messageArb(key).map((m) => new Anthropic.APIUserAbortError({ message: m })),
      messageArb(key).map((m) => new Error(m)),
      messageArb(key),
      fc.constant(undefined),
    );

  test.prop(
    [
      keyArb.chain((k) => fc.tuple(fc.constant(k), anyError(k))),
      fc.integer({ min: 1, max: 1e6 }),
    ],
    fcParams,
  )('aborted === true gives TimeoutError whatever the error', ([key, err], ms) => {
    const out = classifyModelError(err, true, ms, key);
    expect(out).toBeInstanceOf(TimeoutError);
    expect((out as TimeoutError).code).toBe('TIMEOUT');
    expect(out.message).not.toContain(key);
  });

  test.prop(
    [
      keyArb.chain((k) => fc.tuple(fc.constant(k), anyError(k))),
      fc.integer({ min: 1, max: 1e6 }),
    ],
    fcParams,
  )('no classified message contains the key, aborted or not', ([key, err], ms) => {
    expect(classifyModelError(err, false, ms, key).message).not.toContain(key);
  });
});
