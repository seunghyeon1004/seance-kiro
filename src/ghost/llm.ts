/**
 * llm.ts — thin wrapper around @anthropic-ai/sdk.
 *
 * The Anthropic client is injectable so tests can provide a scripted fake
 * without hitting the network.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { GhostAnswerSchema } from './schema.js';
import type { GhostAnswer } from './schema.js';
import { ConfigError, TimeoutError, ParseError } from '../errors.js';

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

const MODEL_ID = 'claude-sonnet-5-5';
const DEFAULT_TIMEOUT_MS = 30_000;

// Path to fixture directory (relative to project root, resolved at runtime)
const FIXTURE_DIR = join(
  fileURLToPath(import.meta.url),
  // src/ghost/llm.ts → ../../.. = project root
  '../../../test/fixtures/ghost-answers',
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a prompt to the LLM and return a parsed, Zod-validated GhostAnswer.
 *
 * @param prompt    - Full prompt string from buildPrompt().
 * @param sessionId - Used to validate the model's echoed sessionId.
 * @param client    - Injectable Anthropic client (defaults to real SDK client).
 */
export async function askGhost(
  prompt: string,
  sessionId: string,
  client?: AnthropicClient,
  opts: { tool?: 'ghost_answer' | 'refactor_plan' } = {},
): Promise<GhostAnswer> {
  const planMode = opts.tool === 'refactor_plan';
  // Fixture mode — no network call
  if (process.env['ANTHROPIC_FIXTURE'] === '1') {
    return loadFixture(prompt);
  }

  // Read API key at call time
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey || apiKey.trim() === '') {
    throw new ConfigError(
      'ANTHROPIC_API_KEY environment variable is not set or is empty',
    );
  }

  const resolvedClient = client ?? makeDefaultClient(apiKey);

  // Build JSON schema from GhostAnswerSchema for tool-use JSON mode
  const toolInputSchema = planMode ? buildRefactorPlanJsonSchema() : buildGhostAnswerJsonSchema();

  // AbortController for timeout
  const timeoutMs = process.env['LLM_TIMEOUT_MS']
    ? parseInt(process.env['LLM_TIMEOUT_MS'], 10)
    : DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let rawResponse: AnthropicMessage;
  try {
    rawResponse = await resolvedClient.messages.create(
      {
        model: MODEL_ID,
        max_tokens: 4096,
        tools: [
          planMode
            ? {
                name: 'refactor_plan',
                description: 'The exorcism plan: characterization tests, small reversible steps and a do-not-touch list, every claim cited to the Evidence Ledger.',
                input_schema: toolInputSchema,
              }
            : {
                name: 'ghost_answer',
                description:
                  'Structured answer from the ghost persona. Must conform to GhostAnswerSchema.',
                input_schema: toolInputSchema,
              },
        ],
        // claude-sonnet-5-5 rejects forced tool_choice, so the prompt tells it to call the tool exactly once
        messages: [{ role: 'user', content: `${prompt}\n\nAnswer by calling the ${planMode ? 'refactor_plan' : 'ghost_answer'} tool exactly once. Do not reply in prose.` }],
      },
      { signal: controller.signal },
    );
  } catch (err: unknown) {
    clearTimeout(timer);
    // Check for abort / timeout
    if (
      err instanceof Error &&
      (err.name === 'AbortError' ||
        (typeof (err as unknown as Record<string, unknown>)['code'] === 'string' &&
          (err as unknown as Record<string, unknown>)['code'] === 'ABORT_ERR'))
    ) {
      throw new TimeoutError(`LLM call exceeded timeout of ${timeoutMs}ms`);
    }
    // Redact API key from error messages
    const message = err instanceof Error ? err.message : String(err);
    const redacted = message.replaceAll(apiKey, '[REDACTED]');
    throw new Error(redacted);
  }

  clearTimeout(timer);

  // Extract tool_use block
  const toolUseBlock = rawResponse.content.find((b) => b.type === 'tool_use');
  if (!toolUseBlock) {
    throw new ParseError('LLM response contained no tool_use block');
  }

  // Log DEBUG (with ledger text redacted)
  if (process.env['DEBUG']) {
    const promptRedacted = prompt.replace(
      /<evidence[^>]*>[\s\S]*?<\/evidence>/g,
      '[LEDGER REDACTED]',
    );
    console.debug('[DEBUG] ghost prompt (redacted):', promptRedacted);
    console.debug('[DEBUG] ghost answer raw:', JSON.stringify(toolUseBlock.input));
  }

  if (planMode) {
    // The plan travels through the same GhostAnswer envelope the rest of the pipeline expects:
    // one claim whose text is the plan JSON (src/exorcism/plan.ts parses and verifies every inner claim).
    return {
      voice: 'exorcist',
      sessionId,
      claims: [{ kind: 'memory', text: JSON.stringify(toolUseBlock.input), citations: [{ sha7: '0000000' }] }],
    } as GhostAnswer;
  }

  // Parse and validate
  const parsed = GhostAnswerSchema.safeParse(toolUseBlock.input);
  if (!parsed.success) {
    throw new ParseError(
      `LLM response failed GhostAnswerSchema validation: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}

// ---------------------------------------------------------------------------
// Fixture mode
// ---------------------------------------------------------------------------

async function loadFixture(prompt: string): Promise<GhostAnswer> {
  const hash = createHash('sha256').update(prompt).digest('hex').slice(0, 8);
  const fixturePath = join(FIXTURE_DIR, `${hash}.json`);

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

  const parsed = GhostAnswerSchema.safeParse(json);
  if (!parsed.success) {
    throw new ParseError(
      `Fixture file ${fixturePath} failed GhostAnswerSchema validation: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}

// ---------------------------------------------------------------------------
// JSON Schema builder
// ---------------------------------------------------------------------------

const CITATION_SCHEMA = {
  type: 'object',
  required: ['sha7'],
  properties: { sha7: { type: 'string', pattern: '^[0-9a-f]{7}$' }, quote: { type: 'string', minLength: 1 } },
};
const PLAN_CLAIM_SCHEMA = {
  type: 'object',
  required: ['kind', 'text', 'citations'],
  properties: {
    kind: { type: 'string', enum: ['memory', 'speculation'] },
    text: { type: 'string', minLength: 1 },
    citations: { type: 'array', minItems: 1, items: CITATION_SCHEMA },
  },
};

/** JSON Schema for the exorcism plan tool; matches RefactorPlanSchema in schema.ts. */
function buildRefactorPlanJsonSchema(): { type: 'object'; [k: string]: unknown } {
  return {
    type: 'object',
    required: ['characterizationTests', 'steps', 'doNotTouchList', 'summary'],
    properties: {
      characterizationTests: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1, maxLength: 512 } },
      steps: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['description', 'rationale', 'claims', 'reversible'],
          properties: {
            description: { type: 'string', minLength: 1, maxLength: 512 },
            rationale: { type: 'string', minLength: 1, maxLength: 256 },
            claims: { type: 'array', minItems: 1, items: PLAN_CLAIM_SCHEMA },
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
            lineRange: { type: 'object', required: ['start', 'end'], properties: { start: { type: 'integer', minimum: 1 }, end: { type: 'integer', minimum: 1 } } },
            reason: { type: 'string', minLength: 1, maxLength: 512 },
            claims: { type: 'array', minItems: 1, items: PLAN_CLAIM_SCHEMA },
          },
        },
      },
      summary: { type: 'string', minLength: 1, maxLength: 1024 },
    },
  };
}

