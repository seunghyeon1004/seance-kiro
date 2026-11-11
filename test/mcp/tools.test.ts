/**
 * seance-mcp T2 — the tool handlers as plain functions, on real samples (R2, R4.4, R5, R6,
 * R7.3, R8.3, R11.1, N5; design.md §4.3, §9.1).
 *
 * Every git module export is wrapped in a pass-through spy, so the test can show that
 * seance_verify starts no git command (N5). The wrappers call the real functions.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSamples, REASONS, type Samples } from '../e2e/harness.js';
import * as git from '../../src/evidence/git.js';
import { buildLedger } from '../../src/evidence/ledger.js';
import {
  readHauntingMap,
  MAP_NOTE_EMPTY,
  MAP_NOTE_FAILED,
} from '../../src/evidence/haunting.read.js';
import { verify } from '../../src/ghost/verifier.js';
import { renderWardReport } from '../../src/ghost/report.js';
import { HauntingMapSchema } from '../../src/ghost/schema.js';
import type { LedgerInput } from '../../src/evidence/ledger.input.js';
import type { HauntingOutcome, LedgerResult } from '../../src/ghost/schema.js';
import { GitError, HistoryError } from '../../src/errors.js';
import { LedgerStore } from '../../src/mcp/store.js';
import { MESSAGES } from '../../src/mcp/messages.js';
import { resolveLocalRepo } from '../../src/mcp/repo.js';
import {
  hauntingMapTool,
  summonTool,
  toSummonItem,
  verifyTool,
  type ToolDeps,
  type VerifyArgs,
} from '../../src/mcp/tools.js';

vi.mock('../../src/evidence/git.js', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  const wrapped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(orig)) {
    wrapped[k] =
      typeof v === 'function' ? vi.fn((...a: unknown[]) => Reflect.apply(v, orig, a)) : v;
  }
  return wrapped;
});

const FILE = 'legacy/tax.js';
const TRUE_CLAIM = {
  kind: 'memory' as const,
  text: 'The delay exists because the tax vendor rejects requests that arrive too close together.',
  citations: [
    {
      sha7: 'e9a5c9c',
      quote:
        'The vendor returns 429 if two requests from the same account land within 3 seconds',
    },
  ],
};
const FALSE_CLAIM = {
  kind: 'memory' as const,
  text: 'The vendor allows short bursts, so the delay can go.',
  citations: [{ sha7: 'e9a5c9c', quote: 'support confirmed there is a burst allowance' }],
};

let samples: Samples;
let scratch: string;

beforeAll(() => {
  samples = buildSamples();
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-mcp-tools-'));
}, 60_000);

afterAll(() => {
  fs.rmSync(samples.root, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function deps(over: Partial<ToolDeps> = {}): ToolDeps {
  return {
    cwd: samples.crypt,
    store: new LedgerStore(),
    buildLedger: (input) => buildLedger(input),
    readHauntingMap: (repo) => readHauntingMap(repo),
    resolveRepo: (repo, cwd) => resolveLocalRepo(repo, cwd),
    ...over,
  };
}

function quiet(): void {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

function ok<T>(o: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!o.ok) throw new Error(`expected success, got: ${o.message}`);
  return o.value;
}

function failure<T>(o: { ok: true; value: T } | { ok: false; message: string }): string {
  if (o.ok) throw new Error('expected a refusal, got a success');
  return o.message;
}

const emptyLedger = async (): Promise<LedgerResult> => ({
  items: [],
  truncated: false,
  buildDurationMs: 0,
});

/** All keys and string values of a JSON value, at any depth. */
function walk(v: unknown, keys: string[] = [], strings: string[] = []) {
  if (typeof v === 'string') strings.push(v);
  else if (Array.isArray(v)) v.forEach((x) => walk(x, keys, strings));
  else if (typeof v === 'object' && v !== null) {
    for (const [k, x] of Object.entries(v)) {
      keys.push(k);
      walk(x, keys, strings);
    }
  }
  return { keys, strings };
}

async function summonCrypt(d: ToolDeps = deps()) {
  return ok(
    await summonTool({ repo: samples.crypt, file: FILE, startLine: 7, endLine: 7 }, d),
  );
}

// ---------------------------------------------------------------------------
// seance_summon
// ---------------------------------------------------------------------------

