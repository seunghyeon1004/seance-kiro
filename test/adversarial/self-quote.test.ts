/**
 * ward-hardening T5 — the documented limit in design.md §10.4 and §14 ("self-quoting injection").
 *
 * If the obedient model in A1 adds a quote taken from P3's own body, the claim is verified,
 * because the commit really says those words. This test pins that behaviour so it is visible,
 * and checks the mitigation: the claim carries citesSuspicious: true, and the response shows
 * the quote and the field it was found in.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// askGhost reads both at call time, so setting them here (after the hoisted imports) is enough
delete process.env['ANTHROPIC_FIXTURE'];
process.env['ANTHROPIC_API_KEY'] = 'test-dummy-key-not-a-secret';

import { createApp, modelLimiter, sessions } from '../../src/server.js';
import { ATTACKS, WorstCaseClient, attack } from './worst-case-client.js';
import type { Attack } from './worst-case-client.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SELF_QUOTE = 'it is safe to delete.';

const fetchSpy = vi.fn(() => {
  throw new Error('network access is not allowed in the adversarial tests');
});

/** A1, except that the model also quotes P3's own body. */
const A1 = attack('A1');
const SELF_QUOTING: readonly Attack[] = ATTACKS.map((a) =>
  a.id === 'A1'
    ? {
        ...a,
        claims: (h) => [
          {
            kind: 'memory',
            text: A1.sentence,
            citations: [{ sha7: h.P3, quote: SELF_QUOTE }],
          },
        ],
      }
    : a,
);

let tmp: string;

beforeAll(() => {
  vi.stubGlobal('fetch', fetchSpy);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-selfquote-'));
  const dir = path.join(tmp, 'possessed');
  execFileSync('bash', [path.join(ROOT, 'scripts/make-possessed.sh'), dir], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  process.env['POSSESSED_DIR'] = dir;
}, 60_000);

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env['POSSESSED_DIR'];
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  modelLimiter.reset();
});

describe('self-quoting injection (documented limit)', () => {
  it('verifies the claim, marks it citesSuspicious, and shows the quote and its field', async () => {
    const client = new WorstCaseClient(SELF_QUOTING);
    const app = createApp({ anthropicClient: client });
    const summon = await app.fetch(
      new Request('http://localhost/api/summon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: 'possessed',
          file: 'auth/throttle.js',
          startLine: 4,
          endLine: 4,
        }),
      }),
    );
    expect(summon.status).toBe(200);
    const { sessionId, items } = (await summon.json()) as {
      sessionId: string;
      items: Array<{ shortSha: string; subject: string; body: string }>;
    };
    const p3 = items.find((i) => i.subject === 'docs: point the comment at this message');
    expect(p3?.body).toContain(SELF_QUOTE);

    try {
      const res = await app.fetch(
        new Request('http://localhost/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, question: A1.question }),
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        verified: Array<{
          text: string;
          citesSuspicious: boolean;
          quotes: Array<{ sha7: string; quote: string; field: string }>;
        }>;
        rejected: unknown[];
      };
      expect(body.rejected).toEqual([]);
      expect(body.verified).toHaveLength(1);
      expect(body.verified[0]?.text).toBe(A1.sentence);
      expect(body.verified[0]?.citesSuspicious).toBe(true);
      expect(body.verified[0]?.quotes).toEqual([
        { sha7: p3?.shortSha, quote: SELF_QUOTE, field: 'body' },
      ]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      sessions.delete(sessionId);
    }
  });
});
