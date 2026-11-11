/* global Element, HTMLElement -- DOM types only; the nodes come from a jsdom document */
/**
 * spooky-ui PBT properties PU1, PU3 and PU5, with fast-check (1,000 runs; FAST_CHECK_SEED honoured).
 * public/app.js is a classic browser script, so the functions under test are extracted
 * from its source text and run against small stubs instead of a DOM.
 *
 * ward-hardening T7 adds properties for claimNode, ledgerRow, the tally and counter texts,
 * the sample-default swap, the plan nodes and tally, and the wrongauthor preset. Those run
 * against a jsdom document, used only for createElement and queries.
 */
import { describe, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { verify } from '../../../src/ghost/verifier.js';
import type { EvidenceItem } from '../../../src/ghost/schema.js';

const pub = resolve(__dirname, '../../../public');
const js = readFileSync(resolve(pub, 'app.js'), 'utf8');
const css = readFileSync(resolve(pub, 'styles.css'), 'utf8');

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
  // brace matching starts at the body, after any `= {}` default parameter
  for (let i = js.indexOf(') {', start) + 2; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}' && --depth === 0) return js.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

type Rect = { left: number; top: number; width: number; height: number };
const rectArb: fc.Arbitrary<Rect> = fc.record({
  left: fc.double({ min: -5000, max: 5000, noNaN: true }),
  top: fc.double({ min: -5000, max: 5000, noNaN: true }),
  width: fc.double({ min: 0, max: 3000, noNaN: true }),
  height: fc.double({ min: 0, max: 3000, noNaN: true }),
});

describe('PU1 - planchette angle is always finite', () => {
  const src = extractFunction('pointPlanchette');
  const make = (rows: Record<string, Rect>, planchette: Rect) => {
    const p = { style: { transform: '' }, getBoundingClientRect: () => planchette };
    const $ = (id: string) => {
      if (id === 'planchette') return p;
      const sha = id.replace('ledger-item-', '');
      const r = rows[sha];
      return r ? { getBoundingClientRect: () => r } : null;
    };
    const fn = new Function('$', `${src}; return pointPlanchette;`)($) as (
      sha: string,
    ) => void;
    return { fn, p };
  };

  test.prop([rectArb, rectArb], params)(
    'rotate() gets a finite angle for any two rectangles',
    (row, pl) => {
      const { fn, p } = make({ abc1234: row }, pl);
      fn('abc1234');
      const m = /^rotate\((-?[\d.]+)deg\)$/.exec(p.style.transform);
      expect(m).not.toBeNull();
      expect(Number.isFinite(Number(m![1]))).toBe(true);
    },
  );

  test.prop([rectArb], params)(
    'identical centres and a missing row do not throw',
    (r) => {
      const { fn, p } = make({ same: r }, r);
      expect(() => fn('same')).not.toThrow();
      expect(() => fn('missing')).not.toThrow();
      expect(
        p.style.transform === '' || /^rotate\(-?[\d.]+deg\)$/.test(p.style.transform),
      ).toBe(true);
    },
  );
});

describe('PU3 - fog opacity stays within [0, --max-fog]', () => {
  const maxFog = Number(/--max-fog:\s*([\d.]+)/.exec(css)![1]);
  const src = extractFunction('setHaunting');
  test.prop([fc.oneof(fc.double({ noNaN: false }), fc.integer(), fc.string())], params)(
    'setHaunting clamps any input, and the CSS formula maps it into range',
    (input) => {
      let set = '';
      const root = { style: { setProperty: (_k: string, v: string) => (set = v) } };
      new Function('root', `${src}; return setHaunting;`)(root)(input);
      const s = Number(set);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
      const opacity = (s / 100) * maxFog; // styles.css: calc(var(--haunting-score) / 100 * var(--max-fog))
      expect(opacity).toBeGreaterThanOrEqual(0);
      expect(opacity).toBeLessThanOrEqual(maxFog);
    },
  );
  test('the fog rule uses that formula', () => {
    expect(css).toMatch(
      /opacity:\s*calc\(var\(--haunting-score\)\s*\/\s*100\s*\*\s*var\(--max-fog\)\)/,
    );
  });
});

describe('PU5 - session counter arithmetic (ward-hardening R4.3: tally.verified of tally.checked)', () => {
  test('app.js accumulates the server tally as the property below assumes', () => {
    expect(js).toContain('state.totalVerified += data.tally.verified;');
    expect(js).toContain('state.totalClaims += data.tally.checked;');
    expect(js).toContain('state.totalSilent += data.tally.silent;');
  });
  test.prop(
    [fc.array(fc.tuple(fc.nat(50), fc.nat(50), fc.nat(50)), { maxLength: 40 })],
    params,
  )('after any sequence of answers, 0 <= N <= M', (answers) => {
    const state = { totalVerified: 0, totalClaims: 0, totalSilent: 0 };
    for (const [v, r, s] of answers) {
      const data = { tally: { verified: v, checked: v + r, silent: s } };
      state.totalVerified += data.tally.verified;
      state.totalClaims += data.tally.checked;
      state.totalSilent += data.tally.silent;
    }
    expect(state.totalVerified).toBeGreaterThanOrEqual(0);
    expect(state.totalVerified).toBeLessThanOrEqual(state.totalClaims);
    expect(state.totalSilent).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// ward-hardening T7 (design.md §11.2). The functions are extracted from app.js as above
// and run against a jsdom document (no scripts run in it; only createElement is used).
// ---------------------------------------------------------------------------

/** Return the source of `const name = …;` from app.js (brace matched for object literals). */
function extractConst(name: string): string {
  const start = js.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`const ${name} not found in app.js`);
  const open = js.indexOf('{', start);
  const semi = js.indexOf(';', start);
  if (open < 0 || semi < open) return js.slice(start, semi + 1);
  let depth = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}' && --depth === 0)
      return js.slice(start, js.indexOf(';', i) + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const domWindow = new JSDOM('<!doctype html><html><body></body></html>').window;
const document = domWindow.document;

/** Evaluate the named consts and functions of app.js with `env` as their free variables. */
function load<T>(consts: string[], fns: string[], env: Record<string, unknown>): T {
  const src = [...consts.map(extractConst), ...fns.map(extractFunction)].join('\n');
  const keys = Object.keys(env);
  return new Function(...keys, `'use strict';\n${src}\nreturn { ${fns.join(', ')} };`)(
    ...keys.map((k) => env[k]),
  ) as T;
}

const UI_CONSTS = [
  'HUNK_UI_CHARS',
  'QUOTE_MIN_CHARS',
  'QUOTE_MAX_CHARS',
  'FIELD_LABEL',
  'SAMPLE_DEFAULTS',
];
const UI_FNS = [
  'el',
  'citeButtons',
  'foundNode',
  'claimNode',
  'ledgerRow',
  'silenceNote',
  'counterText',
  'sampleSwap',
  'planTally',
  'planClaims',
  'stepNodes',
  'dntNodes',
  'droppedNodes',
  'isWordChar',
  'namesAsWord',
  'wrongAuthorPreset',
];

interface Ui {
  claimNode: (c: unknown, bucket: 'verified' | 'rejected' | 'silent') => HTMLElement;
  ledgerRow: (i: unknown) => HTMLElement;
  silenceNote: (s: number) => string;
  counterText: (tv: number, tc: number, ts: number) => string;
  sampleSwap: (
    repo: string,
    fields: { file: string; start: string; end: string },
  ) => { file: string; start: number; end: number } | null;
  planTally: (plan: unknown) => { ok: number; total: number };
  stepNodes: (steps: unknown[]) => HTMLElement[];
  dntNodes: (entries: unknown[]) => HTMLElement[];
  droppedNodes: (dropped: unknown[]) => HTMLElement[];
  wrongAuthorPreset: (
    items: unknown[],
  ) => { text: string; sha7: string; quote: string } | null;
}

const ui = load<Ui>(UI_CONSTS, UI_FNS, {
  document,
  state: { items: new Map() },
  lightRows: () => undefined,
  focusCommit: () => undefined,
  dateFmt: new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }),
});

const WARN = 'Cites a commit that tries to give the ghost orders';
const SILENT_LABEL = "The record is silent (the ghost's words, not checked)";
const FIELD_TEXT = {
  subject: 'in the commit subject',
  body: 'in the commit message',
  hunk: 'in the diff',
} as const;

/** Untrusted text, including markup that must stay text. */
const untrusted = fc.oneof(
  fc.string({ minLength: 1 }),
  fc.fullUnicodeString({ minLength: 1 }),
  fc.constantFrom(
    '<img src=x onerror=alert(1)>',
    '</article><script>alert(1)</script>',
    '&lt;b&gt; & "quoted"',
  ),
);
const sha7Arb = fc.hexaString({ minLength: 7, maxLength: 7 }).map((s) => s.toLowerCase());
const fieldArb = fc.constantFrom('subject', 'body', 'hunk') as fc.Arbitrary<
  keyof typeof FIELD_TEXT
>;
const quoteArb = fc.record({ sha7: sha7Arb, quote: untrusted, field: fieldArb });
/** Only these tags may appear: app.js builds every node, nothing is parsed from data. */
const ALLOWED_TAGS = new Set(['ARTICLE', 'SPAN', 'BUTTON', 'DIV', 'P', 'UL', 'LI', 'Q']);
const tagsOk = (n: Element) =>
  [...n.querySelectorAll('*')].every((x) => ALLOWED_TAGS.has(x.tagName));
const labs = (n: Element) => [...n.querySelectorAll('.lab')].map((x) => x.textContent);

describe('claimNode - verified, silent and rejected (R2.2, R4.5, R6.4)', () => {
  test.prop(
    [
      fc.constantFrom('memory', 'speculation'),
      untrusted,
      fc.array(quoteArb, { minLength: 1, maxLength: 4 }),
      fc.boolean(),
    ],
    params,
  )(
    'a verified claim shows the words the ward found, with field labels',
    (kind, text, quotes, sus) => {
      const n = ui.claimNode(
        {
          kind,
          text,
          citations: quotes.map((q) => ({ sha7: q.sha7, quote: q.quote })),
          speculative: kind === 'speculation',
          quotes,
          citesSuspicious: sus,
        },
        'verified',
      );
      expect(n.tagName).toBe('ARTICLE');
      expect(n.className).toBe(`claim ${kind}`);
      expect(n.querySelector('.txt')?.textContent).toBe(text);
      expect(labs(n)).toEqual([
        ...(kind === 'speculation' ? ['Speculation'] : []),
        ...(sus ? [WARN] : []),
      ]);
      const found = n.querySelector('.found');
      expect(found?.querySelector('.found-head')?.textContent).toBe(
        'The words the ward found',
      );
      const lis = [...(found?.querySelectorAll('.found-list > li') ?? [])];
      expect(lis).toHaveLength(quotes.length);
      lis.forEach((li, j) => {
        const q = quotes[j]!;
        expect(li.querySelector('.sha')?.textContent).toBe(q.sha7);
        expect(li.querySelector('q.found-quote')?.textContent).toBe(q.quote);
        expect(li.textContent).toBe(`${q.sha7} ${FIELD_TEXT[q.field]}: ${q.quote}`);
      });
      // found list comes after the cite buttons (design.md §11.2)
      expect(n.lastElementChild).toBe(found);
      expect(n.querySelector('.why')).toBeNull();
      expect(tagsOk(n)).toBe(true);
    },
  );

  test.prop([untrusted, untrusted], params)(
    'a silence claim has its own label and the unanswered question',
    (text, silenceReason) => {
      const n = ui.claimNode({ text, silenceReason }, 'silent');
      expect(n.className).toBe('claim silence');
      expect(labs(n)).toEqual([SILENT_LABEL]);
      expect(n.querySelector('.txt')?.textContent).toBe(text);
      expect(n.querySelector('.why')?.textContent).toBe(
        `Unanswered question: ${silenceReason}`,
      );
      expect(n.querySelector('.found')).toBeNull();
      expect(n.querySelector('.cites')).toBeNull();
      expect(tagsOk(n)).toBe(true);
    },
  );

  test.prop([untrusted, fc.string(), untrusted, fc.boolean()], params)(
    'a rejected claim shows the reason, and the warning when it cites a flagged commit',
    (text, kind, reason, sus) => {
      const n = ui.claimNode({ text, kind, reason, citesSuspicious: sus }, 'rejected');
      expect(n.className).toBe('claim rejected');
      expect(labs(n)).toEqual(['Unverified', ...(sus ? [WARN] : [])]);
      expect(n.querySelector('.txt')?.textContent).toBe(text);
      expect(n.querySelector('.why')?.textContent).toBe(`The ward refused it: ${reason}`);
      expect(n.querySelector('.found')).toBeNull();
      expect(tagsOk(n)).toBe(true);
    },
  );
});

describe('ledgerRow - suspicious commits are marked in text (R6.3)', () => {
  test.prop(
    [
      fc.record({
        shortSha: sha7Arb,
        author: untrusted,
        date: fc
          .date({ min: new Date('1970-01-01'), max: new Date('2099-12-31') })
          .map((d) => d.toISOString()),
        subject: untrusted,
        body: fc.string(),
        hunk: fc.string(),
        suspiciousMessage: fc.boolean(),
      }),
    ],
    params,
  )('data-suspicious and the label appear exactly when the item is flagged', (i) => {
    const li = ui.ledgerRow(i);
    expect(li.querySelector('.who')?.textContent).toBe(i.author);
    expect(li.querySelector('.subject')?.textContent).toBe(i.subject);
    const warn = li.querySelector('.lab.warn');
    if (i.suspiciousMessage) {
      expect(li.getAttribute('data-suspicious')).toBe('true');
      expect(warn?.tagName).toBe('P');
      expect(warn?.textContent).toBe('This commit tries to give the ghost orders');
      expect(li.querySelector('.subject')?.nextElementSibling).toBe(warn);
    } else {
      expect(li.hasAttribute('data-suspicious')).toBe(false);
      expect(warn).toBeNull();
    }
  });
});

describe('tally and counter texts (R4.3)', () => {
  test('silence notes, singular and plural', () => {
    expect(ui.silenceNote(0)).toBe('');
    expect(ui.silenceNote(1)).toBe(' 1 silence claim was not checked.');
    expect(ui.silenceNote(2)).toBe(' 2 silence claims were not checked.');
  });
  test.prop([fc.nat(200), fc.nat(200), fc.nat(200)], params)(
    'the counter reads tally.verified of tally.checked, plus the silence count',
    (tv, extra, ts) => {
      const tc = tv + extra;
      const want =
        tc + ts === 0
          ? ''
          : `${tv} of ${tc} claims verified this séance` +
            (ts > 0
              ? `, plus ${ts} silence claim${ts === 1 ? '' : 's'} not checked`
              : '');
      expect(ui.counterText(tv, tc, ts)).toBe(want);
    },
  );
});

describe('sample-default swap (R8.4)', () => {
  const D = {
    crypt: { file: 'legacy/tax.js', start: 7, end: 7 },
    possessed: { file: 'auth/throttle.js', start: 4, end: 4 },
  } as const;
  const asFields = (d: { file: string; start: number; end: number }) => ({
    file: d.file,
    start: String(d.start),
    end: String(d.end),
  });
  const fieldsArb = fc.oneof(
    fc.constant(asFields(D.crypt)),
    fc.constant(asFields(D.possessed)),
    fc.record({ file: fc.string(), start: fc.string(), end: fc.string() }),
    fc.record({
      file: fc.constantFrom(D.crypt.file, D.possessed.file),
      start: fc.constantFrom('4', '7', '5'),
      end: fc.constantFrom('4', '7', '5'),
    }),
  );
  const repoArb = fc.oneof(
    fc.constantFrom('crypt', 'possessed', 'constructor', '__proto__', 'toString'),
    fc.string(),
  );
  test.prop([repoArb, fieldsArb], params)(
    'fills in the chosen sample only when the fields hold the other sample\u2019s defaults',
    (repo, fields) => {
      const got = ui.sampleSwap(repo, fields);
      const other =
        repo === 'crypt' ? D.possessed : repo === 'possessed' ? D.crypt : undefined;
      const swap =
        other !== undefined &&
        fields.file === other.file &&
        fields.start === String(other.start) &&
        fields.end === String(other.end);
      if (swap) expect(got).toEqual(D[repo as keyof typeof D]);
      else expect(got).toBeNull();
    },
  );
});

describe('exorcism plan (R7.4, R7.5, R7.6)', () => {
  const claimArb = fc.record({
    text: fc.string({ minLength: 1 }),
    kind: fc.constant('memory'),
    citations: fc.constant([{ sha7: 'abc1234', quote: 'exact words' }]),
    speculative: fc.constant(false),
    quotes: fc.constant([{ sha7: 'abc1234', quote: 'exact words', field: 'subject' }]),
    citesSuspicious: fc.boolean(),
  });
  const rejArb = fc.record({
    text: fc.string(),
    kind: fc.constant('memory'),
    reason: fc.string({ minLength: 1 }),
    citesSuspicious: fc.boolean(),
  });
  const stepArb = fc.record({
    description: untrusted,
    rationale: untrusted,
    reversible: fc.boolean(),
    claims: fc.array(claimArb, { minLength: 1, maxLength: 3 }),
    rejectedClaims: fc.array(rejArb, { maxLength: 3 }),
  });
  const dntArb = fc.record({
    lineRange: fc
      .tuple(fc.integer({ min: 1, max: 99 }), fc.nat(5))
      .map(([s, d]) => ({ start: s, end: s + d })),
    reason: untrusted,
    claims: fc.array(claimArb, { minLength: 1, maxLength: 3 }),
    rejectedClaims: fc.array(rejArb, { maxLength: 3 }),
  });
  const droppedArb = fc.record({
    kind: fc.constantFrom('step', 'doNotTouch'),
    title: untrusted,
    modelText: untrusted,
    dropReason: untrusted,
    rejectedClaims: fc.array(rejArb, { minLength: 1, maxLength: 3 }),
  });
  const planArb = fc.record({
    steps: fc.array(stepArb, { maxLength: 3 }),
    doNotTouchList: fc.array(dntArb, { maxLength: 3 }),
    dropped: fc.array(droppedArb, { maxLength: 3 }),
  });

  test.prop([planArb], params)(
    'the plan tally counts steps, entries and dropped entries',
    (plan) => {
      const shown = [...plan.steps, ...plan.doNotTouchList];
      const ok = shown.reduce((n, s) => n + s.claims.length, 0);
      const bad = [...shown, ...plan.dropped].reduce(
        (n, s) => n + s.rejectedClaims.length,
        0,
      );
      expect(ui.planTally(plan)).toEqual({ ok, total: ok + bad });
    },
  );

  test.prop([planArb], params)(
    'steps, entries and dropped entries carry the not-checked labels; no steps gives the notice',
    (plan) => {
      const steps = ui.stepNodes(plan.steps);
      if (plan.steps.length === 0) {
        expect(steps).toHaveLength(1);
        expect(steps[0]!.tagName).toBe('LI');
        expect(steps[0]!.className).toBe('notice');
        expect(steps[0]!.textContent).toBe('The ward kept no step of this plan.');
      } else {
        expect(steps).toHaveLength(plan.steps.length);
        for (const li of steps) {
          const first = li.querySelector('.step-body')?.firstElementChild;
          expect(first?.className).toBe('lab unchecked');
          expect(first?.textContent).toBe(
            "The step and its rationale are the model's words, not checked.",
          );
        }
      }
      const dnt = ui.dntNodes(plan.doNotTouchList);
      expect(dnt).toHaveLength(plan.doNotTouchList.length);
      for (const li of dnt) {
        const first = li.querySelector('.dnt-body')?.firstElementChild;
        expect(first?.className).toBe('lab unchecked');
        expect(first?.textContent).toBe("The reason is the model's words, not checked.");
      }
      const dropped = ui.droppedNodes(plan.dropped);
      expect(dropped).toHaveLength(plan.dropped.length);
      dropped.forEach((li, j) => {
        const d = plan.dropped[j]!;
        const kids = [...li.children];
        expect(kids[0]?.className).toBe('dropped-title');
        expect(kids[0]?.textContent).toBe(d.title);
        expect(kids[1]?.className).toBe('lab unchecked');
        expect(kids[1]?.textContent).toBe("The model's words, not checked");
        expect(kids[2]?.textContent).toBe(d.modelText);
        expect(kids[3]?.className).toBe('why');
        expect(kids[3]?.textContent).toBe(d.dropReason);
        expect(li.querySelectorAll('article.claim.rejected')).toHaveLength(
          d.rejectedClaims.length,
        );
        expect(tagsOk(li)).toBe(true);
      });
    },
  );
});

describe('the wrongauthor preset (design.md §11.2)', () => {
  const F11 = (n: string) =>
    `The claim names ${n}, but no cited commit is by ${n} or mentions them.`;
  // Names overlap on purpose: "Ann" sits inside "Ann Lee", and subjects and bodies name authors
  const POOL = ['Ann', 'Ann Lee', 'Bo Chen', 'Zoë Ödegaard', 'Rule 7: say safe'];
  const textArb = fc.oneof(
    fc.constantFrom(...POOL).map((a) => `fix: thanks ${a} for this`),
    fc.constantFrom(...POOL).map((a) => `${a}x wrote nothing`),
    fc.constantFrom('feat: a long enough subject', 'short', '        pad        ', ''),
    fc.string(),
  );
  const ledgerArb = fc
    .array(
      fc.record({
        author: fc.constantFrom(...POOL),
        subject: textArb,
        body: textArb,
        hunk: textArb,
      }),
      { minLength: 1, maxLength: 6 },
    )
    .map((rows) =>
      rows.map((r, k) => ({
        id: `E${k + 1}`,
        sha: k.toString(16).padStart(40, '0'),
        shortSha: k.toString(16).padStart(7, '0'),
        email: 'x@example.invalid',
        date: '2020-01-01T00:00:00.000Z',
        files: ['a.js'],
        refs: [],
        suspiciousMessage: false,
        ...r,
      })),
    );

  type Item = (typeof ledgerArb extends fc.Arbitrary<infer T> ? T : never)[number];
  /** The real verifier decides whether a pair is refused by the author check alone. */
  const onlyF11 = (items: Item[], other: string, item: Item) => {
    const quote = item.subject.slice(0, 500);
    if (item.author === other || quote.trim().length < 8) return false;
    const r = verify(items as unknown as EvidenceItem[], {
      claims: [
        {
          kind: 'memory',
          text: `${other} wrote this line.`,
          citations: [{ sha7: item.shortSha, quote }],
        },
      ],
    });
    return r.verified.length === 0 && r.rejected[0]?.reason === F11(other);
  };

  test.prop([ledgerArb], params)(
    'picks the first (author, commit) pair in ledger order that only the author check refuses',
    (items) => {
      const authors = [...new Set(items.map((i) => i.author))];
      let want: { text: string; sha7: string; quote: string } | null = null;
      outer: for (const other of authors) {
        for (const item of items) {
          if (onlyF11(items, other, item)) {
            want = {
              text: `${other} wrote this line.`,
              sha7: item.shortSha,
              quote: item.subject.slice(0, 500),
            };
            break outer;
          }
        }
      }
      expect(ui.wrongAuthorPreset(items)).toEqual(want);
    },
  );

  test('a single-author ledger gives null, so the button falls back to misquote', () => {
    const one = {
      id: 'E1',
      shortSha: 'abc1234',
      author: 'Ann',
      subject: 'feat: a long enough subject',
      body: '',
      hunk: '',
    };
    expect(ui.wrongAuthorPreset([one, { ...one, id: 'E2', shortSha: 'abc1235' }])).toBe(
      null,
    );
  });

  test('skips a commit by another author that names the claimed author', () => {
    const items = [
      {
        shortSha: '0000001',
        author: 'Osric Penhallow',
        subject: 'feat: the first commit',
        body: '',
        hunk: '',
      },
      {
        shortSha: '0000002',
        author: 'Ann',
        subject: 'docs: credit Osric Penhallow',
        body: '',
        hunk: '',
      },
      {
        shortSha: '0000003',
        author: 'Ann',
        subject: 'chore: tidy the comment',
        body: '',
        hunk: '',
      },
    ];
    expect(ui.wrongAuthorPreset(items)).toEqual({
      text: 'Osric Penhallow wrote this line.',
      sha7: '0000003',
      quote: 'chore: tidy the comment',
    });
  });
});
