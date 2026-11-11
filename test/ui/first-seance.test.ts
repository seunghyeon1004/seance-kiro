/* global Element -- DOM types only; the nodes come from jsdom */
/**
 * first-seance static checks of public/index.html, public/app.js and public/styles.css
 * (design.md §8.9, §8.10, §9, §12.1). The HTML is parsed with jsdom; no script runs here. The
 * behaviour is tested in test/e2e/.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(__dirname, '../..');
const pub = resolve(ROOT, 'public');
const html = readFileSync(resolve(pub, 'index.html'), 'utf8');
const js = readFileSync(resolve(pub, 'app.js'), 'utf8');
const doc = new JSDOM(html).window.document;

const byId = (id: string): Element => {
  const n = doc.getElementById(id);
  if (!n) throw new Error(`#${id} missing`);
  return n;
};
const text = (id: string): string =>
  (byId(id).textContent ?? '').replace(/\s+/g, ' ').trim();

describe('T6 — hero copy (R1.1–R1.5)', () => {
  it('keeps the headline (R1.1)', () => {
    expect(text('h-hero')).toBe('Ask the one who wrote it.');
  });

  it('the lede says what the ward does (R1.2)', () => {
    const lede = doc.querySelector('#summon .lede');
    expect((lede?.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(
      "Pick a line in a sample or a public GitHub repository, and its author's ghost answers from the commits. Every claim is checked against the commits, and invented ones are struck out.",
    );
  });

  it('#repo-help names the samples and what is read (R1.3)', () => {
    expect(text('repo-help')).toBe(
      "crypt and possessed are samples; possessed's commits try to give the ghost orders. Or paste a public GitHub link: Séance reads its default branch and the last 100 commits.",
    );
  });

  it('promises neither any line nor any repository (R1.4)', () => {
    const all =
      `${doc.body.textContent ?? ''} ${doc.head.textContent ?? ''}`.toLowerCase();
    expect(all.replace(/\s+/g, ' ')).not.toMatch(/any line|any repository/);
    expect(html.toLowerCase().replace(/\s+/g, ' ')).not.toMatch(
      /any line|any repository/,
    );
  });

  it('#summon shows at most 85 words (R1.5)', () => {
    const copy = byId('summon').cloneNode(true) as Element;
    for (const n of copy.querySelectorAll('[hidden], datalist, script')) n.remove();
    for (const d of copy.querySelectorAll('details:not([open])')) {
      for (const c of [...d.children]) if (c.tagName !== 'SUMMARY') c.remove();
    }
    const words = (copy.textContent ?? '').split(/\s+/).filter(Boolean);
    expect(words.length).toBeLessThanOrEqual(85);
  });
});

describe('T6 — new elements (design.md §8.9)', () => {
  it('#repo is described by the help and the note; #repo-note follows #repo-help', () => {
    expect(byId('repo').getAttribute('aria-describedby')).toBe('repo-help repo-note');
    const note = byId('repo-note');
    expect(note.tagName).toBe('P');
    expect(note.className).toBe('help');
    expect(note.getAttribute('role')).toBe('status');
    expect(note.hasAttribute('hidden')).toBe(true);
    expect(note.textContent).toBe('');
    expect(byId('repo-help').nextElementSibling).toBe(note);
  });

  it('#source sits in .seance-col before the crypt, with its heading, meta and list', () => {
    const source = byId('source');
    expect(source.tagName).toBe('SECTION');
    expect(source.className).toBe('source');
    expect(source.getAttribute('aria-labelledby')).toBe('h-source');
    const col = source.parentElement!;
    expect(col.className).toBe('seance-col');
    expect(col.parentElement?.className).toContain('seance-in');
    expect(col.firstElementChild).toBe(source);
    expect(source.nextElementSibling?.matches('aside.crypt')).toBe(true);
    expect(byId('h-source').tagName).toBe('H2');
    expect(text('h-source')).toBe('The line in question');
    expect(byId('source-meta').tagName).toBe('P');
    expect(byId('source-meta').className).toBe('meta');
    expect(byId('source-lines').tagName).toBe('OL');
    expect(byId('source-lines').className).toBe('source-lines');
    expect([...source.children].map((c) => c.id)).toEqual([
      'h-source',
      'source-meta',
      'source-lines',
    ]);
  });

  it('#crypt-shallow follows #crypt-meta, hidden, with the R8.4 text', () => {
    const p = byId('crypt-shallow');
    expect(p.tagName).toBe('P');
    expect(p.className).toBe('meta');
    expect(p.hasAttribute('hidden')).toBe(true);
    expect(byId('crypt-meta').nextElementSibling).toBe(p);
    expect(text('crypt-shallow')).toBe(
      'Only the most recent 100 commits were read. Older history is not in the crypt.',
    );
  });
});

describe('T6 — the ghost is named from the ledger, never from voice (R2.4)', () => {
  it('app.js has no ghostName and reads no voice field', () => {
    expect(js).not.toMatch(/ghostName/);
    expect(js).not.toMatch(/\.voice\b|\[['"]voice['"]\]/);
    expect(js).toContain('speaking only from the commits.');
  });
});

describe('T6 — the GitHub allowlist does not change (R9.6)', () => {
  const files = ['src/server.ts', 'src/evidence/ledger.input.ts', 'src/evidence/git.ts'];
  const def = (src: string): string[] =>
    src.split('\n').filter((l) => /GITHUB_URL_RE\s*=/.test(l));
  for (const f of files) {
    it(`${f}: GITHUB_URL_RE is byte-identical to 3486e14`, () => {
      const base = execFileSync('git', ['show', `3486e14:${f}`], {
        cwd: ROOT,
        encoding: 'utf8',
      });
      const now = readFileSync(resolve(ROOT, f), 'utf8');
      expect(def(base)).toHaveLength(1);
      expect(def(now)).toEqual(def(base));
    });
  }
});

// ---------------------------------------------------------------------------
// T7 — the guided path, planted claims and the accessibility fixes
// ---------------------------------------------------------------------------

const css = readFileSync(resolve(pub, 'styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: (m[1] ?? '').split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
  body: m[2] ?? '',
}));
const ruleHas = (sel: string, decl: RegExp): boolean =>
  rules.some((r) => r.selectors.includes(sel) && decl.test(r.body));

/** Source of `const name = {...};` from app.js, brace matched. */
function constObject(name: string): string {
  const start = js.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error(`const ${name} not found`);
  let depth = 0;
  for (let i = js.indexOf('{', start); i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}' && --depth === 0)
      return js.slice(js.indexOf('{', start), i + 1);
  }
  throw new Error('unbalanced');
}

