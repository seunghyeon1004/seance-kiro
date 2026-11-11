/* global Element -- DOM types only; the nodes come from jsdom */
/**
 * Static checks for the remaining findings of the accessibility and mobile audit
 * (docs/kiro-evidence/audit-a11y-mobile-session.txt). The HTML is parsed with jsdom, no script
 * runs here, and no browser is launched: these tests prove that the markup and the CSS rules are
 * present, not how a browser lays them out. The behaviour is tested in test/e2e/a11y.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const pub = resolve(__dirname, '../../public');
const html = readFileSync(resolve(pub, 'index.html'), 'utf8');
const js = readFileSync(resolve(pub, 'app.js'), 'utf8');
const tokens = readFileSync(resolve(pub, 'tokens.css'), 'utf8');
const css = readFileSync(resolve(pub, 'styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const doc = new JSDOM(html).window.document;

const byId = (id: string): Element => {
  const n = doc.getElementById(id);
  if (!n) throw new Error(`#${id} missing`);
  return n;
};

/** Plain rules, top level or nested one level in an at-rule; `media` is the at-rule prelude or ''. */
interface Rule {
  selectors: string[];
  body: string;
  media: string;
}
function parseRules(src: string): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  const media: string[] = [];
  let buf = '';
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '{') {
      const prelude = buf.trim();
      buf = '';
      if (prelude.startsWith('@')) {
        media.push(prelude);
      } else {
        const end = src.indexOf('}', i);
        out.push({
          selectors: prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
          body: src.slice(i + 1, end),
          media: media.at(-1) ?? '',
        });
        i = end;
      }
    } else if (ch === '}') {
      media.pop();
      buf = '';
    } else if (ch === ';' && buf.trim().startsWith('@')) {
      buf = ''; // @import
    } else {
      buf += ch;
    }
    i++;
  }
  return out;
}
const rules = parseRules(css);
const rulesFor = (sel: string, media?: RegExp): Rule[] =>
  rules.filter((r) => r.selectors.includes(sel) && (!media || media.test(r.media)));
const has = (sel: string, decl: RegExp, media?: RegExp): boolean =>
  rulesFor(sel, media).some((r) => decl.test(r.body));

const FIELD_ERRS = ['repo-err', 'file-err', 'start-err', 'end-err'];

describe('C1 — summon field errors', () => {
  it('the four per-field errors are not alerts; #summon-err still is', () => {
    for (const id of FIELD_ERRS) expect(byId(id).hasAttribute('role'), id).toBe(false);
    expect(byId('summon-err').getAttribute('role')).toBe('alert');
  });
});

describe('C3 — grid columns can shrink (320 px)', () => {
  // every element styled as a grid, with the selectors that make it one
  const grids = [
    ...new Set(
      rules
        .filter((r) => /(^|;)\s*display:\s*grid\b/.test(r.body))
        .flatMap((r) => r.selectors),
    ),
  ];

  it('.talk, .log, .turn and the guide and source grids use minmax(0, 1fr)', () => {
    for (const sel of [
      '.talk',
      '.log',
      '.turn',
      '.guide',
      '.guide-steps',
      '.guide-steps > li',
      '.source',
    ]) {
      expect(grids, sel).toContain(sel);
      expect(has(sel, /grid-template-columns:\s*minmax\(0,\s*1fr\)/), sel).toBe(true);
    }
  });

  it('no grid is left with an implicit auto column', () => {
    const bare = grids.filter((sel) => !has(sel, /grid-template-columns:/));
    expect(bare).toEqual([]);
  });

  it('no explicit grid track is a bare fr or auto that cannot shrink', () => {
    for (const r of rules) {
      const m = /grid-template-columns:\s*([^;]+)/.exec(r.body);
      if (!m) continue;
      // a minmax() may hold one level of nested parentheses, as in minmax(min(100%, 16rem), 1fr)
      let tracks = m[1]!.replace(
        /minmax\((?:[^()]|\([^()]*\))*\)|repeat\(\d+,\s*minmax\([^)]*\)\)/g,
        '',
      );
      // .ex-top's auto track holds only the computed score ("100 of 100 haunted"), and the
      // 60rem query turns it into one minmax(0, 1fr) column
      if (r.selectors.includes('.ex-top')) tracks = tracks.replace(/^\s*auto\b/, '');
      expect(tracks, r.selectors.join(', ')).not.toMatch(/(^|\s)(\d*\.?\d*fr|auto)\b/);
    }
  });
});

