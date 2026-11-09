/**
 * spooky-ui PBT properties PU1, PU3 and PU5, with fast-check (1,000 runs; FAST_CHECK_SEED honoured).
 * public/app.js is a classic browser script, so the functions under test are extracted
 * from its source text and run against small stubs instead of a DOM.
 */
import { describe, expect } from 'vitest';
import { test } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  for (let i = js.indexOf('{', start); i < js.length; i++) {
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

describe('PU5 - session counter arithmetic', () => {
  test('app.js accumulates verified and total claims as the property below assumes', () => {
    expect(js).toContain('state.totalVerified += data.verified.length;');
    expect(js).toContain('state.totalClaims += total;');
    expect(js).toMatch(/const total = data\.verified\.length \+ data\.rejected\.length;/);
  });
  test.prop([fc.array(fc.tuple(fc.nat(50), fc.nat(50)), { maxLength: 40 })], params)(
    'after any sequence of answers, 0 <= N <= M',
    (answers) => {
      const state = { totalVerified: 0, totalClaims: 0 };
      for (const [v, r] of answers) {
        const data = { verified: new Array(v), rejected: new Array(r) };
        const total = data.verified.length + data.rejected.length;
        state.totalVerified += data.verified.length;
        state.totalClaims += total;
      }
      expect(state.totalVerified).toBeGreaterThanOrEqual(0);
      expect(state.totalVerified).toBeLessThanOrEqual(state.totalClaims);
    },
  );
});
