/**
 * T9 tests for GET /api/health
 */

import { describe, it, expect } from 'vitest';
import app from '../../src/server.js';

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
});
