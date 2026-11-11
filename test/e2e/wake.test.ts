/**
 * DOM end-to-end, not a rendering test. public/index.html runs in jsdom with public/app.js evaluated
 * unmodified; every request goes to the real createApp() in process (real git, ledger, ward, plan
 * verification). Only the model is scripted. No browser is launched, so layout, focus rings, colour
 * and motion are not checked here. Stubbed: fetch (in process), matchMedia, scrollIntoView, timers.
 *
 * first-seance T5 — flow 4, the sleepy host (design.md §10.3, R5.4–R5.6, R11.3). The harness
 * `proxy` plays a sleeping Render proxy that answers with an HTML 502 page before the request
 * reaches the server. The window's timers are Node's, faked with vi.useFakeTimers() after the
 * health call, so the retry delays are checked to the millisecond.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { CryptClient, buildSamples, norm, openPage } from './harness.js';
import type { Page, ProxyRequest, Samples } from './harness.js';

const WAKE_TEXT =
  'Waking the spirits. The free server sleeps when idle; this can take up to a minute.';

let samples: Samples;
let page: Page | undefined;

beforeAll(() => {
  samples = buildSamples();
}, 60_000);

afterAll(() => {
  if (samples) fs.rmSync(samples.root, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
  page?.close();
  page = undefined;
});

const summonAttempts = (p: Page): number =>
  p.requests.filter((r) => r.path === '/api/summon').length;

/** Let the page's promise chains settle without moving the fake clock. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

describe('flow 4: the sleepy host', { timeout: 30_000 }, () => {
  it('retries a proxy 502 after 2,000 ms and then 5,000 ms, says why, and completes', async () => {
    const proxy = (req: ProxyRequest): Response | undefined =>
      req.path === '/api/summon' && req.attempt <= 2
        ? new Response('<!doctype html><title>502</title>', {
            status: 502,
            headers: { 'content-type': 'text/html' },
          })
        : undefined;
    page = await openPage({
      samples,
      client: new CryptClient(),
      proxy,
      nodeTimers: true,
    });
    const p = page;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    p.submit('summon-form');
    await vi.advanceTimersByTimeAsync(0);
    await p.until(
      () => p.$('summon-status').textContent === WAKE_TEXT,
      'the wake-up text',
    );
    expect(summonAttempts(p)).toBe(1);
    expect(p.requests.at(-1)?.status).toBe(502);

    await vi.advanceTimersByTimeAsync(1_999);
    await settle();
    expect(summonAttempts(p)).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await p.until(() => summonAttempts(p) === 2, 'the second attempt');
    expect(p.requests.at(-1)?.status).toBe(502);
    expect(p.$('summon-status').textContent).toBe(WAKE_TEXT);

    await vi.advanceTimersByTimeAsync(4_999);
    await settle();
    expect(summonAttempts(p)).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await p.until(() => !p.$('seance').hidden, 'the séance', 20_000);
    expect(summonAttempts(p)).toBe(3);
    expect(p.requests.at(-1)?.status).toBe(200);
    expect(norm(p.$('summon-status').textContent)).toBe(
      'Found 2 commits. The séance is open below.',
    );
    expect(p.$('summon-err').hidden).toBe(true);
  });

  it('never retries our own JSON 503', async () => {
    const message = 'The spirits are busy. Try again in a minute.';
    const proxy = (req: ProxyRequest): Response | undefined =>
      req.path === '/api/summon'
        ? Response.json({ code: 'BUSY', message }, { status: 503 })
        : undefined;
    page = await openPage({
      samples,
      client: new CryptClient(),
      proxy,
      nodeTimers: true,
    });
    const p = page;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    p.submit('summon-form');
    await p.until(() => !p.$('summon-err').hidden, 'the error');
    await vi.advanceTimersByTimeAsync(20_000);
    await settle();
    expect(summonAttempts(p)).toBe(1);
    expect(p.$('summon-err').textContent).toBe(message);
    expect(p.$('summon-status').textContent).not.toBe(WAKE_TEXT);
    expect(p.$('seance').hidden).toBe(true);
  });

  it('after three failed retries, says the server could not be reached', async () => {
    const proxy = (req: ProxyRequest): Response | undefined =>
      req.path === '/api/summon'
        ? new Response('<html>504</html>', { status: 504 })
        : undefined;
    page = await openPage({
      samples,
      client: new CryptClient(),
      proxy,
      nodeTimers: true,
    });
    const p = page;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    p.submit('summon-form');
    await vi.advanceTimersByTimeAsync(0);
    await p.until(() => summonAttempts(p) === 1, 'the first attempt');
    for (const [ms, n] of [
      [2_000, 2],
      [5_000, 3],
      [10_000, 4],
    ] as const) {
      await vi.advanceTimersByTimeAsync(ms);
      await p.until(() => summonAttempts(p) === n, `attempt ${n}`);
    }
    await p.until(() => !p.$('summon-err').hidden, 'the error');
    expect(summonAttempts(p)).toBe(4);
    expect(p.$('summon-err').textContent).toBe(
      'The server did not answer (504). It may still be waking up; try again in a minute.',
    );
  });

  it('a network failure is retried and then named as such', async () => {
    const proxy = (req: ProxyRequest): Response | undefined => {
      if (req.path === '/api/summon') throw new TypeError('fetch failed');
      return undefined;
    };
    page = await openPage({
      samples,
      client: new CryptClient(),
      proxy,
      nodeTimers: true,
    });
    const p = page;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    p.submit('summon-form');
    await vi.advanceTimersByTimeAsync(0);
    await p.until(
      () => p.$('summon-status').textContent === WAKE_TEXT,
      'the wake-up text',
    );
    await vi.advanceTimersByTimeAsync(17_000);
    await p.until(() => !p.$('summon-err').hidden, 'the error');
    expect(p.$('summon-err').textContent).toBe(
      'Could not reach the server. It may still be waking up; try again in a minute.',
    );
  });
});

// ---------------------------------------------------------------------------
// inquisitor review (2026-11-11), finding 6 — first-seance R14.4, R14.5
// ---------------------------------------------------------------------------

const DROPPED =
  'The connection dropped. The ghost may still have answered; ask again in a moment.';
/** first-seance R16.1 (inquisitor second pass, 2026-11-11). */
const NOT_ANSWERED = (status: number): string =>
  `The server did not answer (${status}). The ghost may still have answered; ask again in a moment.`;

