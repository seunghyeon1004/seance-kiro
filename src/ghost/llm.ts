/**
 * llm.ts — thin wrapper around @anthropic-ai/sdk.
 *
 * The Anthropic client is injectable so tests can provide a scripted fake
 * without hitting the network.
 *
 * ward-hardening design.md §6: the prompt travels as { system, user } (R5.1), fixtures are
 * keyed by promptHash (R5.7), and the plan is read as the raw refactor_plan tool input
 * with no answer envelope (R7.7).
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import type { ZodType, ZodTypeDef } from 'zod';
import {
  GhostAnswerWireSchema,
  MAX_CITATIONS,
  MAX_CLAIMS,
  QUOTE_MAX_CHARS,
  QUOTE_MIN_CHARS,
  RefactorPlanSchema,
  SILENCE_MAX_CHARS,
} from './schema.js';
import type { GhostAnswerWire, RefactorPlan } from './schema.js';
import type { ModelPrompt } from './persona.js';
import {
  ConfigError,
  TimeoutError,
  ParseError,
  ModelBusyError,
  ModelConfigError,
} from '../errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Injectable Anthropic client interface — only the subset we need.
 * Tests substitute a scripted fake that satisfies this contract.
 */
export interface AnthropicClient {
  messages: {
    create(
      params: AnthropicCreateParams,
      options?: AnthropicRequestOptions,
    ): Promise<AnthropicMessage>;
  };
}

export interface AnthropicCreateParams {
  model: string;
  max_tokens: number;
  system: string;
  tools: AnthropicTool[];
  tool_choice?: { type: 'any' };
  messages: Array<{ role: 'user'; content: string }>;
}

export interface AnthropicRequestOptions {
  signal?: AbortSignal;
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: {
    type: 'object';
    [k: string]: unknown;
  };
}

export interface AnthropicMessage {
  content: Array<AnthropicContentBlock>;
}

export interface AnthropicContentBlock {
  type: string;
  name?: string;
  input?: unknown;
  text?: string;
}

// ---------------------------------------------------------------------------
// Default client factory (uses real Anthropic SDK)
// ---------------------------------------------------------------------------

