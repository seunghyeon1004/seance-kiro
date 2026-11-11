/**
 * first-seance — server tests.
 *
 * T1: the model-failure rows of design.md §3.3 on /api/ask and /api/exorcise (R6.1–R6.3) and
 * GET /api/health (R5.1).
 *
 * Both samples are built with the real scripts into a temp dir before the server loads, because
 * CRYPT_DIR is read once when src/server.ts loads. askGhost and buildPlan are wrapped in vi.fn
 * around their real implementations; a test that needs a failure makes the wrapper reject.
 * No test calls the model or the network.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../src/ghost/llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ghost/llm.js')>();
  return { ...actual, askGhost: vi.fn(actual.askGhost) };
});
vi.mock('../../src/exorcism/plan.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/exorcism/plan.js')>();
  return { ...actual, buildPlan: vi.fn(actual.buildPlan) };
});
vi.mock('../../src/evidence/ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/evidence/ledger.js')>();
  return { ...actual, buildLedger: vi.fn(actual.buildLedger) };
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-first-'));
const CRYPT = path.join(TMP, 'crypt');
const POSSESSED = path.join(TMP, 'possessed');
const EMPTY = path.join(TMP, 'empty');
fs.mkdirSync(EMPTY);
execFileSync('bash', [path.join(ROOT, 'scripts/make-crypt.sh'), CRYPT], { cwd: ROOT });
execFileSync('bash', [path.join(ROOT, 'scripts/make-possessed.sh'), POSSESSED], {
  cwd: ROOT,
});
process.env['CRYPT_DIR'] = CRYPT;
process.env['POSSESSED_DIR'] = POSSESSED;

const llm = await import('../../src/ghost/llm.js');
const planMod = await import('../../src/exorcism/plan.js');
const ledgerMod = await import('../../src/evidence/ledger.js');
const askGhostMock = vi.mocked(llm.askGhost);
const buildPlanMock = vi.mocked(planMod.buildPlan);
const buildLedgerMock = vi.mocked(ledgerMod.buildLedger);
const server = await import('../../src/server.js');
const {
  default: app,
  sessions,
  modelLimiter,
  summonLimiter,
  wardLimiter,
  clonePool,
} = server;
const { HealthResponseSchema, SummonResponseSchema } = await import(
  '../../src/ghost/schema.js'
);
const { mostFrequentAuthor } = await import('../../src/ghost/persona.js');
const errors = await import('../../src/errors.js');

const KEY = 'sk-ant-first-seance-test-key';

const SHA_40 = 'abc1234' + '0'.repeat(33);
const LEDGER = {
  items: [
    Object.freeze({
      id: 'E1',
      sha: SHA_40,
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
  ] as const,
  truncated: false,
  buildDurationMs: 1,
};
const SID = 'first-seance-session';

function post(route: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  modelLimiter.reset();
  summonLimiter.reset();
  wardLimiter.reset();
  clonePool.reset();
  sessions.set(SID, { ledger: LEDGER, expiresAt: Date.now() + 60_000 });
  process.env['ANTHROPIC_API_KEY'] = KEY;
  delete process.env['ANTHROPIC_FIXTURE'];
});

afterEach(() => {
  sessions.clear();
  // vitest 2: mockRestore on vi.fn(impl) puts the real implementation back
  askGhostMock.mockRestore();
  buildPlanMock.mockRestore();
  buildLedgerMock.mockRestore();
  vi.restoreAllMocks();
  process.env['POSSESSED_DIR'] = POSSESSED;
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['ANTHROPIC_FIXTURE'];
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// T1 — design.md §3.3, model rows (R6.1–R6.3)
// ---------------------------------------------------------------------------

interface Row {
  readonly name: string;
  readonly make: () => Error;
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/** Raw messages full of what must never reach a visitor. */
const LEAKY = `ANTHROPIC_API_KEY ${KEY} /tmp/seance/x.json ZodError "path": ["claims"]`;

