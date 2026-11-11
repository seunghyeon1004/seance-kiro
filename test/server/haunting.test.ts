/**
 * haunting-map T4 — the summon route (design.md §6.3, §11.1).
 *
 * Both samples are built with the real scripts into a temp dir before the server loads, because
 * CRYPT_DIR is read once when src/server.ts loads. buildLedger and readHauntingMap are wrapped
 * in vi.fn around their real implementations; a test that needs a failing map replaces the
 * reader once (a note, a synchronous throw, a rejection, or the real reader with a 1 ms git
 * timeout). The /api/ask case uses a capturing client with a fake key, so no model or network
 * is ever called.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../src/evidence/ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/evidence/ledger.js')>();
  return { ...actual, buildLedger: vi.fn(actual.buildLedger) };
});
vi.mock('../../src/evidence/haunting.read.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/evidence/haunting.read.js')>();
  return { ...actual, readHauntingMap: vi.fn(actual.readHauntingMap) };
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-haunting-route-'));
const CRYPT = path.join(TMP, 'crypt');
const POSSESSED = path.join(TMP, 'possessed');
execFileSync('bash', [path.join(ROOT, 'scripts/make-crypt.sh'), CRYPT], {
  stdio: 'ignore',
});
execFileSync('bash', [path.join(ROOT, 'scripts/make-possessed.sh'), POSSESSED], {
  stdio: 'ignore',
});
process.env['CRYPT_DIR'] = CRYPT;
process.env['POSSESSED_DIR'] = POSSESSED;

const ledgerMod = await import('../../src/evidence/ledger.js');
const readMod = await import('../../src/evidence/haunting.read.js');
const buildLedgerMock = vi.mocked(ledgerMod.buildLedger);
const readMock = vi.mocked(readMod.readHauntingMap);
const { MAP_NOTE_FAILED } = readMod;
const { WHOLE_FILE_UNREADABLE } = ledgerMod;
const server = await import('../../src/server.js');
const { sessions, modelLimiter, summonLimiter, wardLimiter, clonePool, createApp } =
  server;
const { SummonResponseSchema } = await import('../../src/ghost/schema.js');
const { buildPrompt } = await import('../../src/ghost/persona.js');
const { CRYPT_MAP } = await import('../evidence/haunting.expected.js');
type AnthropicClient = import('../../src/ghost/llm.js').AnthropicClient;
type CreateParams = Parameters<AnthropicClient['messages']['create']>[0];

const app = server.default;
const CRYPT_DEFAULT = {
  repoUrl: 'crypt',
  file: 'legacy/tax.js',
  startLine: 7,
  endLine: 7,
};
const VENDOR_WHOLE = { repoUrl: 'crypt', file: 'legacy/vendor.js', wholeFile: true };
const NOT_BOTH = 'Send a line range or wholeFile, not both.';
const ONE_FORM = 'Send a line range (startLine and endLine) or wholeFile: true.';

function post(
  route: string,
  body: unknown,
  appInstance: { fetch: (r: Request) => Response | Promise<Response> } = app,
  ip = '203.0.113.7',
): Promise<Response> {
  return Promise.resolve(
    appInstance.fetch(
      new Request(`http://localhost${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
        body: JSON.stringify(body),
      }),
    ),
  );
}

type Json = Record<string, unknown>;
async function summon(body: unknown): Promise<{ status: number; json: Json }> {
  const res = await post('/api/summon', body);
  return { status: res.status, json: (await res.json()) as Json };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  summonLimiter.reset();
  wardLimiter.reset();
  modelLimiter.reset();
  clonePool.reset();
  sessions.clear();
});
afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('the map on a summon (R4.1–R4.3, R7.2)', () => {
  it('the crypt default carries the map of §9.1, range 7–7 and no mapNote', async () => {
    const { status, json } = await summon(CRYPT_DEFAULT);
    expect(status).toBe(200);
    expect(json['map']).toEqual(CRYPT_MAP);
    expect(json['range']).toEqual({ startLine: 7, endLine: 7 });
    expect('mapNote' in json).toBe(false);
    const parsed = SummonResponseSchema.safeParse(json);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(buildLedgerMock.mock.calls[0]?.[1]).toEqual({ hauntingMap: true });
  });

  it('SummonResponseSchema refuses a body with both map and mapNote', async () => {
    const { json } = await summon(CRYPT_DEFAULT);
    expect(
      SummonResponseSchema.safeParse({ ...json, mapNote: MAP_NOTE_FAILED }).success,
    ).toBe(false);
  });
});

describe('a failing map never fails the summon (R1.6, R4.1)', () => {
  let plainItems: unknown;
  beforeEach(async () => {
    if (plainItems === undefined)
      plainItems = (await summon(CRYPT_DEFAULT)).json['items'];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it.each([
    [
      'resolves to the failed note',
      () => readMock.mockResolvedValueOnce({ kind: 'note', note: MAP_NOTE_FAILED }),
    ],
    [
      'throws synchronously',
      () =>
        readMock.mockImplementationOnce(() => {
          throw new Error('reader exploded');
        }),
    ],
    ['rejects', () => readMock.mockRejectedValueOnce(new Error('reader rejected'))],
    [
      'times out in git (the real reader with a 1 ms timeout)',
      () =>
        readMock.mockImplementationOnce(async (repo) => {
          const actual = await vi.importActual<
            typeof import('../../src/evidence/haunting.read.js')
          >('../../src/evidence/haunting.read.js');
          return actual.readHauntingMap(repo, { timeoutMs: 1 });
        }),
    ],
  ])('a reader that %s gives 200, mapNote and no map', async (_label, arrange) => {
    arrange();
    const { status, json } = await summon(CRYPT_DEFAULT);
    expect(status).toBe(200);
    expect(json['mapNote']).toBe(MAP_NOTE_FAILED);
    expect('map' in json).toBe(false);
    expect(json['items']).toEqual(plainItems);
    expect(json['range']).toEqual({ startLine: 7, endLine: 7 });
    expect(SummonResponseSchema.safeParse(json).success).toBe(true);
    expect(JSON.stringify(json)).not.toContain(CRYPT);
  });
});

describe('whole-file summons (R6.2–R6.6)', () => {
  it('legacy/vendor.js gives range 1–13, 2 items and 13 lines', async () => {
    const { status, json } = await summon(VENDOR_WHOLE);
    expect(status).toBe(200);
    expect(json['range']).toEqual({ startLine: 1, endLine: 13 });
    expect(json['items']).toHaveLength(2);
    expect(json['lines']).toHaveLength(13);
    expect(json['map']).toEqual(CRYPT_MAP);
  });

  it('a missing file gives 400 with WHOLE_FILE_UNREADABLE', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { status, json } = await summon({ ...VENDOR_WHOLE, file: 'legacy/missing.js' });
    expect(status).toBe(400);
    expect(json).toEqual({ code: 'VALIDATION_ERROR', message: WHOLE_FILE_UNREADABLE });
  });

  it.each([
    ['wholeFile with startLine', { ...VENDOR_WHOLE, startLine: 1 }, NOT_BOTH],
    [
      'wholeFile with both lines',
      { ...VENDOR_WHOLE, startLine: 1, endLine: 2 },
      NOT_BOTH,
    ],
    ['neither form', { repoUrl: 'crypt', file: 'legacy/tax.js' }, ONE_FORM],
    [
      'only startLine',
      { repoUrl: 'crypt', file: 'legacy/tax.js', startLine: 7 },
      ONE_FORM,
    ],
    ['only endLine', { repoUrl: 'crypt', file: 'legacy/tax.js', endLine: 7 }, ONE_FORM],
    ['wholeFile false without lines', { ...VENDOR_WHOLE, wholeFile: false }, ONE_FORM],
  ])('%s gives 400 with the R6.2 message', async (_label, body, message) => {
    const { status, json } = await summon(body);
    expect(status).toBe(400);
    expect(json).toEqual({ code: 'VALIDATION_ERROR', message });
    expect(buildLedgerMock).not.toHaveBeenCalled();
  });

  it('wholeFile false with both lines is a range request', async () => {
    const { status, json } = await summon({ ...CRYPT_DEFAULT, wholeFile: false });
    expect(status).toBe(200);
    expect(json['range']).toEqual({ startLine: 7, endLine: 7 });
  });

  it.each([
    ['../x', 'file path must not contain ".." path-traversal sequences'],
    ['/etc/passwd', 'file path must be relative, not absolute'],
    ['a/..b/c.js', 'file path must not contain ".." path-traversal sequences'],
  ])('wholeFile with file %s gives 400 before buildLedger', async (file, message) => {
    const { status, json } = await summon({ ...VENDOR_WHOLE, file });
    expect(status).toBe(400);
    expect(json).toEqual({ code: 'VALIDATION_ERROR', message });
    expect(buildLedgerMock).not.toHaveBeenCalled();
  });

  it('the 21st whole-file summon from one client is 429, and modelLimiter is untouched', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await post('/api/summon', VENDOR_WHOLE);
      expect(res.status, `summon ${i + 1}`).toBe(200);
    }
    const res = await post('/api/summon', VENDOR_WHOLE);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(((await res.json()) as Json)['code']).toBe('RATE_LIMITED');
    expect(modelLimiter.size()).toBe(0);
    expect(buildLedgerMock).toHaveBeenCalledTimes(20);
  });
});

describe('the session holds the ledger without the map (R4.4, R8.1)', () => {
  it('a whole-file session has no haunting key and stores the whole-file range', async () => {
    const { json } = await summon(VENDOR_WHOLE);
    const entry = sessions.get(json['sessionId'] as string);
    expect(entry).toBeDefined();
    expect('haunting' in (entry?.ledger ?? {})).toBe(false);
    expect([entry?.file, entry?.startLine, entry?.endLine]).toEqual([
      'legacy/vendor.js',
      1,
      13,
    ]);
  });

  it('the session ledger and the /api/ask prompt equal those of a ledger built without the map', async () => {
    const calls: CreateParams[] = [];
    const client: AnthropicClient = {
      messages: {
        create: async (params) => {
          calls.push(params);
          const sessionId = /sessionId "([^"]+)"/.exec(params.system)?.[1] ?? 'unknown';
          return {
            content: [
              {
                type: 'tool_use',
                name: 'ghost_answer',
                input: {
                  voice: 'capturing ghost',
                  sessionId,
                  claims: [
                    {
                      kind: 'silence',
                      text: 'The record is silent.',
                      citations: [],
                      silenceReason: 'why',
                    },
                  ],
                },
              },
            ],
          };
        },
      },
    } as AnthropicClient;
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
    try {
      const appWithClient = createApp({ anthropicClient: client });
      const res = await post('/api/summon', CRYPT_DEFAULT, appWithClient);
      const { sessionId } = (await res.json()) as { sessionId: string };

      const plain = await vi
        .importActual<
          typeof import('../../src/evidence/ledger.js')
        >('../../src/evidence/ledger.js')
        .then((m) => m.buildLedger({ ...CRYPT_DEFAULT, repoUrl: CRYPT }));
      const entry = sessions.get(sessionId);
      expect(entry?.ledger.items).toEqual(plain.items);
      expect('haunting' in (entry?.ledger ?? {})).toBe(false);

      const question = 'Why does this line exist?';
      const ask = await post('/api/ask', { sessionId, question }, appWithClient);
      expect(ask.status).toBe(200);
      expect(calls).toHaveLength(1);
      const expected = buildPrompt(plain.items, question, sessionId);
      expect(calls[0]?.system).toBe(expected.system);
      expect(calls[0]?.messages[0]?.content).toBe(expected.user);
      expect(JSON.stringify(calls[0])).not.toContain('haunting');
      expect(JSON.stringify(calls[0])).not.toContain('Tended by');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
