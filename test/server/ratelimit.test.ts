/**
 * Integration tests for rate-limit middleware on POST /api/ask and /api/exorcise.
 *
 * Uses ANTHROPIC_FIXTURE=1 (mocked LLM) and X-Forwarded-For to simulate clients.
 * Resets the modelLimiter between tests to avoid cross-test interference.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock buildLedger and askGhost before importing server
// ---------------------------------------------------------------------------

vi.mock('../../src/evidence/ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/evidence/ledger.js')>();
  return { ...actual, buildLedger: vi.fn() };
});

vi.mock('../../src/ghost/llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ghost/llm.js')>();
  return { ...actual, askGhost: vi.fn() };
});

vi.mock('../../src/exorcism/plan.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/exorcism/plan.js')>();
  return { ...actual, buildPlan: vi.fn() };
});

const llmMod = await import('../../src/ghost/llm.js');
const askGhostMock = vi.mocked(llmMod.askGhost);

const planMod = await import('../../src/exorcism/plan.js');
const buildPlanMock = vi.mocked(planMod.buildPlan);

const { default: app, sessions, modelLimiter } = await import('../../src/server.js');
import type { GhostAnswer } from '../../src/ghost/schema.js';

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const SESSION_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

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

const VALID_GHOST_ANSWER: GhostAnswer = {
  claims: [
    {
      kind: 'memory',
      text: 'I added the sleep because the downstream service was not ready.',
      citations: [{ sha7: 'abc1234', quote: 'wait for downstream to stabilise' }],
    },
  ],
  voice: 'Ada Lovelace',
  sessionId: SESSION_ID,
};

const FIXTURE_PLAN = {
  characterizationTests: [],
  steps: [],
  doNotTouchList: [],
  summary: 'No action needed.',
  verifierScore: 1,
};

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

function seedSession(): void {
  sessions.set(SESSION_ID, {
    ledger: FIXTURE_LEDGER,
    expiresAt: Date.now() + 60_000 * 30,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function askRequest(xff?: string): Request {
  return new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(xff ? { 'X-Forwarded-For': xff } : {}),
    },
    body: JSON.stringify({ sessionId: SESSION_ID, question: 'Why?' }),
  });
}

function exorciseRequest(xff?: string): Request {
  return new Request('http://localhost/api/exorcise', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(xff ? { 'X-Forwarded-For': xff } : {}),
    },
    body: JSON.stringify({ sessionId: SESSION_ID }),
  });
}

function wardRequest(): Request {
  return new Request('http://localhost/api/ward', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: SESSION_ID, answer: VALID_GHOST_ANSWER }),
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  modelLimiter.reset();
  seedSession();
  askGhostMock.mockResolvedValue(VALID_GHOST_ANSWER);
  buildPlanMock.mockResolvedValue(FIXTURE_PLAN);
});

afterEach(() => {
  sessions.delete(SESSION_ID);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Rate-limit middleware', () => {
  it('allows the first RATE_LIMIT_MAX requests from one IP on /api/ask', async () => {
    const max = parseInt(process.env['RATE_LIMIT_MAX'] ?? '10', 10);
    const ip = '5.5.5.5';

    for (let i = 0; i < max; i++) {
      seedSession(); // refresh session so it doesn't expire between requests
      const res = await app.fetch(askRequest(ip));
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 with RATE_LIMITED code on the (max+1)th request', async () => {
    const max = parseInt(process.env['RATE_LIMIT_MAX'] ?? '10', 10);
    const ip = '6.6.6.6';

    for (let i = 0; i < max; i++) {
      seedSession();
      await app.fetch(askRequest(ip));
    }

    seedSession();
    const res = await app.fetch(askRequest(ip));
    expect(res.status).toBe(429);

    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('RATE_LIMITED');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('returns a Retry-After header (whole seconds >= 1) on 429', async () => {
    const max = parseInt(process.env['RATE_LIMIT_MAX'] ?? '10', 10);
    const ip = '7.7.7.7';

    for (let i = 0; i < max; i++) {
      seedSession();
      await app.fetch(askRequest(ip));
    }

    seedSession();
    const res = await app.fetch(askRequest(ip));
    expect(res.status).toBe(429);

    const retryAfter = res.headers.get('Retry-After');
    expect(retryAfter).not.toBeNull();
    expect(parseInt(retryAfter!, 10)).toBeGreaterThanOrEqual(1);
  });

  it('a different IP is not limited when first IP is exhausted', async () => {
    const max = parseInt(process.env['RATE_LIMIT_MAX'] ?? '10', 10);
    const ip1 = '8.8.8.8';
    const ip2 = '9.9.9.9';

    for (let i = 0; i < max; i++) {
      seedSession();
      await app.fetch(askRequest(ip1));
    }

    seedSession();
    const res = await app.fetch(askRequest(ip2));
    expect(res.status).toBe(200);
  });

  it('rejected request does not call the model (R1.6)', async () => {
    const max = parseInt(process.env['RATE_LIMIT_MAX'] ?? '10', 10);
    const ip = '10.10.10.10';

    for (let i = 0; i < max; i++) {
      seedSession();
      await app.fetch(askRequest(ip));
    }

    askGhostMock.mockClear();
    seedSession();
    await app.fetch(askRequest(ip));
    expect(askGhostMock).not.toHaveBeenCalled();
  });

  it('limits /api/exorcise with the same per-client quota', async () => {
    const max = parseInt(process.env['RATE_LIMIT_MAX'] ?? '10', 10);
    const ip = '11.11.11.11';

    for (let i = 0; i < max; i++) {
      seedSession();
      await app.fetch(exorciseRequest(ip));
    }

    seedSession();
    const res = await app.fetch(exorciseRequest(ip));
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('RATE_LIMITED');
  });

  it('/api/ward is NOT limited', async () => {
    const max = parseInt(process.env['RATE_LIMIT_MAX'] ?? '10', 10);
    const ip = '12.12.12.12';

    // Exhaust the quota on /api/ask
    for (let i = 0; i < max; i++) {
      seedSession();
      await app.fetch(askRequest(ip));
    }

    // /api/ward should still respond (not rate-limited, just 200 or non-429)
    seedSession();
    const res = await app.fetch(wardRequest());
    expect(res.status).not.toBe(429);
  });

  it('error text on client limit matches the app voice', async () => {
    const max = parseInt(process.env['RATE_LIMIT_MAX'] ?? '10', 10);
    const ip = '13.13.13.13';

    for (let i = 0; i < max; i++) {
      seedSession();
      await app.fetch(askRequest(ip));
    }

    seedSession();
    const res = await app.fetch(askRequest(ip));
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('spirits');
  });
});