const ROWS: readonly Row[] = [
  {
    name: 'ModelConfigError',
    make: () => new errors.ModelConfigError(`Anthropic API 401: ${LEAKY}`),
    status: 503,
    code: 'MODEL_CONFIG',
    message:
      "The ghost cannot be reached: the server's model key or model name is wrong.",
  },
  {
    name: 'ModelBusyError',
    make: () => new errors.ModelBusyError(`Anthropic API 529: ${LEAKY}`),
    status: 503,
    code: 'MODEL_BUSY',
    message: 'The spirits are busy. Try again in a minute.',
  },
  {
    name: 'TimeoutError',
    make: () => new errors.TimeoutError(`LLM call exceeded timeout of 30000ms ${LEAKY}`),
    status: 503,
    code: 'TIMEOUT',
    message: 'The ghost took too long to answer.',
  },
  {
    name: 'ParseError (LLM)',
    make: () => new errors.ParseError(`LLM response failed validation: ${LEAKY}`),
    status: 503,
    code: 'LLM_ERROR',
    message: "The ghost's answer was not in a form the ward can read. Try asking again.",
  },
  {
    name: 'ParseError (fixture path)',
    make: () => new errors.ParseError(`Fixture file not found: ${LEAKY}`),
    status: 503,
    code: 'LLM_ERROR',
    message: "The ghost's answer was not in a form the ward can read. Try asking again.",
  },
  {
    name: 'ParseError (any other wording)',
    make: () => new errors.ParseError(`no tool block ${LEAKY}`),
    status: 503,
    code: 'LLM_ERROR',
    message: "The ghost's answer was not in a form the ward can read. Try asking again.",
  },
  {
    name: 'ConfigError',
    make: () => new errors.ConfigError(`ANTHROPIC_API_KEY is not set ${LEAKY}`),
    status: 503,
    code: 'CONFIG_ERROR',
    message:
      'The ghost cannot speak on this server (no model key). The crypt and the ward still work.',
  },
  {
    name: 'anything else',
    make: () => new Error(LEAKY),
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  },
];

function expectNoLeak(text: string): void {
  for (const bad of ['ANTHROPIC', 'sk-', '/', 'ZodError', '"path"']) {
    expect(text).not.toContain(bad);
  }
}

describe.each([
  {
    route: '/api/ask',
    body: { sessionId: SID, question: 'Why the wait?' },
    fail: (e: Error) => askGhostMock.mockRejectedValue(e),
  },
  {
    route: '/api/exorcise',
    body: { sessionId: SID },
    fail: (e: Error) => buildPlanMock.mockRejectedValue(e),
  },
])('$route — model failures (R6.1–R6.3)', ({ route, body, fail }) => {
  it.each(ROWS)('$name gives $status $code with the fixed message', async (row) => {
    const err = row.make();
    fail(err);
    const logged: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    const res = await post(route, body);
    expect(res.status).toBe(row.status);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ code: row.code, message: row.message });
    expectNoLeak(text);
    // The full error went to the server log, and only there (R6.3)
    expect(JSON.stringify(logged)).toContain(JSON.stringify(err.message).slice(1, -1));
    if (row.code === 'MODEL_BUSY') {
      expect(res.headers.get('Retry-After')).toBe('60');
    } else {
      expect(res.headers.get('Retry-After')).toBeNull();
    }
  });
});

