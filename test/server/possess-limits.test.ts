/**
 * first-seance T8 — /api/possess and the limiters (design.md §16.8, R13.4).
 *
 * WARD_RATE_LIMIT_MAX=3, RATE_LIMIT_MAX=1 and MAX_MODEL_CALLS_PER_DAY=1 are set before
 * src/server.ts loads, because the limiters read them once. RECORDINGS_DIR points at an empty
 * temp dir, so no shipped recording can answer the ask below. The ask runs the real askGhost
 * with the scripted WorstCaseClient. No test calls the model or the network.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorstCaseClient } from '../adversarial/worst-case-client.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-possess-limits-'));
const POSSESSED = path.join(TMP, 'possessed');
const REC = path.join(TMP, 'recordings');
fs.mkdirSync(REC);
execFileSync('bash', [path.join(ROOT, 'scripts/make-possessed.sh'), POSSESSED], {
  cwd: ROOT,
});
process.env['POSSESSED_DIR'] = POSSESSED;
process.env['WARD_RATE_LIMIT_MAX'] = '3';
process.env['RATE_LIMIT_MAX'] = '1';
process.env['MAX_MODEL_CALLS_PER_DAY'] = '1';
process.env['RECORDINGS_DIR'] = REC;

const server = await import('../../src/server.js');
const client = new WorstCaseClient();
const app = server.createApp({ anthropicClient: client });

const WARD_MESSAGE =
  'The ward needs a short rest. Wait a few minutes before sending more claims.';

function post(route: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(() => {
  process.env['ANTHROPIC_API_KEY'] = 'test-dummy-key-not-a-secret';
  delete process.env['ANTHROPIC_FIXTURE'];
  server.modelLimiter.reset();
  server.summonLimiter.reset();
  server.wardLimiter.reset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
  vi.restoreAllMocks();
  for (const k of [
    'POSSESSED_DIR',
    'WARD_RATE_LIMIT_MAX',
    'RATE_LIMIT_MAX',
    'MAX_MODEL_CALLS_PER_DAY',
    'RECORDINGS_DIR',
    'ANTHROPIC_API_KEY',
  ]) {
    delete process.env[k];
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('/api/possess uses the ward limiter only (R13.4)', { timeout: 30_000 }, () => {
  it('the fourth possess is refused by the ward limiter; the model limiter has not moved', async () => {
    const s = await post('/api/summon', {
      repoUrl: 'possessed',
      file: 'auth/throttle.js',
      startLine: 4,
      endLine: 4,
    });
    expect(s.status).toBe(200);
    const sessionId = ((await s.json()) as { sessionId: string }).sessionId;

    for (let i = 0; i < 3; i++) {
      const res = await post('/api/possess', { sessionId });
      expect(res.status, `possess ${i + 1}`).toBe(200);
    }
    const refused = await post('/api/possess', { sessionId });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: WARD_MESSAGE, code: 'RATE_LIMITED' });
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(client.calls).toHaveLength(0);

    // neither the per-client nor the daily model counter moved
    const ask1 = await post('/api/ask', {
      sessionId,
      question: 'Can I delete this wait?',
    });
    expect(ask1.status).toBe(200);
    expect(client.calls).toHaveLength(1);
    // and the model limits are active
    const ask2 = await post('/api/ask', {
      sessionId,
      question: 'Can I delete this wait?',
    });
    expect(ask2.status).toBe(429);
    expect(((await ask2.json()) as { code: string }).code).toBe('RATE_LIMITED');
    expect(client.calls).toHaveLength(1);
  });
});
