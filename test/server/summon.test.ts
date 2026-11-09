/**
 * T7 API tests for POST /api/summon
 *
 * Uses mocked buildLedger so no real git calls happen.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitError } from '../../src/errors.js';

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

const ledgerMod = await import('../../src/evidence/ledger.js');
const buildLedgerMock = vi.mocked(ledgerMod.buildLedger);

// Import server after mocking its dependency
const { default: app } = await import('../../src/server.js');

// ---------------------------------------------------------------------------
// Fixture ledger result
// ---------------------------------------------------------------------------

const FIXTURE_LEDGER = {
  items: [
    Object.freeze({
      id: 'E1',
      sha: 'abc1234' + '0'.repeat(33),
      shortSha: 'abc1234',
      author: 'Ada Lovelace',
      email: 'ada@example.com',
      date: new Date('2020-01-01T00:00:00.000Z').toISOString(),
      subject: 'fix: add sleep',
      body: 'wait for downstream',
      hunk: '+sleep(3000);\n',
      files: ['src/utils.ts'],
      refs: [],
      suspiciousMessage: false,
    }),
  ] as const,
  truncated: false,
  buildDurationMs: 100,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  buildLedgerMock.mockResolvedValue(FIXTURE_LEDGER);
});

describe('POST /api/summon', () => {
  const validBody = {
    repoUrl: 'https://github.com/owner/repo',
    file: 'src/utils.ts',
    startLine: 1,
    endLine: 10,
  };

  it('returns 200 with a UUID sessionId and correct shape for a valid request', async () => {
    const req = new Request('http://localhost/api/summon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      sessionId: string;
      ledgerSize: number;
      truncated: boolean;
      buildDurationMs: number;
    };

    // UUID v4 pattern
    expect(body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(body.ledgerSize).toBe(1);
    expect(body.truncated).toBe(false);
    expect(typeof body.buildDurationMs).toBe('number');
  });

  it('returns 400 + VALIDATION_ERROR when body is missing required field (file)', async () => {
    const { file: _, ...noFile } = validBody;
    const req = new Request('http://localhost/api/summon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(noFile),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(400);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 + VALIDATION_ERROR for a non-GitHub URL', async () => {
    const req = new Request('http://localhost/api/summon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, repoUrl: 'https://gitlab.com/owner/repo' }),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(400);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 + GIT_ERROR when buildLedger throws GitError', async () => {
    buildLedgerMock.mockRejectedValueOnce(new GitError('git subprocess failed'));

    const req = new Request('http://localhost/api/summon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(422);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('GIT_ERROR');
  });

  it('returns 400 + VALIDATION_ERROR when endLine < startLine (inverted range)', async () => {
    const req = new Request('http://localhost/api/summon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, startLine: 9, endLine: 2 }),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(400);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 + VALIDATION_ERROR for invalid JSON body', async () => {
    const req = new Request('http://localhost/api/summon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(400);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});
