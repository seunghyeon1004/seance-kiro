/**
 * first-seance correctness properties CP1–CP5 (design.md §11), with fast-check (1,000 runs;
 * FAST_CHECK_SEED honoured). public/app.js is a classic browser script, so the pure functions
 * under test are extracted from its source text, as test/ui/pbt/ui.pbt.ts does.
 */
import { describe, expect, it } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const js = readFileSync(resolve(__dirname, '../../../public/app.js'), 'utf8');

const SEED = process.env['FAST_CHECK_SEED']
  ? parseInt(process.env['FAST_CHECK_SEED'], 10)
  : undefined;
const params: fc.Parameters<unknown> = {
  numRuns: 1_000,
  ...(SEED !== undefined ? { seed: SEED } : {}),
};

/** Return the source of `function name(...) {...}` from app.js (brace matched). */
function extractFunction(name: string): string {
  const start = js.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in app.js`);
  let depth = 0;
  for (let i = js.indexOf(') {', start) + 2; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}' && --depth === 0) return js.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/** Return the source of `const name = ...;` from app.js, up to the first `;\n`. */
function extractConst(name: string): string {
  const start = js.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`const ${name} not found in app.js`);
  const end = js.indexOf(';\n', start);
  return js.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// CP4 — retry rule (R5.4, R5.5)
// ---------------------------------------------------------------------------

describe('CP4 — shouldRetry retries only a proxy 502/503/504 page; a network failure only where no model can run twice (R5.4, R5.5, R14.4)', () => {
  const shouldRetry = (): ((status: number, data: unknown) => boolean) =>
    new Function(`${extractFunction('shouldRetry')}; return shouldRetry;`)() as (
      status: number,
      data: unknown,
    ) => boolean;

  const notOurError = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.array(fc.anything()),
    fc.record({ message: fc.string() }),
    fc.record({ code: fc.oneof(fc.integer(), fc.constant(null), fc.boolean()) }),
  );

  test.prop([fc.integer({ min: 100, max: 599 }), notOurError], params)(
    'true exactly for 502, 503 and 504 when the body is not our JSON error',
    (status, data) => {
      expect(shouldRetry()(status, data)).toBe([502, 503, 504].includes(status));
    },
  );

  test.prop(
    [
      fc.integer({ min: 100, max: 599 }),
      fc.string(),
      fc.dictionary(fc.string(), fc.anything()),
    ],
    params,
  )('false for every status when the body has a string code', (status, code, extra) => {
    expect(shouldRetry()(status, { ...extra, code })).toBe(false);
  });

  // first-seance R14.4, R16.1 (inquisitor reviews, 2026-11-11): a rejected fetch or a proxy
  // error page may hide a request the server already ran, so the model-calling POSTs are never
  // sent again automatically, whatever the failure
  const mayRetry = (): ((path: string, method: string) => boolean) =>
    new Function(
      `${extractConst('NO_REPLAY_PATHS')}\n${extractFunction('mayRetry')}; return mayRetry;`,
    )() as (path: string, method: string) => boolean;

  const MODEL_POSTS = ['/api/ask', '/api/exorcise'];
  const pathArb = fc.oneof(
    fc.constantFrom(
      '/api/ask',
      '/api/exorcise',
      '/api/summon',
      '/api/ward',
      '/api/possess',
      '/api/health',
    ),
    fc.string(),
  );

  test.prop([pathArb, fc.constantFrom('GET', 'POST')], params)(
    'false exactly for a POST to /api/ask or /api/exorcise',
    (path, method) => {
      expect(mayRetry()(path, method)).toBe(
        !(method === 'POST' && MODEL_POSTS.includes(path)),
      );
    },
  );

  it('api() asks mayRetry before retrying a rejected fetch or a proxy page (R14.4, R16.1)', () => {
    const src = extractFunction('api');
    expect(src).toContain('mayRetry(path, init.method)');
    expect(src).toContain('!retryable');
    expect(src).toContain('CONNECTION_DROPPED');
    expect(src).toContain('notAnswered(res.status)');
  });
});

// ---------------------------------------------------------------------------
// CP5 — wait in words (R10.2)
// ---------------------------------------------------------------------------

describe('CP5 — waitInWords never understates the wait (R10.2)', () => {
  const waitInWords = new Function(
    `${extractFunction('waitInWords')}; return waitInWords;`,
  )() as (sec: number) => string;
  const UNIT: Record<string, number> = {
    second: 1,
    seconds: 1,
    minute: 60,
    minutes: 60,
    hour: 3600,
    hours: 3600,
  };
  const RE = /^Try again in (?:about )?(\d+) (seconds?|minutes?|hours?)\.$/;

  test.prop(
    [
      fc.oneof(
        fc.double({ min: Number.MIN_VALUE, max: 1e7, noNaN: true }),
        fc.integer({ min: 1, max: 200_000 }),
      ),
    ],
    params,
  )('names n >= 1 of a unit with n * unit >= sec, singular only for 1', (sec) => {
    const s = waitInWords(sec);
    const m = RE.exec(s);
    expect(m, s).not.toBeNull();
    const n = Number(m![1]);
    const unit = m![2]!;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n * UNIT[unit]!).toBeGreaterThanOrEqual(sec);
    expect(unit.endsWith('s')).toBe(n !== 1);
    expect(s.includes('about')).toBe(unit.startsWith('hour'));
  });

  test.prop(
    [
      fc.oneof(
        fc.double({ max: 0, noNaN: true }),
        fc.constant(Number.NaN),
        fc.constant(Number.POSITIVE_INFINITY),
        fc.constant(Number.NEGATIVE_INFINITY),
      ),
    ],
    params,
  )('is empty for sec <= 0, NaN or Infinity', (sec) => {
    expect(waitInWords(sec)).toBe('');
  });

  test('the copy of design.md §9', () => {
    expect(waitInWords(1)).toBe('Try again in 1 second.');
    expect(waitInWords(30)).toBe('Try again in 30 seconds.');
    expect(waitInWords(300)).toBe('Try again in 5 minutes.');
    expect(waitInWords(60)).toBe('Try again in 1 minute.');
    expect(waitInWords(7 * 3600 - 5)).toBe('Try again in about 7 hours.');
  });
});

// ---------------------------------------------------------------------------
// CP1–CP3 — normaliseRepoInput (R9.1–R9.3, R9.6)
// ---------------------------------------------------------------------------

type Normalised = {
  repoUrl: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  note?: string;
};
const normaliseRepoInput = (): ((text: unknown) => Normalised) =>
  new Function(
    `${extractConst('BLOB_NOTE')}\n${extractConst('TREE_NOTE')}\n${extractFunction('normaliseRepoInput')}; return normaliseRepoInput;`,
  )() as (text: unknown) => Normalised;

const ALLOW = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;
const BLOB_NOTE =
  'Filled in the file and lines from the link. Séance reads the default branch, not the branch or commit in the link.';
const TREE_NOTE =
  'That link points at a folder. Finish the file path in the File field. Séance reads the default branch.';

const seg = fc
  .stringMatching(/^[A-Za-z0-9_.-]{1,20}$/)
  .filter((s) => s !== '.' && s !== '..');
const repoSeg = seg.filter((s) => !/\.git$/i.test(s));

describe('CP1 — no widening (R9.2, R9.6)', () => {
  const hostile = fc.oneof(
    fc.constant('http://evil.example/github.com/o/r'),
    fc.constant('github.com.evil.example/o/r'),
    fc.constant('https://github.com@evil.example/o/r'),
    fc.constant('https://github.com:443@evil.example/o/r'),
    fc.constant('javascript:alert(1)//github.com/o/r'),
    fc.constant('https://github.com/o/r/../../evil'),
    fc.constant('https://github.com/%2e%2e/r'),
    fc.constant('https://github.com/o r/x'),
    fc.constant('https://github.com/o/r\n.evil'),
    fc.constant('//github.com/o/r'),
    fc.constant('https://github.com/./r'),
    fc.constant('https://github.com/o/.git'),
  );
  const pasted = fc
    .tuple(
      fc.constantFrom('', 'http://', 'https://', 'HTTPS://', ' '),
      fc.constantFrom('', 'www.', 'WWW.'),
      fc.constantFrom('github.com/', 'GitHub.com/', 'github.com//', 'gitlab.com/'),
      fc.string({ unit: 'grapheme', maxLength: 30 }),
      fc.constantFrom('', '/', '.git', '#L1', '?x=1', '/blob/main/a.js#L2-L3'),
    )
    .map((p) => p.join(''));

  test.prop(
    [
      fc.oneof(
        hostile,
        pasted,
        fc.string({ unit: 'binary' }),
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant(undefined)),
      ),
    ],
    params,
  )('the result is the trimmed input or matches the server allowlist', (s) => {
    const out = normaliseRepoInput()(s);
    expect(typeof out.repoUrl).toBe('string');
    const raw = String(s ?? '').trim();
    expect(out.repoUrl === raw || ALLOW.test(out.repoUrl), out.repoUrl).toBe(true);
  });
});

describe('CP2 — canonical form (R9.1, R9.2)', () => {
  test.prop(
    [
      seg,
      repoSeg,
      fc.constantFrom('', 'http://', 'https://', 'HTTPS://', 'Http://'),
      fc.constantFrom('', 'www.', 'WWW.'),
      fc.constantFrom('github.com', 'GITHUB.COM', 'GitHub.com'),
      fc.boolean(),
      fc.boolean(),
    ],
    params,
  )(
    'any pasted form gives https://github.com/owner/repo, and is a fixed point',
    (o, r, scheme, www, host, git, slash) => {
      const fn = normaliseRepoInput();
      const s = `${scheme}${www}${host}/${o}/${r}${git ? '.git' : ''}${slash ? '/' : ''}`;
      const out = fn(s);
      expect(out.repoUrl).toBe(`https://github.com/${o}/${r}`);
      expect(out.file).toBeUndefined();
      expect(out.note).toBeUndefined();
      expect(fn(out.repoUrl)).toEqual({ repoUrl: out.repoUrl });
    },
  );
});