/**
 * Build a JSON Schema object for the tool input_schema parameter.
 * This is hand-crafted to match GhostAnswerSchema exactly.
 */
function buildGhostAnswerJsonSchema(): {
  type: 'object';
  [k: string]: unknown;
} {
  return {
    type: 'object',
    required: ['claims', 'voice', 'sessionId'],
    properties: {
      sessionId: { type: 'string', minLength: 1 },
      voice: { type: 'string', minLength: 1 },
      claims: {
        type: 'array',
        minItems: 1,
        items: {
          oneOf: [
            {
              type: 'object',
              required: ['kind', 'text', 'citations'],
              properties: {
                kind: { type: 'string', enum: ['memory'] },
                text: { type: 'string', minLength: 1 },
                citations: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    required: ['sha7'],
                    properties: {
                      sha7: {
                        type: 'string',
                        pattern: '^[0-9a-f]{7}$',
                      },
                      quote: { type: 'string', minLength: 1 },
                    },
                  },
                },
              },
            },
            {
              type: 'object',
              required: ['kind', 'text', 'citations'],
              properties: {
                kind: { type: 'string', enum: ['speculation'] },
                text: { type: 'string', minLength: 1 },
                citations: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    required: ['sha7'],
                    properties: {
                      sha7: {
                        type: 'string',
                        pattern: '^[0-9a-f]{7}$',
                      },
                      quote: { type: 'string', minLength: 1 },
                    },
                  },
                },
              },
            },
            {
              type: 'object',
              required: ['kind', 'text', 'citations', 'silenceReason'],
              properties: {
                kind: { type: 'string', enum: ['silence'] },
                text: { type: 'string', minLength: 1 },
                citations: { type: 'array', maxItems: 0, items: {} },
                silenceReason: { type: 'string', minLength: 1 },
              },
            },
          ],
        },
      },
    },
  };
}