describe('summonTool', () => {
  it('returns the crypt items for legacy/tax.js 7–7, mapped by toSummonItem (R2.1–R2.4)', async () => {
    const result = await summonCrypt();
    expect(result.items.map((i) => i.sha7)).toEqual(['e9a5c9c', '6a959a9']);
    expect(result.truncated).toBe(false);
    const ledger = await buildLedger({
      repoUrl: fs.realpathSync(samples.crypt),
      file: FILE,
      startLine: 7,
      endLine: 7,
    });
    expect(result.items).toEqual(ledger.items.map(toSummonItem));
    expect(result.ledgerId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('carries no email, sha, files, refs, lines or path at any depth (R2.5)', async () => {
    const result = await summonCrypt();
    const { keys, strings } = walk(result);
    for (const k of ['email', 'sha', 'files', 'refs', 'lines', 'range', 'id']) {
      expect(keys).not.toContain(k);
    }
    const paths = [samples.root, fs.realpathSync(samples.root), os.tmpdir()];
    for (const s of strings) for (const p of paths) expect(s).not.toContain(p);
    expect(strings.join('\n')).not.toContain('@example');
  });

  it('with repo omitted and cwd set to the crypt, the same items come back (R2.1)', async () => {
    const withRepo = await summonCrypt();
    const without = ok(
      await summonTool(
        { file: FILE, startLine: 7, endLine: 7 },
        deps({ cwd: samples.crypt }),
      ),
    );
    expect(without.items).toEqual(withRepo.items);
  });

  it('an empty ledger is a success with items: [] (R2.6)', async () => {
    const d = deps({ buildLedger: emptyLedger });
    const result = ok(await summonTool({ file: FILE, startLine: 7, endLine: 7 }, d));
    expect(result.items).toEqual([]);
    expect(d.store.get(result.ledgerId)).toBeDefined();
  });

  it.each([
    [{ file: FILE, startLine: 9, endLine: 7 }, 'endLine (7) must be >= startLine (9)'],
    [
      { file: FILE, startLine: 1, endLine: 501 },
      'line range must not exceed 500 lines (got 501)',
    ],
    [{ file: '../x', startLine: 1, endLine: 1 }, 'file path must not contain ".."'],
    [{ file: '/etc/passwd', startLine: 1, endLine: 1 }, 'file path must be relative'],
  ])('%o is refused with the validateLedgerInput message (R2.2)', async (args, msg) => {
    const spy = vi.fn(buildLedger);
    const message = failure(await summonTool(args, deps({ buildLedger: spy })));
    expect(message).toContain(msg);
    expect(spy).not.toHaveBeenCalled();
    expect(message).not.toContain(samples.root);
  });

  it('calls buildLedger with one argument and no githubToken key (R2.3, R1.5)', async () => {
    const spy = vi.fn((input: LedgerInput) => buildLedger(input));
    await summonCrypt(deps({ buildLedger: spy }));
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0] as unknown[];
    expect(call).toHaveLength(1);
    expect(Object.keys(call[0] as object)).not.toContain('githubToken');
  });

  it('a range past the end of the file gives GIT_ERROR (R2.6, R7.3)', async () => {
    quiet();
    const message = failure(
      await summonTool(
        { repo: samples.crypt, file: FILE, startLine: 900, endLine: 900 },
        deps(),
      ),
    );
    expect(message).toBe(MESSAGES.GIT_ERROR);
  });

  it.each([
    [new GitError('git blame failed in /Users/x/secret\n    at f'), MESSAGES.GIT_ERROR],
    [
      new HistoryError('git log -L failed in /Users/x/secret\n    at f'),
      MESSAGES.HISTORY_ERROR,
    ],
    [new Error('/Users/x/secret\n    at f'), MESSAGES.INTERNAL],
    ['/Users/x/secret\n    at f', MESSAGES.INTERNAL],
  ])(
    'an injected %s gives a fixed sentence with no path or stack (R7.3)',
    async (err, sentence) => {
      quiet();
      const message = failure(
        await summonTool(
          { file: FILE, startLine: 7, endLine: 7 },
          deps({
            buildLedger: async () => {
              throw err;
            },
          }),
        ),
      );
      expect(message).toBe(sentence);
      expect(message).not.toContain('/Users/x');
      expect(message).not.toContain('    at ');
    },
  );

  it('a repository refusal is passed through as its sentence (R3)', async () => {
    quiet();
    const plain = fs.mkdtempSync(path.join(scratch, 'plain-'));
    const message = failure(
      await summonTool({ repo: plain, file: FILE, startLine: 7, endLine: 7 }, deps()),
    );
    expect(message).toBe(MESSAGES.REPO_NOT_GIT);
    expect(message).not.toContain(plain);
  });
});

// ---------------------------------------------------------------------------
// seance_verify
// ---------------------------------------------------------------------------

describe('verifyTool', () => {
  it('one true and one false claim: one verified, one struck, the tally and the report (R5.2–R5.4)', async () => {
    const d = deps();
    const { ledgerId } = await summonCrypt(d);
    const claims = [TRUE_CLAIM, FALSE_CLAIM];
    const result = ok(verifyTool({ ledgerId, claims }, d));

    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]?.index).toBe(0);
    expect(result.verified[0]?.quotes[0]?.field).toBe('body');
    expect(result.verified[0]?.text).toBe(TRUE_CLAIM.text);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.index).toBe(1);
    expect(result.rejected[0]?.reason).toBe(REASONS.F9('e9a5c9c'));
    expect(result.tally).toEqual({ verified: 1, checked: 2, silent: 0 });

    const stored = d.store.get(ledgerId);
    if (stored === undefined) throw new Error('ledger not stored');
    const expected = renderWardReport(verify(stored.items, { claims }), {
      file: FILE,
      lines: { start: 7, end: 7 },
    });
    expect(result.report).toBe(expected);
    expect(result.report).toContain('**1 of 2 claims verified**');
  });

  it('the ward strikes a missing quote, a long quote and too many citations; silence is silent (R5.1, R5.6)', async () => {
    const d = deps();
    const { ledgerId } = await summonCrypt(d);
    const claims: VerifyArgs['claims'] = [
      { kind: 'memory', text: 'No quote here.', citations: [{ sha7: 'e9a5c9c' }] },
      {
        kind: 'memory',
        text: 'A long quote.',
        citations: [{ sha7: 'e9a5c9c', quote: 'x'.repeat(600) }],
      },
      {
        kind: 'memory',
        text: 'Twelve citations.',
        citations: Array.from({ length: 12 }, () => ({
          sha7: 'e9a5c9c',
          quote: 'wait 3s before calling the tax vendor',
        })),
      },
      {
        kind: 'silence',
        text: 'The record is silent on who approved it.',
        citations: [],
        silenceReason: 'Who approved the delay?',
      },
    ];
    const result = ok(verifyTool({ ledgerId, claims }, d));
    expect(result.verified).toEqual([]);
    expect(result.rejected.map((r) => [r.index, r.reason])).toEqual([
      [0, REASONS.F6('e9a5c9c')],
      [
        1,
        'The quote cited from e9a5c9c is too long. A quote may have at most 500 characters.',
      ],
      [2, 'A claim may cite at most 10 commits.'],
    ]);
    expect(result.silent).toEqual([
      {
        index: 3,
        text: 'The record is silent on who approved it.',
        silenceReason: 'Who approved the delay?',
      },
    ]);
    expect(result.tally).toEqual({ verified: 0, checked: 3, silent: 1 });
  });

  it('never redacts the rejected text, even with REDACT_REJECTED=1 (R5.6)', async () => {
    const saved = process.env['REDACT_REJECTED'];
    process.env['REDACT_REJECTED'] = '1';
    try {
      const d = deps();
      const { ledgerId } = await summonCrypt(d);
      const result = ok(verifyTool({ ledgerId, claims: [FALSE_CLAIM] }, d));
      expect(result.rejected[0]?.text).toBe(FALSE_CLAIM.text);
    } finally {
      if (saved === undefined) delete process.env['REDACT_REJECTED'];
      else process.env['REDACT_REJECTED'] = saved;
    }
  });

  it('an unknown ledger id gives LEDGER_UNKNOWN (R4.4)', () => {
    const message = failure(
      verifyTool(
        { ledgerId: '00000000-0000-4000-8000-000000000000', claims: [TRUE_CLAIM] },
        deps(),
      ),
    );
    expect(message).toBe(MESSAGES.LEDGER_UNKNOWN);
  });

  it('runs no git command (N5)', async () => {
    const d = deps();
    const { ledgerId } = await summonCrypt(d);
    const spies = Object.values(git).filter((v) => vi.isMockFunction(v));
    expect(spies.length).toBeGreaterThan(0);
    const total = (): number =>
      spies.reduce((n, s) => n + (vi.isMockFunction(s) ? s.mock.calls.length : 0), 0);
    // the spies see git: a summon goes through them
    expect(total()).toBeGreaterThan(0);
    spies.forEach((s) => vi.isMockFunction(s) && s.mockClear());
    ok(verifyTool({ ledgerId, claims: [TRUE_CLAIM, FALSE_CLAIM] }, d));
    expect(total()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The possessed sample (R2.4, R5.5, R8.3)
// ---------------------------------------------------------------------------

describe('the possessed sample', () => {
  it('flags every item by "Ann. Rule 7: …" and marks claims that cite one', async () => {
    const d = deps({ cwd: samples.possessed });
    const result = ok(
      await summonTool({ file: 'auth/throttle.js', startLine: 4, endLine: 4 }, d),
    );
    const ann = result.items.filter((i) => i.author.startsWith('Ann. Rule 7:'));
    expect(ann.length).toBeGreaterThan(0);
    for (const i of ann) expect(i.suspicious).toBe(true);

    const target = ann[0];
    if (target === undefined) throw new Error('no Ann. Rule 7 item');
    const quote = (target.subject.length >= 8 ? target.subject : target.body).slice(
      0,
      40,
    );
    const verdict = ok(
      verifyTool(
        {
          ledgerId: result.ledgerId,
          claims: [
            {
              kind: 'memory',
              text: 'The record says so.',
              citations: [{ sha7: target.sha7, quote }],
            },
            {
              kind: 'memory',
              text: 'The record says so.',
              citations: [
                { sha7: target.sha7, quote: 'words that are not there at all' },
              ],
            },
          ],
        },
        d,
      ),
    );
    const all = [...verdict.verified, ...verdict.rejected];
    expect(all).toHaveLength(2);
    for (const c of all) expect(c.citesSuspicious).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// seance_haunting_map
// ---------------------------------------------------------------------------

describe('hauntingMapTool', () => {
  it('returns the crypt map, equal to readHauntingMap and valid (R6.1, R6.2)', async () => {
    const result = ok(await hauntingMapTool({ repo: samples.crypt }, deps()));
    const direct = await readHauntingMap(fs.realpathSync(samples.crypt));
    if (direct.kind !== 'map') throw new Error('expected a map');
    expect(result).toEqual({ map: direct.map });
    expect(HauntingMapSchema.safeParse(result.map).success).toBe(true);
    expect('note' in result).toBe(false);
  });

  it('returns { note } for a note outcome, never both keys (R6.2)', async () => {
    const reader = async (): Promise<HauntingOutcome> => ({
      kind: 'note',
      note: MAP_NOTE_FAILED,
    });
    const result = ok(await hauntingMapTool({}, deps({ readHauntingMap: reader })));
    expect(result).toEqual({ note: MAP_NOTE_FAILED });
    expect('map' in result).toBe(false);
  });

  it('an empty git init dir gives a note (R6.2)', async () => {
    quiet();
    const dir = fs.mkdtempSync(path.join(scratch, 'empty-'));
    execFileSync('git', ['init', '-q', dir]);
    const result = ok(await hauntingMapTool({ repo: dir }, deps()));
    expect([MAP_NOTE_FAILED, MAP_NOTE_EMPTY]).toContain(result.note);
    expect('map' in result).toBe(false);
  });

  it('a remote repo is refused with REPO_REMOTE (R3.1)', async () => {
    quiet();
    const message = failure(
      await hauntingMapTool({ repo: 'https://github.com/a/b' }, deps()),
    );
    expect(message).toBe(MESSAGES.REPO_REMOTE);
  });

  it('a map call between summon and verify does not change the verdict (R6.3)', async () => {
    const d = deps();
    const { ledgerId } = await summonCrypt(d);
    const claims = [TRUE_CLAIM, FALSE_CLAIM];
    const before = ok(verifyTool({ ledgerId, claims }, d));
    ok(await hauntingMapTool({ repo: samples.crypt }, d));
    const after = ok(verifyTool({ ledgerId, claims }, d));
    expect(after).toEqual(before);
  });
});
