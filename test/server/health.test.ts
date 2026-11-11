/**
 * T9 tests for GET /api/health
 *
 * first-seance T1: the response also carries `model` and `samples` (R5.1), and parses with
 * HealthResponseSchema (N3). The per-sample cases are in test/server/first-seance.test.ts.
 */

import { describe, it, expect } from 'vitest';
import app from '../../src/server.js';
import { HealthResponseSchema } from '../../src/ghost/schema.js';

describe('GET /api/health', () => {
  it('returns 200 with status "ok" and a non-negative uptime', async () => {
    const req = new Request('http://localhost/api/health');
    const res = await app.fetch(req);

    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; uptime: number };
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('carries model and samples and parses with HealthResponseSchema (R5.1)', async () => {
    const res = await app.fetch(new Request('http://localhost/api/health'));
    const body = HealthResponseSchema.parse(await res.json());
    expect(typeof body.model).toBe('boolean');
    expect(Array.isArray(body.samples)).toBe(true);
    for (const s of body.samples) expect(['crypt', 'possessed']).toContain(s);
  });
});
