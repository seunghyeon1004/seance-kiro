/**
 * T8 API tests for POST /api/ask
 *
 * Uses ANTHROPIC_FIXTURE=1 and a pre-seeded session.
 * Uses an injectable fake LLM client to control exact fixture answers.
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

const { default: app, sessions } = await import('../../src/server.js');
import type { GhostAnswer } from '../../src/ghost/schema.js';

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
  voice: 'Ada Lovelace, terse and precise',
  sessionId: 'pre-seeded-session',
};

const GHOST_ANSWER_WITH_BAD_SHA: GhostAnswer = {
  claims: [
    {
      kind: 'memory',
      text: 'This claim has an invalid SHA.',
      citations: [{ sha7: 'zzz9999' }], // not in ledger
    },
  ],
  voice: 'Ada Lovelace, terse and precise',
  sessionId: 'pre-seeded-session',
};

// ---------------------------------------------------------------------------
// Setup — inject a pre-seeded session directly into the session map
// ---------------------------------------------------------------------------

const KNOWN_SESSION_ID = 'pre-seeded-session';

beforeEach(() => {
  vi.clearAllMocks();
  // Inject session directly
  sessions.set(KNOWN_SESSION_ID, {
    ledger: FIXTURE_LEDGER,
    expiresAt: Date.now() + 60_000 * 30,
  });
  askGhostMock.mockResolvedValue(VALID_GHOST_ANSWER);
});

afterEach(() => {
  sessions.delete(KNOWN_SESSION_ID);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/ask', () => {
  const validBody = {
    sessionId: KNOWN_SESSION_ID,
    question: 'Why is there a sleep(3000) on line 27?',
  };

  it('returns 200 with valid VerifiedAnswerResponse shape and score in [0, 1]', async () => {
    const req = new Request('http://localhost/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      sessionId: string;
      voice: string;
      verified: unknown[];
      rejected: unknown[];
      score: number;
    };

    expect(body.sessionId).toBe(KNOWN_SESSION_ID);
    expect(typeof body.voice).toBe('string');
    expect(Array.isArray(body.verified)).toBe(true);
    expect(Array.isArray(body.rejected)).toBe(true);
    expect(body.score).toBeGreaterThanOrEqual(0);
    expect(body.score).toBeLessThanOrEqual(1);
  });

  it('returns 404 + SESSION_NOT_FOUND for an unknown sessionId', async () => {
    const req = new Request('http://localhost/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'unknown-session-xyz', question: 'Why?' }),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(404);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns 400 + VALIDATION_ERROR when question exceeds 1000 chars', async () => {
    const req = new Request('http://localhost/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: KNOWN_SESSION_ID, question: 'x'.repeat(1001) }),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(400);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('places claim with bad SHA in rejected[] with reason', async () => {
    askGhostMock.mockResolvedValue(GHOST_ANSWER_WITH_BAD_SHA);

    const req = new Request('http://localhost/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      verified: unknown[];
      rejected: Array<{ text: string; reason: string; kind: string }>;
      score: number;
    };

    expect(body.verified).toHaveLength(0);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0]?.reason).toContain('zzz9999');
    expect(body.score).toBe(0);
  });

  it('returns 400 + VALIDATION_ERROR for missing sessionId', async () => {
    const req = new Request('http://localhost/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Why?' }),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(400);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});
