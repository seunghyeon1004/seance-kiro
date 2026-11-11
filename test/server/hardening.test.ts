/**
 * ward-hardening T6 — input and abuse limits on the server (design.md §8, §13.1, R10.1–R10.8).
 *
 * buildLedger (git) and askGhost (the model) are mocked; the middleware, limiters, clone
 * pool, session map and error mapping are real. The environment is set before the server
 * module loads, because the pool size, the daily model cap and CRYPT_DIR are read at import:
 *   MAX_CONCURRENT_CLONES=1      one remote clone at a time (R10.6)
 *   MAX_MODEL_CALLS_PER_DAY=1    a single model call left today, so any request that touched
 *                                the model limiter's daily counter would make /api/ask fail
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CloneError, GitError } from '../../src/errors.js';
import type { GhostAnswerWire, LedgerResult } from '../../src/ghost/schema.js';

vi.mock('../../src/evidence/ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/evidence/ledger.js')>();
  return { ...actual, buildLedger: vi.fn() };
});
vi.mock('../../src/ghost/llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ghost/llm.js')>();
  return { ...actual, askGhost: vi.fn() };
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-hardening-'));
const CRYPT = path.join(tmp, 'crypt');
const POSSESSED = path.join(tmp, 'possessed');
fs.mkdirSync(path.join(CRYPT, '.git'), { recursive: true });
fs.mkdirSync(path.join(POSSESSED, '.git'), { recursive: true });
process.env['CRYPT_DIR'] = CRYPT;
process.env['POSSESSED_DIR'] = POSSESSED;
process.env['MAX_CONCURRENT_CLONES'] = '1';
process.env['MAX_MODEL_CALLS_PER_DAY'] = '1';

const ledgerMod = await import('../../src/evidence/ledger.js');
const buildLedgerMock = vi.mocked(ledgerMod.buildLedger);
const llmMod = await import('../../src/ghost/llm.js');
const askGhostMock = vi.mocked(llmMod.askGhost);
const server = await import('../../src/server.js');
const {
  default: app,
  sessions,
  modelLimiter,
  summonLimiter,
  wardLimiter,
  clonePool,
} = server;

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LEDGER: LedgerResult = {
  items: [
    Object.freeze({
      id: 'E1',
      sha: 'abc1234' + '0'.repeat(33),
      shortSha: 'abc1234',
      author: 'Ada Lovelace',
      email: 'ada@example.com',
      date: '2020-01-01T00:00:00.000Z',
      subject: 'fix: add sleep for downstream service',
      body: 'wait for downstream to stabilise',
      hunk: '+sleep(3000);\n',
      files: ['src/utils.ts'],
      refs: [],
      suspiciousMessage: false,
    }),
  ],
  truncated: false,
  buildDurationMs: 1,
};

const CLAIM = {
  kind: 'memory',
  text: 'I added the sleep for the downstream service.',
  citations: [{ sha7: 'abc1234', quote: 'wait for downstream to stabilise' }],
};

const SESSION_ID = 'hardening-session';

const ANSWER: GhostAnswerWire = {
  claims: [CLAIM],
  voice: 'Ada',
  sessionId: SESSION_ID,
};

const REMOTE = {
  repoUrl: 'https://github.com/owner/repo',
  file: 'src/utils.ts',
  startLine: 1,
  endLine: 10,
};

function post(route: string, body: unknown, xff = '203.0.113.7'): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://localhost${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    ),
  );
}

function seedSession(): void {
  sessions.set(SESSION_ID, { ledger: LEDGER, expiresAt: Date.now() + 60_000 * 30 });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  modelLimiter.reset();
  summonLimiter.reset();
  wardLimiter.reset();
  clonePool.reset();
  sessions.clear();
  buildLedgerMock.mockResolvedValue(LEDGER);
  askGhostMock.mockResolvedValue(ANSWER);
});

// ---------------------------------------------------------------------------
// R10.1 — validateLedgerInput runs before git
// ---------------------------------------------------------------------------

describe('summon input validation (R10.1)', () => {
  it.each([
    ['a file with ..', { ...REMOTE, file: '../../etc/passwd' }],
    ['an absolute file', { ...REMOTE, file: '/etc/passwd' }],
    ['a 501-line range', { ...REMOTE, startLine: 1, endLine: 501 }],
  ])('%s returns 400 VALIDATION_ERROR without running git', async (_label, body) => {
    const res = await post('/api/summon', body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
    expect(buildLedgerMock).not.toHaveBeenCalled();
    expect(clonePool.inUse()).toBe(0);
  });

  it('a 500-line range is still accepted', async () => {
    const res = await post('/api/summon', { ...REMOTE, startLine: 1, endLine: 500 });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// R10.2 — fixed git messages, full error on the server log
// ---------------------------------------------------------------------------

describe('git and clone failures (R10.2)', () => {
  it.each([
    [
      'GitError',
      new GitError(
        "git blame -L 1,10 -- src/utils.ts failed in /tmp/seance-x1y2z3: fatal: no such path 'src/utils.ts'",
      ),
      'GIT_ERROR',
      'Git could not read that file and line range. Check the file path and the line numbers.',
    ],
    [
      'CloneError',
      new CloneError(
        'git clone --filter=blob:none https://github.com/owner/repo /tmp/seance-clone-abc exceeded 200 MB',
      ),
      'CLONE_ERROR',
      'The repository could not be cloned. It may be private, missing, too large or too slow to download.',
    ],
  ])('%s returns 422 with the fixed message', async (_label, err, code, message) => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    buildLedgerMock.mockRejectedValueOnce(err);

    const res = await post('/api/summon', REMOTE);
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ code, message });
    expect(text).not.toContain('/tmp');
    expect(text).not.toContain('seance-');
    expect(text).not.toContain('git ');

    expect(logSpy).toHaveBeenCalledWith('[seance] git failure', {
      code,
      message: err.message,
    });
  });
});

// ---------------------------------------------------------------------------
// R10.3 — body limit before every limiter
// ---------------------------------------------------------------------------

describe('body limit (R10.3)', () => {
  const big = JSON.stringify({ sessionId: SESSION_ID, question: 'x'.repeat(70 * 1024) });

  it('a 70 KB body to /api/ask returns 413 and leaves the model limiter unchanged', async () => {
    seedSession();
    const res = await post('/api/ask', big);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe('PAYLOAD_TOO_LARGE');
    expect(modelLimiter.size()).toBe(0);
    expect(askGhostMock).not.toHaveBeenCalled();

    // The one model call allowed today is still available: the daily counter was not touched
    const ok = await post('/api/ask', { sessionId: SESSION_ID, question: 'Why?' });
    expect(ok.status).toBe(200);
  });

  it.each(['/api/summon', '/api/ward', '/api/exorcise'])(
    'a 70 KB body to %s returns 413 PAYLOAD_TOO_LARGE before any limiter',
    async (route) => {
      const res = await post(route, big);
      expect(res.status).toBe(413);
      expect(((await res.json()) as { code: string }).code).toBe('PAYLOAD_TOO_LARGE');
      expect(modelLimiter.size()).toBe(0);
      expect(summonLimiter.size()).toBe(0);
      expect(wardLimiter.size()).toBe(0);
      expect(buildLedgerMock).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------
// R10.4 — claim count on /api/ward
// ---------------------------------------------------------------------------

describe('/api/ward claim count (R10.4)', () => {
  it('51 claims return 400', async () => {
    seedSession();
    const res = await post('/api/ward', {
      sessionId: SESSION_ID,
      answer: { ...ANSWER, claims: Array.from({ length: 51 }, () => CLAIM) },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('50 claims are accepted', async () => {
    seedSession();
    const res = await post('/api/ward', {
      sessionId: SESSION_ID,
      answer: { ...ANSWER, claims: Array.from({ length: 50 }, () => CLAIM) },
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// R10.5 — summon limiter
// ---------------------------------------------------------------------------

describe('summon limiter (R10.5)', () => {
  it('the 21st summon returns 429 RATE_LIMITED with Retry-After; the model limiter is untouched', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await post('/api/summon', REMOTE, '198.51.100.1');
      expect(res.status, `summon ${i + 1}`).toBe(200);
    }
    const res = await post('/api/summon', REMOTE, '198.51.100.1');
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.error).toBe(
      'Too many summonings from here. Wait a few minutes and try again.',
    );
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(buildLedgerMock).toHaveBeenCalledTimes(20);
    expect(modelLimiter.size()).toBe(0);

    // Another client is not limited
    const other = await post('/api/summon', REMOTE, '198.51.100.2');
    expect(other.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// R10.6 — clone slots
// ---------------------------------------------------------------------------

describe('clone slots (R10.6, MAX_CONCURRENT_CLONES=1)', () => {
  it('a second remote summon during a slow clone returns 503 BUSY; samples take no slot', async () => {
    let finish: (() => void) | undefined;
    buildLedgerMock.mockImplementationOnce(
      () =>
        new Promise<LedgerResult>((resolve) => {
          finish = () => resolve(LEDGER);
        }),
    );

    const first = post('/api/summon', REMOTE);
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(clonePool.inUse()).toBe(1);

    const second = await post('/api/summon', REMOTE);
    expect(second.status).toBe(503);
    expect(second.headers.get('Retry-After')).toBe('30');
    expect(await second.json()).toEqual({
      code: 'BUSY',
      message: 'Too many repositories are being cloned right now. Try again in a minute.',
    });
    expect(buildLedgerMock).toHaveBeenCalledTimes(1);

    // crypt and possessed do not need a slot
    for (const repoUrl of ['crypt', 'possessed']) {
      const res = await post('/api/summon', { ...REMOTE, repoUrl });
      expect(res.status, repoUrl).toBe(200);
    }
    expect(clonePool.inUse()).toBe(1);

    finish?.();
    expect((await first).status).toBe(200);
    expect(clonePool.inUse()).toBe(0);

    const third = await post('/api/summon', REMOTE);
    expect(third.status).toBe(200);
    expect(clonePool.inUse()).toBe(0);
  });

  it('a failed clone releases its slot', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    buildLedgerMock.mockRejectedValueOnce(new CloneError('too large'));
    expect((await post('/api/summon', REMOTE)).status).toBe(422);
    expect(clonePool.inUse()).toBe(0);
    expect((await post('/api/summon', REMOTE)).status).toBe(200);
  });

  it('a clone that throws releases its slot', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    buildLedgerMock.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect((await post('/api/summon', REMOTE)).status).toBe(500);
    expect(clonePool.inUse()).toBe(0);
    expect((await post('/api/summon', REMOTE)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// R10.7 — session cap
// ---------------------------------------------------------------------------

describe('session cap (R10.7, SESSION_MAX=500)', () => {
  it('the 501st session evicts the first', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 501; i++) {
      summonLimiter.reset();
      const res = await post('/api/summon', REMOTE);
      expect(res.status).toBe(200);
      ids.push(((await res.json()) as { sessionId: string }).sessionId);
    }
    expect(sessions.size).toBe(500);
    expect(sessions.has(ids[0]!)).toBe(false);
    expect(sessions.has(ids[1]!)).toBe(true);
    expect(sessions.has(ids[500]!)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R10.8 — ward limiter, apart from the model limiter
// ---------------------------------------------------------------------------

describe('ward limiter (R10.8)', () => {
  it('after 61 ward calls the last returns 429, and /api/ask still succeeds', async () => {
    seedSession();
    const ward = () => post('/api/ward', { sessionId: SESSION_ID, answer: ANSWER });
    for (let i = 0; i < 60; i++) {
      expect((await ward()).status, `ward ${i + 1}`).toBe(200);
    }
    const last = await ward();
    expect(last.status).toBe(429);
    const body = (await last.json()) as { code: string; error: string };
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.error).toBe(
      'The ward needs a short rest. Wait a few minutes before sending more claims.',
    );
    expect(Number(last.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);

    // Per-client counters of the model limiter: untouched
    expect(modelLimiter.size()).toBe(0);
    // Daily counter: the single model call allowed today is still available
    const ask = await post('/api/ask', { sessionId: SESSION_ID, question: 'Why?' });
    expect(ask.status).toBe(200);
    expect(modelLimiter.size()).toBe(1);
  });
});