describe('C4 — the plant form explains and marks its errors', () => {
  it('#plant-sha is described by help text that states the format', () => {
    const sha = byId('plant-sha');
    const ids = (sha.getAttribute('aria-describedby') ?? '').split(/\s+/);
    expect(ids).toContain('plant-sha-help');
    expect(byId('plant-sha-help').textContent).toMatch(/7 characters/);
    expect(byId('plant-sha-help').textContent).toMatch(/0.9 and a.f/);
  });

  it('#plant-err is a hidden alert just before #plant-btn', () => {
    const err = byId('plant-err');
    expect(err.classList.contains('err')).toBe(true);
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.hasAttribute('hidden')).toBe(true);
    expect(err.nextElementSibling?.id).toBe('plant-btn');
  });
});

describe('C5 — input borders have 3:1', () => {
  it('declares --color-rule-strong in :root and uses it for the input and textarea border', () => {
    expect(tokens).toMatch(/--color-rule-strong:\s*oklch\(/);
    expect(has('input', /border:[^;]*var\(--color-rule-strong\)/)).toBe(true);
    expect(has('textarea', /border:[^;]*var\(--color-rule-strong\)/)).toBe(true);
  });

  it('the contrast table lists it as a non-text pair on paper and paper-2', () => {
    expect(tokens).toMatch(
      /non-text: --color-rule-strong \(oklch\([^)]+\)\) \| bg: --color-paper \(/,
    );
    expect(tokens).toMatch(
      /non-text: --color-rule-strong \(oklch\([^)]+\)\) \| bg: --color-paper-2 \(/,
    );
  });
});

describe('C6 — color-scheme', () => {
  it('declares color-scheme: dark on :root and in a meta tag', () => {
    expect(tokens).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark;/);
    expect(doc.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe(
      'dark',
    );
  });
});

describe('C8 — a control stops the candles', () => {
  it('#candles-btn is a native button whose label is the action, hidden until the script runs', () => {
    const b = byId('candles-btn');
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('type')).toBe('button');
    expect(b.hasAttribute('aria-pressed')).toBe(false);
    expect(b.hasAttribute('hidden')).toBe(true);
    expect((b.textContent ?? '').trim()).toBe('Still the candles');
    expect(b.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('html.still stops the flame animation outside any media query', () => {
    expect(has('html.still .flame', /animation:\s*none/)).toBe(true);
    expect(rulesFor('html.still .flame').some((r) => r.media === '')).toBe(true);
  });

  it('app.js guards localStorage with try/catch and sets no inline style for it', () => {
    expect(js).toMatch(/try\s*\{[^}]*localStorage\.getItem/);
    expect(js).toMatch(/try\s*\{[^}]*localStorage\.setItem/);
    expect(js).toMatch(/root\.classList\.toggle\('still'/);
  });
});

describe('C9 — ledger rows', () => {
  it('rows are created with tabindex -1, not 0', () => {
    expect(js).toMatch(/id: `ledger-item-\$\{i\.shortSha\}`,\s*tabindex: '-1'/);
    expect(js).not.toMatch(/tabindex: '0'/);
  });

  it('the row focus ring is drawn inside the scroll box', () => {
    expect(has('.ledger li:focus-visible', /outline-offset:\s*-2px/)).toBe(true);
  });
});

describe('C13 — the planchette stays inside the crypt', () => {
  it('the crypt is positioned on narrow screens', () => {
    expect(has('.crypt', /position:\s*relative/, /max-width:\s*60rem/)).toBe(true);
    expect(has('.crypt', /position:\s*static/)).toBe(false);
  });
});

describe('C17 — the crypt is a section', () => {
  it('is a <section class="crypt">, and the page has no <aside>', () => {
    expect(doc.querySelector('.crypt')?.tagName).toBe('SECTION');
    expect(doc.querySelector('aside')).toBeNull();
  });
});

describe('S1 — busy buttons keep focus', () => {
  it('app.js never sets the disabled property on the summon, ask or exorcise button', () => {
    expect(js).not.toMatch(/\$\('(summon|ask|exorcise)-btn'\)\.disabled\s*=/);
    for (const b of ['summon', 'ask', 'exorcise']) {
      expect(js).toMatch(
        new RegExp(`\\$\\('${b}-btn'\\)\\.setAttribute\\('aria-disabled', 'true'\\)`),
      );
      expect(js).toMatch(
        new RegExp(`\\$\\('${b}-btn'\\)\\.removeAttribute\\('aria-disabled'\\)`),
      );
    }
  });

  it('aria-disabled buttons are styled like disabled ones', () => {
    expect(has(".btn[aria-disabled='true']", /color:\s*var\(--color-muted\)/)).toBe(true);
    expect(
      has(".btn[aria-disabled='true']", /background:\s*var\(--color-paper-3\)/),
    ).toBe(true);
    expect(has(".btn.ghost[aria-disabled='true']", /border-style:\s*dashed/)).toBe(true);
    expect(has(".btn.ghost[aria-disabled='true']", /background:\s*transparent/)).toBe(
      true,
    );
  });
});

describe('S2 — no aria-busy on the summon form', () => {
  it('app.js never sets aria-busy on #summon-form', () => {
    expect(js).not.toMatch(/summon-form'\)\.(setAttribute|removeAttribute)\('aria-busy'/);
  });
});

describe('S3 — the ledger keeps a usable height', () => {
  it('every max-height on .ledger is at least 18rem', () => {
    const decls = rulesFor('.ledger').flatMap((r) =>
      [...r.body.matchAll(/max-height:\s*([^;]+)/g)].map((m) => m[1]!.trim()),
    );
    expect(decls.length).toBeGreaterThan(0);
    for (const d of decls) expect(d).toMatch(/^max\([^,]+,\s*18rem\)$/);
  });
});

describe('S6 — forced colours', () => {
  const fc = /forced-colors:\s*active/;
  it('keeps the signal bars, lit rows and focus rings, using tokens', () => {
    expect(has('.bar-fill', /forced-color-adjust:\s*none/, fc)).toBe(true);
    expect(has('.bar-fill', /background:\s*var\(--color-sys-text\)/, fc)).toBe(true);
    expect(has('.ledger li.lit', /outline:[^;]*var\(--color-sys-text\)/, fc)).toBe(true);
    expect(has(':focus-visible', /outline:[^;]*var\(--color-sys-highlight\)/, fc)).toBe(
      true,
    );
    expect(tokens).toMatch(/--color-sys-text:\s*CanvasText;/);
    expect(tokens).toMatch(/--color-sys-highlight:\s*Highlight;/);
  });
});

describe('Reversibility badges — words, not emoji', () => {
  it('app.js labels steps "Reversible" or "Irreversible" with no symbol', () => {
    expect(js).toMatch(/s\.reversible \? 'Reversible' : 'Irreversible'/);
    expect(js).not.toMatch(/[✓⚠]/u);
  });

  it('the two badges differ by border style as well as colour', () => {
    expect(has('.badge--rev', /border(-style)?:[^;]*\bsolid\b/)).toBe(true);
    expect(has('.badge--irrev', /border(-style)?:[^;]*\bdashed\b/)).toBe(true);
  });
});