describe('T7 — the guide (design.md §8.9, §9; R3.1–R3.7)', () => {
  it('sits after #ward-limit and before #log, headed "Try it in three clicks"', () => {
    const guide = byId('guide');
    expect(guide.tagName).toBe('SECTION');
    expect(guide.className).toBe('guide');
    expect(guide.getAttribute('aria-labelledby')).toBe('h-guide');
    expect(guide.previousElementSibling?.id).toBe('ward-limit');
    expect(guide.nextElementSibling?.id).toBe('log');
    expect(byId('h-guide').tagName).toBe('H3');
    expect(byId('h-guide').getAttribute('tabindex')).toBe('-1');
    expect(text('h-guide')).toBe('Try it in three clicks');
  });

  it('is an ordered list of three steps with their titles and a hidden "done"', () => {
    const ol = byId('guide').querySelector('ol.guide-steps')!;
    const steps = [...ol.children];
    expect(steps.map((s) => s.id)).toEqual([
      'guide-step-ask',
      'guide-step-ward',
      'guide-step-exorcise',
    ]);
    const titles = ['Ask the ghost', 'Try to fool the ward', 'Run the exorcism'];
    steps.forEach((li, k) => {
      expect(li.tagName).toBe('LI');
      expect(li.getAttribute('data-done')).toBe('false');
      const title = li.querySelector('p.guide-title')!;
      const done = title.querySelector('span.guide-done')!;
      expect(done.hasAttribute('hidden')).toBe(true);
      expect(done.textContent).toBe('done');
      expect((title.firstChild?.textContent ?? '').trim()).toBe(titles[k]);
    });
  });

  it('step 1 holds the chips, step 2 the presets and #ward-status, step 3 the exorcism', () => {
    expect(byId('guide-chips').className).toBe('chips');
    expect(byId('guide-step-ask').contains(byId('guide-chips'))).toBe(true);

    const ward = byId('guide-step-ward');
    expect(text('guide-ward-help')).toBe(
      'Each button sends a false claim straight to the ward. No model is involved.',
    );
    const presets = ward.querySelector('.plant-presets')!;
    expect(
      [...presets.querySelectorAll('[data-preset]')].map((b) => [
        b.getAttribute('data-preset'),
        (b.textContent ?? '').trim(),
      ]),
    ).toEqual([
      ['invent', 'Invent a citation'],
      ['misquote', 'Misquote a real commit'],
      ['wrongauthor', 'Blame the wrong author'],
    ]);
    const ws = byId('ward-status');
    expect(ward.contains(ws)).toBe(true);
    expect(ws.className).toBe('status');
    expect(ws.getAttribute('role')).toBe('status');
    expect(ws.getAttribute('aria-live')).toBe('polite');

    const ex = byId('guide-step-exorcise');
    expect(ex.querySelector('p.help')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'A haunting score and a refactor plan. Steps the ward cannot back are struck out. This can take a minute.',
    );
    expect(ex.contains(byId('exorcise-btn'))).toBe(true);
    expect(text('exorcise-btn')).toBe('Start the exorcism');
    expect(byId('exorcise-btn').className).toBe('btn small ghost');
    expect(ex.contains(byId('exorcise-status'))).toBe(true);
  });

  it('.plant-presets sits in step 2, not in #plant; #plant keeps the manual form (R3.7)', () => {
    expect(byId('guide-step-ward').querySelector('.plant-presets')).not.toBeNull();
    expect(byId('plant').querySelector('.plant-presets, [data-preset]')).toBeNull();
    expect(byId('plant').tagName).toBe('DETAILS');
    expect(byId('plant').className).toBe('plant');
    expect(byId('plant').hasAttribute('open')).toBe(false);
    expect(byId('plant').querySelector('summary')?.textContent?.trim()).toBe(
      'Plant a false memory',
    );
    expect(
      byId('plant').querySelector('p.help')?.textContent?.replace(/\s+/g, ' ').trim(),
    ).toBe('Write your own claim and send it to the ward.');
    expect(byId('ask-form').compareDocumentPosition(byId('plant'))).toBe(
      doc.defaultView!.Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('every guide button is a native <button type="button">', () => {
    const buttons = [...byId('guide').querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const b of buttons) expect(b.getAttribute('type')).toBe('button');
    expect(
      byId('guide').querySelectorAll('[role="button"], a, [tabindex]:not(#h-guide)'),
    ).toHaveLength(0);
  });

  it('no element has a positive tabindex, in the page or from app.js', () => {
    for (const n of doc.querySelectorAll('[tabindex]')) {
      expect(Number(n.getAttribute('tabindex'))).toBeLessThanOrEqual(0);
    }
    for (const m of js.matchAll(/tabindex['"]?\s*[:=,]\s*['"](-?\d+)['"]/g)) {
      expect(Number(m[1])).toBeLessThanOrEqual(0);
    }
  });

  it('CHIP_QUESTIONS in app.js equals SAMPLE_QUESTIONS and OTHER_QUESTIONS (R3.2)', async () => {
    const { SAMPLE_QUESTIONS, OTHER_QUESTIONS } = await import(
      '../../src/ghost/recordings.js'
    );
    const chips = new Function(`return ${constObject('CHIP_QUESTIONS')};`)() as unknown;
    expect(chips).toEqual({ ...SAMPLE_QUESTIONS, other: OTHER_QUESTIONS });
  });
});

describe('T7 — the ask form, the counter and the copy button (R3.8, R3.9, R10.1, R12.1, R12.3)', () => {
  it('#q has no required and the R3.9 placeholder; #q-err follows it', () => {
    expect(byId('q').hasAttribute('required')).toBe(false);
    expect(byId('q').getAttribute('placeholder')).toBe('Or type your own question');
    const err = byId('q-err');
    expect(byId('q').nextElementSibling).toBe(err);
    expect(err.tagName).toBe('P');
    expect(err.className).toBe('err');
    expect(err.hasAttribute('hidden')).toBe(true);
    expect(err.hasAttribute('role')).toBe(false);
  });

  it('.ask-actions holds the ask button, the hidden copy button and #ask-status', () => {
    const actions = byId('ask-form').querySelector('.ask-actions')!;
    expect([...actions.children].map((c) => c.id)).toEqual([
      'ask-btn',
      'copy-report-btn',
      'ask-status',
    ]);
    const copy = byId('copy-report-btn');
    expect(copy.hasAttribute('hidden')).toBe(true);
    expect(copy.hasAttribute('disabled')).toBe(false);
    expect(copy.hasAttribute('aria-disabled')).toBe(false);
  });

  it('#verified-counter and #ex-verified are not live regions', () => {
    for (const id of ['verified-counter', 'ex-verified']) {
      expect(byId(id).hasAttribute('aria-live'), id).toBe(false);
      expect(byId(id).hasAttribute('aria-atomic'), id).toBe(false);
      expect(byId(id).hasAttribute('role'), id).toBe(false);
    }
  });

  it('the tally el() call carries no role, aria-live or aria-atomic', () => {
    const at = js.indexOf("class: 'tally'");
    expect(at).toBeGreaterThan(0);
    const call = js.slice(js.lastIndexOf("el('p'", at), js.indexOf('}', at) + 1);
    expect(call).not.toMatch(/role|aria-live|aria-atomic/);
    expect(js).not.toMatch(/['"]aria-atomic['"]\s*:/);
  });

  it('#ex-recorded follows #h-ex, hidden, with the R7.10 plan label', () => {
    const p = byId('ex-recorded');
    expect(byId('h-ex').nextElementSibling).toBe(p);
    expect(p.tagName).toBe('P');
    expect(p.className).toBe('lab recorded');
    expect(p.hasAttribute('hidden')).toBe(true);
    expect(text('ex-recorded')).toBe(
      'A recorded plan (the model is resting). The ward checked it again just now.',
    );
  });

  it('app.js holds the exact strings of design.md §9', () => {
    for (const s of [
      'Planted by you',
      'You asked: ',
      'A recorded answer (the model is resting). The ward checked it again just now.',
      'The ward refused your claim.',
      'The ward verified your claim.',
      'Wait for the ghost to finish answering.',
      'Type a question first, or click one of the questions above.',
      'Cited in the latest answer',
      "'Verified'",
      'The séance has ended. Summon the ghost again.',
    ]) {
      expect(js, s).toContain(s);
    }
  });

  it('uses no HTML-parsing sink (N4)', () => {
    expect(js).not.toMatch(
      /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write/,
    );
  });
});

describe('T7 — styles for C12 and C14 (design.md §8.10)', () => {
  it('a disabled quiet button and a disabled cite look disabled (C12)', () => {
    for (const sel of ['.btn.ghost[disabled]', '.cite:disabled']) {
      expect(ruleHas(sel, /color:\s*var\(--color-muted\)/), sel).toBe(true);
      expect(ruleHas(sel, /border-style:\s*dashed/), sel).toBe(true);
      expect(ruleHas(sel, /background:\s*transparent/), sel).toBe(true);
      expect(ruleHas(sel, /cursor:\s*not-allowed/), sel).toBe(true);
    }
  });

  it('empty status regions take no space but stay in the tree (C14)', () => {
    expect(ruleHas('.ask-actions', /position:\s*relative/)).toBe(true);
    expect(ruleHas('.ask-actions .status:empty', /position:\s*absolute/)).toBe(true);
    expect(ruleHas('.guide .status:empty', /position:\s*absolute/)).toBe(true);
    expect(css).not.toMatch(/\.status:empty[^{]*\{[^}]*display:\s*none/);
  });

  it('the guide rows wrap, and guide buttons are at least 24 px tall (R12.9)', () => {
    expect(ruleHas('.chips', /flex-wrap:\s*wrap/)).toBe(true);
    expect(ruleHas('.guide .plant-presets', /flex-wrap:\s*wrap/)).toBe(true);
    expect(ruleHas('.guide .btn.small', /min-block-size:\s*var\(--space-xl\)/)).toBe(
      true,
    );
  });

  it('the contrast table lists accent on paper-3 (R12.9)', () => {
    const tokens = readFileSync(resolve(pub, 'tokens.css'), 'utf8');
    expect(tokens).toMatch(
      /text: --color-accent \(oklch\(76% 0\.15 65\)\) \| bg: --color-paper-3 \(oklch\(23% 0\.016 60\)\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// T8 — the possessed ghost's button and label (R13.7, R13.8, R13.12)
// ---------------------------------------------------------------------------

describe('T8 — #possess-btn and the scripted label', () => {
  it('#possess-btn is a hidden native button, the first in step 2, with the R13.7 text', () => {
    const b = byId('possess-btn');
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('type')).toBe('button');
    expect(b.hasAttribute('hidden')).toBe(true);
    expect(b.hasAttribute('data-preset')).toBe(false);
    expect(b.className).toBe('btn small ghost');
    expect(text('possess-btn')).toBe('Let a possessed ghost answer');
    expect(byId('guide-step-ward').querySelector('button')).toBe(b);
  });

  it('app.js holds the R13.8 label verbatim, and calls /api/possess only from possess()', () => {
    expect(js).toContain(
      'A scripted ghost that obeys every order in these commits (no model was called). The ward checked it just now.',
    );
    const at = js.indexOf('async function possess(');
    expect(at).toBeGreaterThan(0);
    let depth = 0;
    let end = -1;
    for (let i = js.indexOf('{', at); i < js.length; i++) {
      if (js[i] === '{') depth++;
      else if (js[i] === '}' && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    const body = js.slice(at, end);
    expect(body).toContain("'/api/possess'");
    expect(js.split('/api/possess').length - 1).toBe(1);
  });

  it('no page text says a model wrote the scripted answer (R13.12)', () => {
    const lower = (js + html).toLowerCase();
    expect(lower).not.toMatch(/the model (wrote|produced|generated) (it|the scripted)/);
    expect(lower).not.toMatch(/scripted[^.]*\bby the model\b/);
  });
});