describe('toHttpError — the earlier rows are unchanged', () => {
  it('a session that does not exist is still 404 SESSION_NOT_FOUND', async () => {
    const res = await post('/api/ask', { sessionId: 'nope', question: 'q' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('SESSION_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// T1 — GET /api/health (R5.1)
// ---------------------------------------------------------------------------

async function health(): Promise<ReturnType<typeof HealthResponseSchema.parse>> {
  const res = await app.request('/api/health');
  expect(res.status).toBe(200);
  return HealthResponseSchema.parse(await res.json());
}

describe('GET /api/health (R5.1)', () => {
  it('reports the model and both built samples, in order', async () => {
    const h = await health();
    expect(h.status).toBe('ok');
    expect(h.uptime).toBeGreaterThanOrEqual(0);
    expect(h.model).toBe(true);
    expect(h.samples).toEqual(['crypt', 'possessed']);
  });

  it('model is false with no key or a blank key, and true in fixture mode', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    expect((await health()).model).toBe(false);
    process.env['ANTHROPIC_API_KEY'] = '   ';
    expect((await health()).model).toBe(false);
    process.env['ANTHROPIC_FIXTURE'] = '1';
    expect((await health()).model).toBe(true);
  });

  it('lists only the built samples, read per request', async () => {
    process.env['POSSESSED_DIR'] = EMPTY;
    expect((await health()).samples).toEqual(['crypt']);
    const git = path.join(CRYPT, '.git');
    const off = path.join(CRYPT, '.git-off');
    fs.renameSync(git, off);
    try {
      expect((await health()).samples).toEqual([]);
    } finally {
      fs.renameSync(off, git);
    }
    process.env['POSSESSED_DIR'] = POSSESSED;
    expect((await health()).samples).toEqual(['crypt', 'possessed']);
  });
});

// ---------------------------------------------------------------------------
// T2 — the summon fields (R2.1, R2.2, R8.3) and HISTORY_ERROR (R8.1)
// ---------------------------------------------------------------------------

const SAMPLE_INPUT = {
  crypt: { repoUrl: 'crypt', file: 'legacy/tax.js', startLine: 7, endLine: 7 },
  possessed: { repoUrl: 'possessed', file: 'auth/throttle.js', startLine: 4, endLine: 4 },
} as const;

function headLine(repo: string, file: string, n: number): string {
  const text = execFileSync('git', ['show', `HEAD:${file}`], {
    cwd: repo,
    encoding: 'utf8',
  });
  return text.split('\n')[n - 1] ?? '';
}

describe('POST /api/summon — the line, the persona and shallow (R2.1, R2.2, R8.3)', () => {
  it.each([
    ['crypt', CRYPT],
    ['possessed', POSSESSED],
  ] as const)(
    '%s: lines, persona.author and shallow, parsed by SummonResponseSchema',
    async (name, dir) => {
      const input = SAMPLE_INPUT[name];
      const res = await post('/api/summon', input);
      expect(res.status).toBe(200);
      const body = SummonResponseSchema.parse(await res.json());
      expect(body.lines).toEqual([
        { n: input.startLine, text: headLine(dir, input.file, input.startLine) },
      ]);
      expect(body.lines[0]?.text.length).toBeGreaterThan(0);
      const entry = sessions.get(body.sessionId);
      expect(entry).toBeDefined();
      expect(body.persona.author).toBe(mostFrequentAuthor(entry?.ledger.items ?? []));
      expect(body.ledgerSize).toBeGreaterThan(0);
      expect(body.shallow).toBe(false);
      expect(entry?.sample).toBe(name);
    },
  );

  it('a multi-line range returns each line in order', async () => {
    const res = await post('/api/summon', {
      ...SAMPLE_INPUT.crypt,
      startLine: 1,
      endLine: 10,
    });
    expect(res.status).toBe(200);
    const body = SummonResponseSchema.parse(await res.json());
    expect(body.lines.map((l) => l.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(body.lines[6]?.text).toBe(headLine(CRYPT, 'legacy/tax.js', 7));
  });

  it('a non-default range of a sample still records the sample and its range', async () => {
    const res = await post('/api/summon', { ...SAMPLE_INPUT.crypt, startLine: 6 });
    const body = SummonResponseSchema.parse(await res.json());
    const entry = sessions.get(body.sessionId);
    expect(entry?.sample).toBe('crypt');
    expect([entry?.file, entry?.startLine, entry?.endLine]).toEqual([
      'legacy/tax.js',
      6,
      7,
    ]);
  });

  it('passes shallow and lines from buildLedger, and an empty ledger names Unknown Author', async () => {
    buildLedgerMock.mockResolvedValueOnce({
      items: [],
      truncated: false,
      buildDurationMs: 1,
      lines: [{ n: 3, text: 'const x = 1;' }],
      shallow: true,
    });
    const res = await post('/api/summon', {
      repoUrl: 'https://github.com/owner/repo',
      file: 'a.js',
      startLine: 3,
      endLine: 3,
    });
    expect(res.status).toBe(200);
    const body = SummonResponseSchema.parse(await res.json());
    expect(body.shallow).toBe(true);
    expect(body.lines).toEqual([{ n: 3, text: 'const x = 1;' }]);
    expect(body.persona).toEqual({ author: 'Unknown Author' });
    expect(sessions.get(body.sessionId)?.sample).toBeUndefined();
  });

  it('a ledger without lines or shallow gives [] and false', async () => {
    buildLedgerMock.mockResolvedValueOnce({
      items: [],
      truncated: false,
      buildDurationMs: 1,
    });
    const res = await post('/api/summon', SAMPLE_INPUT.crypt);
    const body = SummonResponseSchema.parse(await res.json());
    expect(body.lines).toEqual([]);
    expect(body.shallow).toBe(false);
  });
});

describe('POST /api/summon — HISTORY_ERROR (R8.1)', () => {
  it('a HistoryError from buildLedger gives 422 with the fixed message, logged in full', async () => {
    const raw =
      'git log -L1,9:legacy/tax.js failed in /tmp/seance-x: timed out after 10000ms';
    buildLedgerMock.mockRejectedValueOnce(new errors.HistoryError(raw));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await post('/api/summon', SAMPLE_INPUT.crypt);
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      code: 'HISTORY_ERROR',
      message:
        'Git could not read the history of these lines in time. Try a smaller range, or try again.',
    });
    expect(text).not.toContain('/tmp');
    expect(JSON.stringify(log.mock.calls)).toContain(raw);
  });
});
