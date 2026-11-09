/**
 * Security headers tests
 */

import { describe, it, expect } from 'vitest';
import app from '../../src/server.js';

describe('Security headers', () => {
  it('GET /api/health returns security headers including x-content-type-options, x-frame-options, and content-security-policy', async () => {
    const req = new Request('http://localhost/api/health');
    const res = await app.fetch(req);

    expect(res.status).toBe(200);

    // Check for x-content-type-options header
    const xContentTypeOptions = res.headers.get('x-content-type-options');
    expect(xContentTypeOptions).toBe('nosniff');

    // Check for x-frame-options header
    const xFrameOptions = res.headers.get('x-frame-options');
    expect(xFrameOptions).toBe('SAMEORIGIN');

    // Check for content-security-policy header containing frame-ancestors 'none'
    const csp = res.headers.get('content-security-policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
