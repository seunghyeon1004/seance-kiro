/**
 * first-seance T3 — the model limiter and recorded answers (R7.7), and the inquisitor review
 * (2026-11-11): recorded answers have their own per-client limiter (R14.1, R14.2) and apply
 * only to the ledger they were recorded from (R14.3).
 *
 * MAX_MODEL_CALLS_PER_DAY=1, RATE_LIMIT_MAX=2 and RECORDED_RATE_LIMIT_MAX=12 are set before
 * src/server.ts loads, because the limiters read them once. The real askGhost runs with a scripted client (CryptClient);
 * recordings are written into a temp dir by recordAnswers. No test calls the model or the network.
 *
 * With a daily cap of 1 below a per-client cap of 2, the limiter's daily check (which runs
 * first) always refuses before the per-client one can. The per-client case therefore loads a
 * second copy of the server module (vi.resetModules) with MAX_MODEL_CALLS_PER_DAY=100.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { recordAnswers } from '../../scripts/record-answers.js';
import {
  SAMPLE_QUESTIONS,
  SAMPLE_RANGES,
  loadRecording,
  recordingTargetFor,
} from '../../src/ghost/recordings.js';
import { CryptClient } from '../ghost/scripted-clients.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-reclimits-'));
const CRYPT = path.join(TMP, 'crypt');
const REC = path.join(TMP, 'recordings');
execFileSync('bash', [path.join(ROOT, 'scripts/make-crypt.sh'), CRYPT], { cwd: ROOT });
process.env['CRYPT_DIR'] = CRYPT;
process.env['MAX_MODEL_CALLS_PER_DAY'] = '1';
process.env['RATE_LIMIT_MAX'] = '2';
process.env['RECORDED_RATE_LIMIT_MAX'] = '12';

const KEY = 'test-dummy-key-not-a-secret';
const DAILY = 'The séance is closed for tonight. The spirits will answer again tomorrow.';
const CLIENT =
  'The spirits are tired. Let them rest a few minutes before you call again.';
const CHIP = SAMPLE_QUESTIONS.crypt[0]!;
const FREE = 'Why is the sky blue?';
const RECORDED =
  'The recorded answers need a short rest. Wait a few minutes before asking again.';

type ServerModule = typeof import('../../src/server.js');
const server: ServerModule = await import('../../src/server.js');
const client = new CryptClient();
const app = server.createApp({ anthropicClient: client });

function post(
  a: { request: ServerModule['app']['request'] },
  route: string,
  body: unknown,
) {
  return Promise.resolve(
    a.request(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify(body),
    }),
  );
}

async function summon(a: { request: ServerModule['app']['request'] }): Promise<string> {
  const res = await post(a, '/api/summon', { repoUrl: 'crypt', ...SAMPLE_RANGES.crypt });
  expect(res.status).toBe(200);
  return ((await res.json()) as { sessionId: string }).sessionId;
}

beforeAll(async () => {
  fs.mkdirSync(REC);
  process.env['ANTHROPIC_API_KEY'] = KEY;
  delete process.env['ANTHROPIC_FIXTURE'];
  await recordAnswers({
    outDir: REC,
    client: new CryptClient(),
    samples: ['crypt'],
    log: () => undefined,
  });
  process.env['RECORDINGS_DIR'] = REC;
}, 60_000);

beforeEach(() => {
  server.modelLimiter.reset();
  server.summonLimiter.reset();
  server.wardLimiter.reset();
  server.recordedLimiter.reset();
  server.sessions.clear();
  client.calls.length = 0;
  process.env['ANTHROPIC_API_KEY'] = KEY;
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
  vi.restoreAllMocks();
  delete process.env['RECORDINGS_DIR'];
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['MAX_MODEL_CALLS_PER_DAY'];
  delete process.env['RATE_LIMIT_MAX'];
  delete process.env['RECORDED_RATE_LIMIT_MAX'];
  delete process.env['CRYPT_DIR'];
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe(
  'R7.7 — serving a recording never charges the model limiter',
  { timeout: 30_000 },
  () => {
    it('with no key, ten recorded asks leave both counters untouched', async () => {
      const sid = await summon(app);
      delete process.env['ANTHROPIC_API_KEY'];
      for (let i = 0; i < 10; i++) {
        const res = await post(app, '/api/ask', { sessionId: sid, question: CHIP });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { recorded: boolean }).recorded).toBe(true);
      }
      const ex = await post(app, '/api/exorcise', { sessionId: sid });
      expect(ex.status).toBe(200);
      expect(server.modelLimiter.size()).toBe(0);
      expect(client.calls).toHaveLength(0);

      // The one daily slot is still free: a free question with a key gets it
      process.env['ANTHROPIC_API_KEY'] = KEY;
      const live = await post(app, '/api/ask', { sessionId: sid, question: FREE });
      expect(live.status).toBe(200);
      expect(((await live.json()) as { recorded: boolean }).recorded).toBe(false);
      expect(client.calls).toHaveLength(1);
      expect(server.modelLimiter.size()).toBe(1);
    });

    it('with the daily cap used up, a chip question gets the recording and a free one the 429', async () => {
      const sid = await summon(app);
      const first = await post(app, '/api/ask', { sessionId: sid, question: FREE });
      expect(first.status).toBe(200);
      expect(client.calls).toHaveLength(1);

      const chip = await post(app, '/api/ask', { sessionId: sid, question: CHIP });
      expect(chip.status).toBe(200);
      const body = (await chip.json()) as Record<string, unknown>;
      expect(body['recorded']).toBe(true);
      expect(client.calls).toHaveLength(1); // no model call for the recording

      // …with the live ward's verdict
      const entry = server.sessions.get(sid);
      const target = entry ? recordingTargetFor(entry, 'ask', CHIP) : null;
      const rec = target ? loadRecording(target) : null;
      if (!rec || rec.kind !== 'ask') throw new Error('no recording');
      const ward = await post(app, '/api/ward', { sessionId: sid, answer: rec.answer });
      const { recorded: _r, sessionId: _s, ...verdict } = body;
      expect(verdict).toEqual(await ward.json());

      const ex = await post(app, '/api/exorcise', { sessionId: sid });
      expect(ex.status).toBe(200);
      expect(((await ex.json()) as { recorded: boolean }).recorded).toBe(true);

      const free = await post(app, '/api/ask', { sessionId: sid, question: FREE });
      expect(free.status).toBe(429);
      expect(await free.json()).toEqual({ error: DAILY, code: 'RATE_LIMITED' });
      expect(Number(free.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
      expect(client.calls).toHaveLength(1);
    });

    it('with the per-client limit used up, a chip question gets the 429, not the recording', async () => {
      process.env['MAX_MODEL_CALLS_PER_DAY'] = '100';
      vi.resetModules();
      const fresh: ServerModule = await import('../../src/server.js');
      expect(fresh).not.toBe(server);
      const freshClient = new CryptClient();
      const freshApp = fresh.createApp({ anthropicClient: freshClient });
      try {
        const sid = await summon(freshApp);
        for (let i = 0; i < 2; i++) {
          const res = await post(freshApp, '/api/ask', {
            sessionId: sid,
            question: FREE,
          });
          expect(res.status).toBe(200);
        }
        const chip = await post(freshApp, '/api/ask', { sessionId: sid, question: CHIP });
        expect(chip.status).toBe(429);
        expect(await chip.json()).toEqual({ error: CLIENT, code: 'RATE_LIMITED' });
        expect(Number(chip.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
        const ex = await post(freshApp, '/api/exorcise', { sessionId: sid });
        expect(ex.status).toBe(429);
        expect(freshClient.calls).toHaveLength(2);
      } finally {
        process.env['MAX_MODEL_CALLS_PER_DAY'] = '1';
      }
    });
  },
);

// ---------------------------------------------------------------------------
// inquisitor review (2026-11-11), finding 7 — the recorded-answer limiter (R14.1, R14.2)
// ---------------------------------------------------------------------------

/** A client whose every call fails as an overloaded model (529 → MODEL_BUSY). */
function overloaded(): { messages: { create: () => Promise<never> }; calls: number } {
  const c = {
    calls: 0,
    messages: {
      create: async (): Promise<never> => {
        c.calls += 1;
        throw new Anthropic.APIError(
          529,
          { type: 'error', error: { message: 'overloaded' } },
          'overloaded',
          undefined,
        );
      },
    },
  };
  return c;
}