const attemptsAt = (p: Page, path: string): number =>
  p.requests.filter((r) => r.path === path).length;

/** Open the page, summon crypt with real timers, then hand the clock to vi. */
async function openSeance(
  client: CryptClient,
  proxy: (req: ProxyRequest) => Response | Promise<Response> | undefined,
): Promise<Page> {
  const p = await openPage({ samples, client, proxy, nodeTimers: true });
  p.submit('summon-form');
  await p.until(() => !p.$('seance').hidden, 'the séance', 20_000);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  return p;
}

const firstChip = (p: Page): ReturnType<Page['$']> =>
  p.doc.querySelector('#guide-chips button') as ReturnType<Page['$']>;

const notices = (p: Page): string[] =>
  [...p.doc.querySelectorAll('#log .notice')].map((n) => n.textContent ?? '');
/** first-seance R15.6: an exorcise failure is written into step 3, not the log. */
const exorciseErrors = (p: Page): string[] =>
  p.$('exorcise-err').hidden ? [] : [p.$('exorcise-err').textContent ?? ''];

describe(
  'flow 4b: a model-calling POST is never replayed after a network failure',
  { timeout: 30_000 },
  () => {
    it('/api/ask: the server answered, the connection dropped; one attempt, one model call, the drop named', async () => {
      const client = new CryptClient();
      let tries = 0;
      page = await openSeance(client, async (req) => {
        if (req.path !== '/api/ask') return undefined;
        tries += 1;
        await req.forward(); // the server runs the ask, model call included
        throw new TypeError('fetch failed'); // …and the browser never sees the answer
      });
      const p = page;
      const before = client.calls.length;
      p.click(firstChip(p));
      for (let i = 0; i < 40 && notices(p).length === 0; i++) {
        await vi.advanceTimersByTimeAsync(1_000);
        await settle();
      }
      expect(tries).toBe(1);
      expect(client.calls.length - before).toBe(1);
      expect(notices(p)).toEqual([DROPPED]);
      expect(p.$('ask-status').textContent).not.toBe(WAKE_TEXT);
    });

    it('/api/exorcise: a network failure is not retried and is named the same way', async () => {
      const client = new CryptClient();
      let tries = 0;
      page = await openSeance(client, async (req) => {
        if (req.path !== '/api/exorcise') return undefined;
        tries += 1;
        await req.forward();
        throw new TypeError('fetch failed');
      });
      const p = page;
      const before = client.calls.length;
      p.click(p.$('exorcise-btn'));
      for (let i = 0; i < 40 && exorciseErrors(p).length === 0; i++) {
        await vi.advanceTimersByTimeAsync(1_000);
        await settle();
      }
      expect(tries).toBe(1);
      expect(client.calls.length - before).toBe(1);
      expect(exorciseErrors(p)).toEqual([DROPPED]);
      expect(notices(p)).toEqual([]);
      expect(p.$('exorcise-status').textContent).not.toBe(WAKE_TEXT);
    });

    it('/api/ask: the proxy forwards, then returns an HTML 502; one attempt, one model call, the failure named (R16.1)', async () => {
      const client = new CryptClient();
      let tries = 0;
      page = await openSeance(client, async (req) => {
        if (req.path !== '/api/ask') return undefined;
        tries += 1;
        await req.forward(); // the server runs the ask, model call included
        return new Response('<html>502</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        });
      });
      const p = page;
      const before = client.calls.length;
      p.click(firstChip(p));
      for (let i = 0; i < 40 && notices(p).length === 0; i++) {
        await vi.advanceTimersByTimeAsync(1_000);
        await settle();
      }
      expect(tries).toBe(1);
      expect(attemptsAt(p, '/api/ask')).toBe(1);
      expect(client.calls.length - before).toBe(1);
      expect(notices(p)).toEqual([NOT_ANSWERED(502)]);
      expect(p.$('ask-status').textContent).not.toBe(WAKE_TEXT);
    });

    it('/api/exorcise: an HTML 503 after forwarding is not retried either (R16.1)', async () => {
      const client = new CryptClient();
      let tries = 0;
      page = await openSeance(client, async (req) => {
        if (req.path !== '/api/exorcise') return undefined;
        tries += 1;
        await req.forward();
        return new Response('<html>503</html>', { status: 503 });
      });
      const p = page;
      const before = client.calls.length;
      p.click(p.$('exorcise-btn'));
      for (let i = 0; i < 40 && exorciseErrors(p).length === 0; i++) {
        await vi.advanceTimersByTimeAsync(1_000);
        await settle();
      }
      expect(tries).toBe(1);
      expect(client.calls.length - before).toBe(1);
      expect(exorciseErrors(p)).toEqual([NOT_ANSWERED(503)]);
      expect(p.$('exorcise-status').textContent).not.toBe(WAKE_TEXT);
    });

    it('/api/ward still retries a proxy 502 page (R16.1 leaves the routes that call no model alone)', async () => {
      const client = new CryptClient();
      page = await openSeance(client, (req) =>
        req.path === '/api/ward' && req.attempt === 1
          ? new Response('<html>502</html>', { status: 502 })
          : undefined,
      );
      const p = page;
      p.click(p.doc.querySelector('[data-preset]') as ReturnType<Page['$']>);
      await vi.advanceTimersByTimeAsync(0);
      await settle();
      await vi.advanceTimersByTimeAsync(2_000);
      await p.until(() => attemptsAt(p, '/api/ward') === 2, 'the retry');
      expect(notices(p)).toEqual([]);
    });
  },
);