describe('CP3 — blob links (R9.3)', () => {
  const ref = fc.stringMatching(/^[\w.-]{1,12}$/);
  const path = fc.array(fc.stringMatching(/^[\w.-]{1,12}$/), {
    minLength: 1,
    maxLength: 4,
  });
  const line = fc.integer({ min: 1, max: 1_000_000 });

  test.prop([seg, repoSeg, ref, path, line, line], params)(
    '#La-Lb fills the file and the sorted lines, with the note',
    (o, r, rf, p, a, b) => {
      const file = p.join('/');
      const out = normaliseRepoInput()(
        `https://github.com/${o}/${r}/blob/${rf}/${file}#L${a}-L${b}`,
      );
      expect(out).toEqual({
        repoUrl: `https://github.com/${o}/${r}`,
        file,
        startLine: Math.min(a, b),
        endLine: Math.max(a, b),
        note: BLOB_NOTE,
      });
    },
  );

  test.prop([seg, repoSeg, ref, path, line], params)(
    '#La alone gives one line',
    (o, r, rf, p, a) => {
      const file = p.join('/');
      const out = normaliseRepoInput()(`github.com/${o}/${r}/blob/${rf}/${file}#L${a}`);
      expect(out.startLine).toBe(a);
      expect(out.endLine).toBe(a);
      expect(out.file).toBe(file);
      expect(out.note).toBe(BLOB_NOTE);
    },
  );

  test.prop([seg, repoSeg, ref, path], params)(
    'a tree link fills the folder and the tree note',
    (o, r, rf, p) => {
      const out = normaliseRepoInput()(
        `https://www.github.com/${o}/${r}/tree/${rf}/${p.join('/')}/`,
      );
      expect(out).toEqual({
        repoUrl: `https://github.com/${o}/${r}`,
        file: `${p.join('/')}/`,
        note: TREE_NOTE,
      });
    },
  );

  test('examples', () => {
    const fn = normaliseRepoInput();
    expect(fn('https://github.com/o/r/blob/main/src/a%20b.ts#L20-L10')).toEqual({
      repoUrl: 'https://github.com/o/r',
      file: 'src/a b.ts',
      startLine: 10,
      endLine: 20,
      note: BLOB_NOTE,
    });
    expect(fn('https://github.com/o/r/blob/main/a.ts#L3C2-L5C9').startLine).toBe(3);
    expect(fn('https://github.com/o/r/blob/main/a.ts#L0')).toEqual({
      repoUrl: 'https://github.com/o/r',
      file: 'a.ts',
      note: BLOB_NOTE,
    });
    expect(fn('https://github.com/o/r/blob/main/%E0%A4%A.ts')).toEqual({
      repoUrl: 'https://github.com/o/r',
    });
    expect(fn('https://github.com/o/r/pull/3')).toEqual({
      repoUrl: 'https://github.com/o/r',
    });
    expect(fn('  crypt ')).toEqual({ repoUrl: 'crypt' });
  });
});
