/**
 * T6 API tests for POST /api/exorcise
 *
 * Uses ANTHROPIC_FIXTURE=1 and a pre-seeded session.
 * Uses an injectable fake LLM client to control exact fixture answers.
 *
 * The 429 rate-limit path for /api/exorcise is covered in test/server/ratelimit.test.ts
 * ("limits /api/exorcise with the same per-client quota").
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock buildLedger before importing server
// ---------------------------------------------------------------------------

vi.mock('../../src/evidence/ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/evidence/ledger.js')>();
  return {
    ...actual,
    buildLedger: vi.fn(),
  };
});

// Mock askGhost to control LLM output without real API calls or file fixtures
vi.mock('../../src/ghost/llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ghost/llm.js')>();
  return {
    ...actual,
    askGhost: vi.fn(),
  };
});

const llmMod = await import('../../src/ghost/llm.js');
const askGhostMock = vi.mocked(llmMod.askGhost);

const { default: app, sessions, modelLimiter } = await import('../../src/server.js');
import type { GhostAnswerWire } from '../../src/ghost/schema.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHA_40 = 'abc1234' + '0'.repeat(33);

const FIXTURE_LEDGER = {
  items: [
    Object.freeze({
      id: 'E1',
      sha: SHA_40,
      shortSha: 'abc1234',
      author: 'Ada Lovelace',
      email: 'ada@example.com',
      date: new Date('2020-01-01T00:00:00.000Z').toISOString(),
      subject: 'fix: add sleep for downstream service',
      body: 'wait for downstream to stabilise',
      hunk: '+sleep(3000);\n',
      files: ['src/utils.ts'],
      refs: [],
      suspiciousMessage: false,
    }),
  ] as const,
  truncated: false,
  buildDurationMs: 100,
};

// A valid refactor plan wrapped in the answer envelope (its envelope claim is never verified)
const VALID_PLAN_ANSWER: GhostAnswerWire = {
  claims: [
    {
      kind: 'memory',
      text: JSON.stringify({
        characterizationTests: [
          'Test that sleep(3000) is called on startup',
          'Test that downstream service responds after 3 seconds',
        ],
        steps: [
          {
            description: 'Extract sleep duration to a named constant',
            rationale: 'Makes the 3-second magic number explicit',
            claims: [
              {
                kind: 'memory',
                text: 'The 3-second wait was added to handle downstream service lag.',
                citations: [
                  { sha7: 'abc1234', quote: 'wait for downstream to stabilise' },
                ],
              },
            ],
            reversible: true,
          },
          {
            description: 'Add exponential backoff retry loop',
            rationale: 'More robust than a fixed sleep',
            claims: [
              {
                kind: 'speculation',
                text: 'The original author likely considered retries but chose sleep for simplicity.',
                citations: [
                  { sha7: 'abc1234', quote: 'add sleep for downstream service' },
                ],
              },
            ],
            reversible: true,
          },
        ],
        doNotTouchList: [
          {
            lineRange: { start: 10, end: 15 },
            reason:
              'This section handles vendor API rate limiting which returns 429 within 3 seconds.',
            claims: [
              {
                kind: 'memory',
                text: 'The vendor service returns 429 status codes within 3 seconds.',
                citations: [{ sha7: 'abc1234', quote: 'downstream' }],
              },
            ],
          },
        ],
        summary:
          'Extract the magic 3-second constant, add proper exponential backoff retries, and mark the vendor-dependent code as do-not-touch.',
      }),
      citations: [{ sha7: 'abc1234' }],
    },
  ],
  voice: 'Ada Lovelace, terse and precise',
  sessionId: '550e8400-e29b-41d4-a716-446655440000',
};

// ---------------------------------------------------------------------------
// Setup — inject a pre-seeded session directly into the session map
// ---------------------------------------------------------------------------

const KNOWN_SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';

beforeEach(() => {
  vi.clearAllMocks();
  modelLimiter.reset();
  // Inject session directly
  sessions.set(KNOWN_SESSION_ID, {
    ledger: FIXTURE_LEDGER,
    expiresAt: Date.now() + 60_000 * 30,
  });
  askGhostMock.mockResolvedValue(VALID_PLAN_ANSWER);
});

afterEach(() => {
  sessions.delete(KNOWN_SESSION_ID);
  modelLimiter.reset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/exorcise', () => {
  const validBody = {
    sessionId: KNOWN_SESSION_ID,
  };

  it('valid session returns 200 with ExorciseResponseSchema shape and verifierScore in [0,1]', async () => {
    const req = new Request('http://localhost/api/exorcise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      sessionId: string;
      score: number;
      signalBreakdown: unknown[];
      markerLocations: unknown[];
      plan: {
        characterizationTests: unknown[];
        steps: unknown[];
        doNotTouchList: unknown[];
        summary: string;
      };
      verifierScore: number;
    };

    expect(body.sessionId).toBe(KNOWN_SESSION_ID);
    expect(typeof body.score).toBe('number');
    expect(body.score).toBeGreaterThanOrEqual(0);
    expect(body.score).toBeLessThanOrEqual(100);

    expect(Array.isArray(body.signalBreakdown)).toBe(true);
    expect(body.signalBreakdown).toHaveLength(6);

    expect(Array.isArray(body.markerLocations)).toBe(true);

    expect(typeof body.plan).toBe('object');
    expect(Array.isArray(body.plan.characterizationTests)).toBe(true);
    expect(Array.isArray(body.plan.steps)).toBe(true);
    expect(Array.isArray(body.plan.doNotTouchList)).toBe(true);
    expect(typeof body.plan.summary).toBe('string');

    expect(body.verifierScore).toBeGreaterThanOrEqual(0);
    expect(body.verifierScore).toBeLessThanOrEqual(1);
  });

  it('unknown sessionId returns 404 with code SESSION_NOT_FOUND', async () => {
    const req = new Request('http://localhost/api/exorcise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'unknown-session-xyz' }),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(404);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('SESSION_NOT_FOUND');
  });

  it('missing sessionId returns 400 with code VALIDATION_ERROR', async () => {
    const req = new Request('http://localhost/api/exorcise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(400);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('negative authorGoneThresholdDays returns 400 with code VALIDATION_ERROR', async () => {
    const req = new Request('http://localhost/api/exorcise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: KNOWN_SESSION_ID, authorGoneThresholdDays: -1 }),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(400);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('plan with bad SHA has rejected claim and verifierScore < 1', async () => {
    // Create a plan that will have rejected claims during verification
    const MOCK_PLAN_WITH_BAD_SHA = JSON.stringify({
      characterizationTests: ['Test 1'],
      steps: [
        {
          description: 'Make a change',
          rationale: 'For testing rejection',
          claims: [
            {
              kind: 'memory',
              text: 'This is a claim with a bad SHA.',
              citations: [{ sha7: 'aaaa000', quote: 'wait for downstream to stabilise' }], // Not in ledger!
            },
          ],
          reversible: true,
        },
      ],
      doNotTouchList: [],
      summary: 'A test plan with an invalid SHA.',
    });

    const planWithBadSha: GhostAnswerWire = {
      claims: [
        {
          kind: 'memory',
          text: MOCK_PLAN_WITH_BAD_SHA,
          citations: [{ sha7: 'abc1234' }],
        },
      ],
      voice: 'Ada Lovelace',
      sessionId: KNOWN_SESSION_ID,
    };

    askGhostMock.mockResolvedValue(planWithBadSha);

    const req = new Request('http://localhost/api/exorcise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      plan: {
        steps: Array<{
          claims: unknown[];
          rejectedClaims: Array<{ text: string; reason: string }>;
        }>;
      };
      verifierScore: number;
    };

    // First step should have a rejected claim
    const firstStep = body.plan.steps[0];
    expect(firstStep?.rejectedClaims).toBeDefined();
    expect(firstStep?.rejectedClaims.length).toBeGreaterThan(0);

    // verifierScore should be less than 1 since there's a rejected claim
    expect(body.verifierScore).toBeLessThan(1);
  });
});
