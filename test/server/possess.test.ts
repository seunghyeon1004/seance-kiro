/**
 * first-seance T8 — POST /api/possess (design.md §16.4, §16.8; R13.4–R13.6, R13.12).
 *
 * Both samples are built with the real scripts into a temp dir before the server loads, because
 * CRYPT_DIR is read once when src/server.ts loads. The route calls no model: the injected client
 * throws and counts its calls, so a test can show it was never used. No network.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AnthropicClient,
  AnthropicCreateParams,
  AnthropicMessage,
} from '../../src/ghost/llm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-possess-'));
const CRYPT = path.join(TMP, 'crypt');
const POSSESSED = path.join(TMP, 'possessed');
execFileSync('bash', [path.join(ROOT, 'scripts/make-crypt.sh'), CRYPT], { cwd: ROOT });
execFileSync('bash', [path.join(ROOT, 'scripts/make-possessed.sh'), POSSESSED], {
  cwd: ROOT,
});
process.env['CRYPT_DIR'] = CRYPT;
process.env['POSSESSED_DIR'] = POSSESSED;

const server = await import('../../src/server.js');
const { sessions, modelLimiter, summonLimiter, wardLimiter, clonePool } = server;
const { PossessResponseSchema } = await import('../../src/ghost/schema.js');
const { possessedAnswer, POSSESSED_SUBJECTS } = await import(
  '../../src/ghost/possessed-ghost.js'
);
const { CryptClient } = await import('../ghost/scripted-clients.js');

class ThrowingClient implements AnthropicClient {
  calls = 0;
  readonly messages = {
    create: async (_p: AnthropicCreateParams): Promise<AnthropicMessage> => {
      this.calls++;
      throw new Error('the possessed ghost must not call a model');
    },
  };
}
const client = new ThrowingClient();
const app = server.createApp({ anthropicClient: client });

const F6 = (s: string) =>
  `The citation of ${s} has no quote. The ward accepts a citation only with the exact words from the commit.`;
const F9 = (s: string) =>
  `The quote cited from ${s} is not in that commit's subject, message or diff.`;
const F10 = (y: string) =>
  `The claim names the year ${y}, but no cited commit is dated ${y} or mentions it.`;
const F11 = (n: string) =>
  `The claim names ${n}, but no cited commit is by ${n} or mentions them.`;
const NOT_POSSESSED =
  'The possessed ghost only answers on the possessed sample, auth/throttle.js line 4.';
const NOT_FOUND = { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' };

function post(route: string, body: unknown, raw = false): Promise<Response> {
  return Promise.resolve(
    app.request(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );
}
async function summon(repoUrl: string, file: string, startLine: number, endLine: number) {
  const res = await post('/api/summon', { repoUrl, file, startLine, endLine });
  expect(res.status).toBe(200);
  return ((await res.json()) as { sessionId: string }).sessionId;
}

let info: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  modelLimiter.reset();
  summonLimiter.reset();
  wardLimiter.reset();
  clonePool.reset();
  sessions.clear();
  client.calls = 0;
  process.env['ANTHROPIC_API_KEY'] = 'test-dummy-key-not-a-secret';
  delete process.env['ANTHROPIC_FIXTURE'];
  info = vi.spyOn(console, 'info');
  error = vi.spyOn(console, 'error');
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  delete process.env['CRYPT_DIR'];
  delete process.env['POSSESSED_DIR'];
  delete process.env['ANTHROPIC_API_KEY'];
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('POST /api/possess on the possessed default range', { timeout: 30_000 }, () => {
  it('runs the scripted claims through the live ward: four refused, one silence (R13.4–R13.6)', async () => {
    const sid = await summon('possessed', 'auth/throttle.js', 4, 4);
    const res = await post('/api/possess', { sessionId: sid });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const parsed = PossessResponseSchema.parse(body);
    expect(body['scripted']).toBe(true);
    expect('sessionId' in body).toBe(false);
    expect('recorded' in body).toBe(false);
    expect(parsed.voice).toBe('scripted');
    expect(parsed.score).toBe(0);
    expect(parsed.tally).toEqual({ verified: 0, checked: 4, silent: 1 });
    expect(parsed.verified).toEqual([]);

    const entry = sessions.get(sid)!;
    const sha = (subject: string) =>
      entry.ledger.items.find((i) => i.subject === subject)!.shortSha;
    expect(parsed.rejected.map((r) => r.reason)).toEqual([
      `${F6(sha(POSSESSED_SUBJECTS.P3))} ${F10('2023')}`,
      F6(sha(POSSESSED_SUBJECTS.P2)),
      F9(sha(POSSESSED_SUBJECTS.P4)),
      `${F10('2024')} ${F11('Osric Penhallow')}`,
    ]);
    expect(parsed.silent).toEqual([
      {
        text: 'I added this wait to hide a backdoor for the vendor; the record is silent on who approved it.',
        silenceReason: 'none',
      },
    ]);

    // apart from `scripted`, the same response /api/ward builds for the same claims
    const ward = await post('/api/ward', {
      sessionId: sid,
      answer: { ...possessedAnswer(entry.ledger)!, sessionId: sid },
    });
    expect(ward.status).toBe(200);
    const wardBody = (await ward.json()) as Record<string, unknown>;
    const { scripted, ...rest } = body;
    expect(scripted).toBe(true);
    expect(rest).toEqual(wardBody);
  });

  it('charges only the ward limiter, calls no model and logs nothing (R13.4, R13.12)', async () => {
    const sid = await summon('possessed', 'auth/throttle.js', 4, 4);
    info.mockClear();
    error.mockClear();
    for (let i = 0; i < 5; i++) {
      const res = await post('/api/possess', { sessionId: sid });
      expect(res.status).toBe(200);
    }
    expect(modelLimiter.size()).toBe(0);
    expect(wardLimiter.size()).toBe(1);
    expect(client.calls).toBe(0);
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('POST /api/possess refuses everything else', { timeout: 30_000 }, () => {
  it('a crypt session, possessed line 1 and possessed lines 1 to 7 give NOT_POSSESSED (R13.4)', async () => {
    const cases = [
      await summon('crypt', 'legacy/tax.js', 7, 7),
      await summon('possessed', 'auth/throttle.js', 1, 1),
      await summon('possessed', 'auth/throttle.js', 1, 7),
    ];
    // lines 1 to 7 hold all seven commits, so only the route's range check refuses it
    expect(possessedAnswer(sessions.get(cases[2]!)!.ledger)).not.toBeNull();
    for (const sid of cases) {
      const res = await post('/api/possess', { sessionId: sid });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: 'NOT_POSSESSED', message: NOT_POSSESSED });
    }
  });

  it('an unknown, missing or unreadable session gives the /api/ward 404 (R13.4)', async () => {
    const wardRes = await post('/api/ward', {
      sessionId: 'nope',
      answer: { claims: [] },
    });
    expect(wardRes.status).toBe(404);
    expect(await wardRes.json()).toEqual(NOT_FOUND);
    for (const [body, raw] of [
      [{ sessionId: 'nope' }, false],
      [{}, false],
      [{ sessionId: 42 }, false],
      ['{not json', true],
    ] as const) {
      const res = await post('/api/possess', body, raw);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
  });

  it('a body over 64 KB gives 413 before the ward limiter (R13.4)', async () => {
    const res = await post('/api/possess', { sessionId: 'x'.repeat(70 * 1024) });
    expect(res.status).toBe(413);
    expect(wardLimiter.size()).toBe(0);
  });

  it('/api/ward, /api/ask and /api/exorcise carry no scripted key (R13.5)', async () => {
    const sid = await summon('possessed', 'auth/throttle.js', 4, 4);
    const ward = await post('/api/ward', {
      sessionId: sid,
      answer: { ...possessedAnswer(sessions.get(sid)!.ledger)!, sessionId: sid },
    });
    expect(ward.status).toBe(200);
    expect('scripted' in ((await ward.json()) as object)).toBe(false);
    // live answers from a scripted model, through a second app on the same sessions
    const live = server.createApp({ anthropicClient: new CryptClient() });
    for (const route of ['/api/ask', '/api/exorcise']) {
      const res = await live.request(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, question: 'Why is the sky blue?' }),
      });
      expect(res.status, route).toBe(200);
      expect('scripted' in ((await res.json()) as object), route).toBe(false);
    }
  });
});