function makeDefaultClient(apiKey: string): AnthropicClient {
  return new Anthropic({ apiKey }) as unknown as AnthropicClient;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MODEL_ID = 'claude-sonnet-5-5';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PLAN_TIMEOUT_MS = 90_000;

// src/ghost/llm.ts → ../../.. = project root
const FIXTURES_ROOT = join(fileURLToPath(import.meta.url), '../../../test/fixtures');
const GHOST_FIXTURE_DIR = join(FIXTURES_ROOT, 'ghost-answers');
const PLAN_FIXTURE_DIR = join(FIXTURES_ROOT, 'exorcism-plans');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** A key is set and not blank, or fixture mode is on (R5.1). Read at call time. */
export function modelConfigured(): boolean {
  if (process.env['ANTHROPIC_FIXTURE'] === '1') return true;
  const key = process.env['ANTHROPIC_API_KEY'];
  return key !== undefined && key.trim() !== '';
}

/** A positive integer from the environment, else the default. Read at call time. */
function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  const n = parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

/**
 * Map a failed messages.create() to our error taxonomy (R6.1). Pure: no I/O.
 * `aborted` is our controller's signal.aborted. Every message has `apiKey` replaced by [REDACTED].
 *
 * The abort checks come first: APIUserAbortError is an APIError with no status, and
 * APIConnectionTimeoutError is an APIConnectionError (@anthropic-ai/sdk 0.32.1, error.d.ts).
 */
export function classifyModelError(
  err: unknown,
  aborted: boolean,
  timeoutMs: number,
  apiKey: string,
): Error {
  const redact = (s: string): string =>
    apiKey === '' ? s : s.replaceAll(apiKey, '[REDACTED]');
  const code =
    err instanceof Error ? (err as Error & { code?: unknown }).code : undefined;
  if (
    aborted ||
    err instanceof Anthropic.APIUserAbortError ||
    err instanceof Anthropic.APIConnectionTimeoutError ||
    (err instanceof Error && (err.name === 'AbortError' || code === 'ABORT_ERR'))
  ) {
    return new TimeoutError(`LLM call exceeded timeout of ${timeoutMs}ms`);
  }
  const message = redact(err instanceof Error ? err.message : String(err));
  if (err instanceof Anthropic.APIError && err.status !== undefined) {
    const s = err.status;
    if (s === 401 || s === 403 || s === 404) {
      return new ModelConfigError(`Anthropic API ${s}: ${message}`);
    }
    if (s === 429 || s === 529 || (s >= 500 && s <= 599)) {
      return new ModelBusyError(`Anthropic API ${s}: ${message}`);
    }
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ModelBusyError(`Anthropic API connection error: ${message}`);
  }
  return new Error(message);
}

/** sha256(system + "\n\u0000\n" + user), first 8 hex characters. Fixture key (R5.7). */
export function promptHash(p: ModelPrompt): string {
  return createHash('sha256')
    .update(p.system + '\n\u0000\n' + p.user)
    .digest('hex')
    .slice(0, 8);
}

/**
 * Ask the ghost. Returns the answer with its envelope Zod-validated; each claim is left
 * for the verifier to check on its own (R1.8), so a quoteless claim is struck by the ward
 * instead of failing the whole answer.
 *
 * @param prompt    - { system, user } from buildPrompt().
 * @param sessionId - The session the answer belongs to (the system text asks the model to echo it).
 * @param client    - Injectable Anthropic client (defaults to real SDK client).
 */
export async function askGhost(
  prompt: ModelPrompt,
  sessionId: string,
  client?: AnthropicClient,
): Promise<GhostAnswerWire> {
  return withOneRetry(async () => {
    if (process.env['ANTHROPIC_FIXTURE'] === '1') {
      return loadFixture(
        GHOST_FIXTURE_DIR,
        prompt,
        GhostAnswerWireSchema,
        'GhostAnswerWireSchema',
      );
    }
    const input = await callTool(
      prompt,
      GHOST_TOOL,
      envMs('LLM_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
      client,
    );
    return parseOrThrow(
      input,
      GhostAnswerWireSchema,
      'LLM response',
      'GhostAnswerWireSchema',
    );
  });
}

/**
 * Ask for an exorcism plan. Returns the refactor_plan tool input validated with
 * RefactorPlanSchema (claims are unknown[] and checked by the verifier, R7.3).
 *
 * @param prompt - { system, user } from buildPlanPrompt().
 * @param client - Injectable Anthropic client (defaults to real SDK client).
 */
export async function askPlan(
  prompt: ModelPrompt,
  client?: AnthropicClient,
): Promise<RefactorPlan> {
  return withOneRetry(async () => {
    if (process.env['ANTHROPIC_FIXTURE'] === '1') {
      return loadFixture(
        PLAN_FIXTURE_DIR,
        prompt,
        RefactorPlanSchema,
        'RefactorPlanSchema',
      );
    }
    const input = await callTool(
      prompt,
      PLAN_TOOL,
      envMs('LLM_PLAN_TIMEOUT_MS', DEFAULT_PLAN_TIMEOUT_MS),
      client,
    );
    return parseOrThrow(input, RefactorPlanSchema, 'LLM response', 'RefactorPlanSchema');
  });
}

// ---------------------------------------------------------------------------
// Shared call path
// ---------------------------------------------------------------------------

/**
 * The model occasionally answers in prose or breaks the envelope; one retry is cheap and
 * invisible to the user. Only ParseError is retried, and never in fixture mode.
 */
async function withOneRetry<T>(once: () => Promise<T>): Promise<T> {
  try {
    return await once();
  } catch (err) {
    if (err instanceof ParseError && process.env['ANTHROPIC_FIXTURE'] !== '1') {
      return once();
    }
    throw err;
  }
}

/** Send { system, user } with one tool and return the tool_use block's raw input. */
async function callTool(
  prompt: ModelPrompt,
  tool: AnthropicTool,
  timeoutMs: number,
  client?: AnthropicClient,
): Promise<unknown> {
  // Read API key at call time; required even with an injected client
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey || apiKey.trim() === '') {
    throw new ConfigError(
      'ANTHROPIC_API_KEY environment variable is not set or is empty',
    );
  }

  const resolvedClient = client ?? makeDefaultClient(apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // DEBUG: the system text and the size of the user turn, never the ledger text
  if (process.env['DEBUG']) {
    console.debug('[DEBUG] model system:', prompt.system);
    console.debug('[DEBUG] model user turn length:', prompt.user.length);
  }

  let rawResponse: AnthropicMessage;
  try {
    rawResponse = await resolvedClient.messages.create(
      {
        model: MODEL_ID,
        max_tokens: 4096,
        // claude-sonnet-5-5 rejects forced tool_choice, so the system text asks for exactly one tool call
        system: prompt.system,
        tools: [tool],
        messages: [{ role: 'user', content: prompt.user }],
      },
      { signal: controller.signal },
    );
  } catch (err: unknown) {
    clearTimeout(timer);
    throw classifyModelError(err, controller.signal.aborted, timeoutMs, apiKey);
  }

  clearTimeout(timer);

  const toolUseBlock = rawResponse.content.find((b) => b.type === 'tool_use');
  if (!toolUseBlock) {
    throw new ParseError('LLM response contained no tool_use block');
  }
  return toolUseBlock.input;
}

function parseOrThrow<T>(
  input: unknown,
  schema: ZodType<T, ZodTypeDef, unknown>,
  what: string,
  schemaName: string,
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ParseError(
      `${what} failed ${schemaName} validation: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Fixture mode — one directory per function, no fallback
// ---------------------------------------------------------------------------

async function loadFixture<T>(
  dir: string,
  prompt: ModelPrompt,
  schema: ZodType<T, ZodTypeDef, unknown>,
  schemaName: string,
): Promise<T> {
  const hash = promptHash(prompt);
  const fixturePath = join(dir, `${hash}.json`);

  let raw: string;
  try {
    raw = await readFile(fixturePath, 'utf8');
  } catch {
    throw new ParseError(
      `Fixture file not found for prompt hash ${hash}: ${fixturePath}`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ParseError(`Fixture file ${fixturePath} is not valid JSON`);
  }

  return parseOrThrow(json, schema, `Fixture file ${fixturePath}`, schemaName);
}

// ---------------------------------------------------------------------------
// Tool JSON schemas (R1.2)
// ---------------------------------------------------------------------------

const CITATION_SCHEMA = {
  type: 'object',
  required: ['sha7', 'quote'],
  properties: {
    sha7: { type: 'string', pattern: '^[0-9a-f]{7}$' },
    quote: { type: 'string', minLength: QUOTE_MIN_CHARS, maxLength: QUOTE_MAX_CHARS },
  },
};

const CITATIONS_SCHEMA = {
  type: 'array',
  minItems: 1,
  maxItems: MAX_CITATIONS,
  items: CITATION_SCHEMA,
};

function citedClaimSchema(kinds: string[]): Record<string, unknown> {
  return {
    type: 'object',
    required: ['kind', 'text', 'citations'],
    properties: {
      kind: { type: 'string', enum: kinds },
      text: { type: 'string', minLength: 1 },
      citations: CITATIONS_SCHEMA,
    },
  };
}

const PLAN_CLAIMS_SCHEMA = {
  type: 'array',
  minItems: 1,
  maxItems: MAX_CLAIMS,
  items: citedClaimSchema(['memory', 'speculation']),
};

/** JSON Schema for the exorcism plan tool; matches RefactorPlanSchema in schema.ts. */
const PLAN_TOOL: AnthropicTool = {
  name: 'refactor_plan',
  description:
    'The exorcism plan: characterization tests, small reversible steps and a do-not-touch list, every claim cited and quoted from the Evidence Ledger.',
  input_schema: {
    type: 'object',
    required: ['characterizationTests', 'steps', 'doNotTouchList', 'summary'],
    properties: {
      characterizationTests: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1, maxLength: 512 },
      },
      steps: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['description', 'rationale', 'claims', 'reversible'],
          properties: {
            description: { type: 'string', minLength: 1, maxLength: 512 },
            rationale: { type: 'string', minLength: 1, maxLength: 256 },
            claims: PLAN_CLAIMS_SCHEMA,
            reversible: { type: 'boolean' },
          },
        },
      },
      doNotTouchList: {
        type: 'array',
        items: {
          type: 'object',
          required: ['lineRange', 'reason', 'claims'],
          properties: {
            lineRange: {
              type: 'object',
              required: ['start', 'end'],
              properties: {
                start: { type: 'integer', minimum: 1 },
                end: { type: 'integer', minimum: 1 },
              },
            },
            reason: { type: 'string', minLength: 1, maxLength: 512 },
            claims: PLAN_CLAIMS_SCHEMA,
          },
        },
      },
      summary: { type: 'string', minLength: 1, maxLength: 1024 },
    },
  },
};

/** JSON Schema for the ghost answer tool; matches GhostAnswerSchema in schema.ts. */
const GHOST_TOOL: AnthropicTool = {
  name: 'ghost_answer',
  description:
    'Structured answer from the ghost persona. Every memory and speculation claim cites and quotes the Evidence Ledger.',
  input_schema: {
    type: 'object',
    required: ['claims', 'voice', 'sessionId'],
    properties: {
      sessionId: { type: 'string', minLength: 1 },
      voice: { type: 'string', minLength: 1 },
      claims: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_CLAIMS,
        items: {
          oneOf: [
            citedClaimSchema(['memory']),
            citedClaimSchema(['speculation']),
            {
              type: 'object',
              required: ['kind', 'text', 'citations', 'silenceReason'],
              properties: {
                kind: { type: 'string', enum: ['silence'] },
                text: { type: 'string', minLength: 1, maxLength: SILENCE_MAX_CHARS },
                citations: { type: 'array', maxItems: 0, items: {} },
                silenceReason: {
                  type: 'string',
                  minLength: 1,
                  maxLength: SILENCE_MAX_CHARS,
                },
              },
            },
          ],
        },
      },
    },
  },
};