async function expectRecordedLimit(res: Response): Promise<void> {
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ error: RECORDED, code: 'RATE_LIMITED' });
  expect(Number(res.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
}

describe(
  'R14.1 — recorded answers have their own per-client limit',
  { timeout: 30_000 },
  () => {
    it('with no key, the 13th recorded request is refused; the model limiter is never charged', async () => {
      const sid = await summon(app);
      delete process.env['ANTHROPIC_API_KEY'];
      for (let i = 0; i < 11; i++) {
        const res = await post(app, '/api/ask', { sessionId: sid, question: CHIP });
        expect(res.status).toBe(200);
      }
      expect((await post(app, '/api/exorcise', { sessionId: sid })).status).toBe(200);
      await expectRecordedLimit(
        await post(app, '/api/ask', { sessionId: sid, question: CHIP }),
      );
      await expectRecordedLimit(await post(app, '/api/exorcise', { sessionId: sid }));
      expect(server.modelLimiter.size()).toBe(0);
      expect(client.calls).toHaveLength(0);

      // the global daily counter was not charged: the one daily slot is still free
      process.env['ANTHROPIC_API_KEY'] = KEY;
      const live = await post(app, '/api/ask', { sessionId: sid, question: FREE });
      expect(live.status).toBe(200);
      expect(((await live.json()) as { recorded: boolean }).recorded).toBe(false);
    });

    it('another client has its own recorded allowance', async () => {
      const sid = await summon(app);
      delete process.env['ANTHROPIC_API_KEY'];
      for (let i = 0; i < 12; i++)
        expect(
          (await post(app, '/api/ask', { sessionId: sid, question: CHIP })).status,
        ).toBe(200);
      await expectRecordedLimit(
        await post(app, '/api/ask', { sessionId: sid, question: CHIP }),
      );
      const other = await Promise.resolve(
        app.request('/api/ask', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': '198.51.100.9',
          },
          body: JSON.stringify({ sessionId: sid, question: CHIP }),
        }),
      );
      expect(other.status).toBe(200);
    });

    it('at the daily cap, recorded answers count against the same limit', async () => {
      const sid = await summon(app);
      expect(
        (await post(app, '/api/ask', { sessionId: sid, question: FREE })).status,
      ).toBe(200);
      for (let i = 0; i < 12; i++) {
        const res = await post(app, '/api/ask', { sessionId: sid, question: CHIP });
        expect(((await res.json()) as { recorded: boolean }).recorded).toBe(true);
      }
      await expectRecordedLimit(
        await post(app, '/api/ask', { sessionId: sid, question: CHIP }),
      );
      expect(client.calls).toHaveLength(1);
    });

    it('after a model failure, the recording is served only within the limit', async () => {
      process.env['MAX_MODEL_CALLS_PER_DAY'] = '100';
      process.env['RATE_LIMIT_MAX'] = '100';
      vi.resetModules();
      const fresh: ServerModule = await import('../../src/server.js');
      const busy = overloaded();
      const freshApp = fresh.createApp({ anthropicClient: busy });
      try {
        const sid = await summon(freshApp);
        for (let i = 0; i < 12; i++) {
          const res = await post(freshApp, '/api/ask', {
            sessionId: sid,
            question: CHIP,
          });
          expect(res.status).toBe(200);
          expect(((await res.json()) as { recorded: boolean }).recorded).toBe(true);
        }
        await expectRecordedLimit(
          await post(freshApp, '/api/ask', { sessionId: sid, question: CHIP }),
        );
      } finally {
        process.env['MAX_MODEL_CALLS_PER_DAY'] = '1';
        process.env['RATE_LIMIT_MAX'] = '2';
      }
    });

    it('defaults to 30 recorded responses per client per 600 000 ms', async () => {
      delete process.env['RECORDED_RATE_LIMIT_MAX'];
      vi.resetModules();
      const fresh: ServerModule = await import('../../src/server.js');
      const freshApp = fresh.createApp({ anthropicClient: new CryptClient() });
      try {
        const sid = await summon(freshApp);
        delete process.env['ANTHROPIC_API_KEY'];
        for (let i = 0; i < 30; i++)
          expect(
            (await post(freshApp, '/api/ask', { sessionId: sid, question: CHIP })).status,
          ).toBe(200);
        const res = await post(freshApp, '/api/ask', { sessionId: sid, question: CHIP });
        await expectRecordedLimit(res);
        expect(Number(res.headers.get('Retry-After'))).toBeLessThanOrEqual(600);
      } finally {
        process.env['RECORDED_RATE_LIMIT_MAX'] = '12';
      }
    });
  },
);

// ---------------------------------------------------------------------------
// inquisitor review (2026-11-11), finding 8 — ledgerShas (R14.3)
// ---------------------------------------------------------------------------

describe('R14.3 — a recording made from another ledger is treated as absent', () => {
  it('with no key, a chip question on a changed ledger gets CONFIG_ERROR, not the recording', async () => {
    const sid = await summon(app);
    const entry = server.sessions.get(sid)!;
    entry.ledger = {
      ...entry.ledger,
      items: entry.ledger.items.map((it, i) =>
        i === 0 ? { ...it, shortSha: 'fffffff', sha: 'f'.repeat(40) } : it,
      ),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    delete process.env['ANTHROPIC_API_KEY'];
    const res = await post(app, '/api/ask', { sessionId: sid, question: CHIP });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('CONFIG_ERROR');
    expect(warn).toHaveBeenCalledWith(
      '[seance] recording was made from another ledger, ignored',
      expect.anything(),
    );
    // the ask above used this file's one daily model slot, as any unrecorded request does
    server.modelLimiter.reset();
    const ex = await post(app, '/api/exorcise', { sessionId: sid });
    expect(ex.status).toBe(503);
    expect(((await ex.json()) as { code: string }).code).toBe('CONFIG_ERROR');
  });
});
