/* global Element -- DOM types only; the nodes come from jsdom */
/**
 * first-seance T12 — static checks of the polish addendum (requirements.md R15, design.md §18):
 * public/index.html parsed with jsdom (no script runs), public/styles.css read as text, rule by
 * rule, with the at-rule each rule sits in. These prove the markup and the rules exist; they do
 * not render anything, so what the rules look like in a browser is checked by reading only.
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
const text = (n: Element | null | undefined): string =>
  (n?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Plain rules with the at-rule they sit in ('' at top level). */
const rules: Array<{ selectors: string[]; body: string; media: string }> = [];
{
  const media: string[] = [];
  let buf = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]!;
    if (ch === '{') {
      const prelude = buf.trim();
      buf = '';
      if (prelude.startsWith('@')) media.push(prelude);
      else {
        const end = css.indexOf('}', i);
        rules.push({
          selectors: prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
          body: css.slice(i + 1, end),
          media: media.at(-1) ?? '',
        });
        i = end;
      }
    } else if (ch === '}') {
      media.pop();
      buf = '';
    } else if (ch === ';' && buf.trim().startsWith('@')) buf = '';
    else buf += ch;
  }
}
const has = (sel: string, decl: RegExp, media: RegExp | '' = ''): boolean =>
  rules.some(
    (r) =>
      r.selectors.includes(sel) &&
      decl.test(r.body) &&
      (media === '' ? r.media === '' : media.test(r.media)),
  );
const anyRule = (sel: string): boolean => rules.some((r) => r.selectors.includes(sel));
const NARROW = /max-width:\s*60rem/;
const PHONE = /max-width:\s*40rem/;

describe('layout re-audit (L1–L15)', () => {
  it('L1: the hero candle scales its wax and wick below 60rem, ignores the pointer, and hides below 40rem', () => {
    expect(has('.candle-stage .wax', /height:\s*4\.9rem/, NARROW)).toBe(true);
    expect(has('.candle-stage .wick', /height:\s*0\.75rem/, NARROW)).toBe(true);
    expect(has('.candle-stage', /pointer-events:\s*none/)).toBe(true);
    expect(has('.candle-stage', /display:\s*none/, PHONE)).toBe(true);
  });

  it('L2: the guide numbers its titles with a counter and no list indent', () => {
    expect(has('.guide-steps', /list-style:\s*none/)).toBe(true);
    expect(has('.guide-steps', /padding-inline-start:\s*0/)).toBe(true);
    expect(has('.guide-steps', /counter-reset:\s*g\b/)).toBe(true);
    expect(has('.guide-steps > li', /counter-increment:\s*g\b/)).toBe(true);
    expect(has('.guide-title::before', /content:\s*counter\(g\) '\. '/)).toBe(true);
  });

  it('L3: the summon row spans the whole form row, by specificity', () => {
    expect(has('.summon .actions', /grid-column:\s*1 \/ -1/)).toBe(true);
  });

  it('L5: the counter sticks on paper while it has text, and is static when empty', () => {
    expect(has('.verified-counter', /position:\s*sticky/)).toBe(true);
    expect(has('.verified-counter', /top:\s*0/)).toBe(true);
    expect(has('.verified-counter', /background:\s*var\(--color-paper\)/)).toBe(true);
    expect(has('.verified-counter', /z-index:\s*var\(--z-sticky\)/)).toBe(true);
    expect(has('.verified-counter:empty', /position:\s*static/)).toBe(true);
  });

  it('L6: step errors sit in their guide step as alerts; #map-status and #map-err follow #map-meta', () => {
    for (const [id, step, after] of [
      ['ward-err', 'guide-step-ward', 'ward-status'],
      ['exorcise-err', 'guide-step-exorcise', 'exorcise-status'],
    ] as const) {
      const p = byId(id);
      expect(p.tagName).toBe('P');
      expect(p.className).toBe('err');
      expect(p.getAttribute('role')).toBe('alert');
      expect(p.hasAttribute('hidden')).toBe(true);
      expect(byId(step).contains(p)).toBe(true);
      expect(byId(after).compareDocumentPosition(p)).toBe(
        doc.defaultView!.Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
    expect(byId('map-meta').nextElementSibling?.id).toBe('map-status');
    expect(byId('map-status').nextElementSibling?.id).toBe('map-err');
  });

  it('L7: a "Do not touch" entry is a left-ruled block, not a card', () => {
    expect(has('.dnt li', /border:\s*0/)).toBe(true);
    expect(has('.dnt li', /border-inline-start:\s*2px solid var\(--color-accent\)/)).toBe(
      true,
    );
    expect(has('.dnt li', /border-radius:\s*0/)).toBe(true);
    expect(has('.dnt li', /background:\s*none/)).toBe(true);
  });

  it('L8: the wordmark stays left, the nav and the candle button go right', () => {
    expect(has('.bar-in', /justify-content:\s*flex-start/)).toBe(true);
    expect(has('.bar-in', /row-gap:\s*var\(--space-xs\)/)).toBe(true);
    expect(has('.bar nav', /margin-inline-start:\s*auto/)).toBe(true);
    expect(has('#candles-btn', /margin-inline-start:\s*auto/, PHONE)).toBe(true);
  });

  it('L9: speculation italic stops at the label and the cite buttons; quote marks use the body font', () => {
    expect(has('.claim .lab', /font-style:\s*normal/)).toBe(true);
    expect(has('.cite', /font-style:\s*normal/)).toBe(true);
    // :not(.warn): the "cites a flagged commit" label keeps its accent colour
    expect(
      has('.claim.speculation .lab:not(.warn)', /color:\s*var\(--color-speculation\)/),
    ).toBe(true);
    expect(has('.found-quote::before', /font-family:\s*var\(--font-body\)/)).toBe(true);
    expect(has('.found-quote::after', /font-family:\s*var\(--font-body\)/)).toBe(true);
  });

  it('L10: the map has the exorcism’s margin, a neutral note, and empty regions take no space', () => {
    expect(has('.haunting-map', /margin-top:\s*var\(--space-2xl\)/)).toBe(true);
    expect(has('.haunting-map .notice', /border-color:\s*var\(--color-rule\)/)).toBe(
      true,
    );
    expect(has('.haunting-map .notice', /background:\s*var\(--color-paper-2\)/)).toBe(
      true,
    );
    expect(has('.log:empty', /min-height:\s*0/)).toBe(true);
    expect(has('.haunting-map .status:empty', /position:\s*absolute/)).toBe(true);
    expect(has('.haunting-map', /position:\s*relative/)).toBe(true);
  });

  it('L12: ledger summary padding, positioned rows, wider line numbers, a planchette that ignores the pointer', () => {
    expect(has('.ledger details summary', /padding-block:\s*var\(--space-2xs\)/)).toBe(
      true,
    );
    expect(has('.ledger li', /position:\s*relative/)).toBe(true);
    expect(
      has('.source-lines', /padding-inline-start:\s*calc\(6ch \+ var\(--space-sm\)\)/),
    ).toBe(true);
    expect(has('.planchette', /pointer-events:\s*none/)).toBe(true);
    expect(js).toMatch(/function focusCommit[\s\S]*?block: 'nearest'/);
  });

  it('L13: the plant disclosure keeps its content in .plant-body, a grid with a gap', () => {
    const plant = byId('plant');
    const kids = [...plant.children];
    expect(kids.map((k) => k.tagName)).toEqual(['SUMMARY', 'DIV']);
    expect(kids[1]!.className).toBe('plant-body');
    for (const id of ['plant-text', 'plant-sha', 'plant-quote', 'plant-err', 'plant-btn'])
      expect(kids[1]!.contains(byId(id)), id).toBe(true);
    expect(has('.plant-body', /display:\s*grid/)).toBe(true);
    expect(has('.plant-body', /gap:\s*var\(--space-sm\)/)).toBe(true);
  });

  it('L15: the dead rules named in the audit are gone; no .btn can be disabled', () => {
    expect(anyRule('.btn[disabled]')).toBe(false);
    expect(anyRule('.btn.ghost[disabled]')).toBe(false);
    expect(anyRule('.field.grow')).toBe(false);
    expect(rules.some((r) => r.selectors.some((s) => /\.token\b/.test(s)))).toBe(false);
    expect(has('.actions', /grid-column/)).toBe(false);
    expect(tokens).not.toMatch(/--color-success/);
    // the only `disabled` the page sets is on a cite button for a commit not in the crypt
    expect([...js.matchAll(/\.disabled\s*=/g)]).toHaveLength(1);
    expect(js).toMatch(/else b\.disabled = true;/);
    expect(doc.querySelectorAll('[disabled]')).toHaveLength(0);
    expect(anyRule('.cite:disabled')).toBe(true);
  });
});

describe('first-run re-audit (F1–F12): markup and copy', () => {
  it('F2: a silence claim the commits ordered is dashed in the rejected colour', () => {
    expect(has('.claim.silence.ordered', /border-style:\s*dashed/)).toBe(true);
    expect(has('.claim.silence.ordered', /border-color:\s*var\(--color-rejected\)/)).toBe(
      true,
    );
    expect(has('.claim.silence.ordered', /color:\s*var\(--color-rejected\)/)).toBe(true);
  });

  it('F3: no #ward-limit paragraph; the guide follows the counter; no tally says "claims verified"', () => {
    expect(doc.getElementById('ward-limit')).toBeNull();
    expect(byId('guide').previousElementSibling?.id).toBe('verified-counter');
    expect(js).not.toMatch(/claims verified/);
    expect(js).toContain("'Citations verified'");
  });

  it('F4: the recorded plan label', () => {
    expect(text(byId('ex-recorded'))).toBe(
      'A recorded plan (the live model is unavailable). The ward checked it again just now.',
    );
    expect(js).toContain(
      'A recorded answer (the live model is unavailable). The ward checked it again just now.',
    );
    expect(js).not.toMatch(/model is resting\)/);
  });

  it('F5: #repo-help, and the possessed line under the crypt heading', () => {
    expect(text(byId('repo-help'))).toBe(
      'crypt and possessed are samples. Or paste a public GitHub link.',
    );
    const p = byId('crypt-possessed');
    expect(p.tagName).toBe('P');
    expect(p.className).toBe('meta');
    expect(p.hasAttribute('hidden')).toBe(true);
    expect(byId('h-crypt').nextElementSibling).toBe(p);
    expect(text(p)).toBe(
      "This sample's commits try to give the ghost orders. Flagged commits are marked.",
    );
  });

  it('F6: no GitHub token field on the page, and app.js sends none', () => {
    expect(doc.getElementById('token')).toBeNull();
    expect(doc.querySelector('[name="githubToken"]')).toBeNull();
    expect(doc.querySelector('details.token')).toBeNull();
    expect(js).not.toMatch(/githubToken/);
    expect(js).not.toMatch(/\$\('token'\)/);
  });

  it('F7: one sentence at the top of the exorcism; no per-section or per-step "not checked" label', () => {
    const w = byId('ex-words');
    expect(byId('ex-recorded').nextElementSibling).toBe(w);
    expect(text(w)).toBe(
      "The summary, the tests, the steps and the reasons are the model's words. The ward checked only the cited claims shown under each step.",
    );
    expect(doc.getElementById('ex-summary-lab')).toBeNull();
    expect(text(byId('ex-tests-lab'))).toBe('Read each test before you run it.');
    expect(byId('ex-tests-lab').nextElementSibling?.id).toBe('ex-tests');
    expect(html).not.toMatch(/not checked/);
    expect(js).not.toMatch(/model's words, not checked/);
  });

  it('F8: the map limits sit in a closed "What this map leaves out" disclosure; no "by ghosts"', () => {
    const d = byId('map-limit');
    expect(d.tagName).toBe('DETAILS');
    expect(d.className).toBe('map-limits');
    expect(d.hasAttribute('open')).toBe(false);
    expect(text(d.querySelector('summary'))).toBe('What this map leaves out');
    expect(text(d.querySelector('p.meta'))).toBe(
      'Each number counts the commits that changed a file. Merge commits are skipped, renames are not followed, every path counts alike, .mailmap is not applied, and lines are not read one by one.',
    );
    expect(js).not.toMatch(/by ghosts/);
    expect(js).toContain('by departed authors');
  });

  it('F9, F10: step 1 holds the note, the way back and its own status; ask and exorcise have elapsed counters', () => {
    const step = byId('guide-step-ask');
    const note = byId('guide-ask-note');
    expect(step.contains(note)).toBe(true);
    expect(note.className).toBe('help');
    expect(note.hasAttribute('hidden')).toBe(true);
    expect(text(note)).toBe(
      'The live model is unavailable here, so only the sample lines have recorded answers.',
    );
    const back = byId('back-btn');
    expect(step.contains(back)).toBe(true);
    expect(back.tagName).toBe('BUTTON');
    expect(back.getAttribute('type')).toBe('button');
    expect(back.className).toBe('btn small ghost');
    expect(back.hasAttribute('hidden')).toBe(true);
    const st = byId('guide-ask-status');
    expect(step.contains(st)).toBe(true);
    expect(st.className).toBe('status');
    expect(st.getAttribute('role')).toBe('status');
    expect(st.getAttribute('aria-live')).toBe('polite');
    expect(byId('ask-form').contains(byId('ask-elapsed'))).toBe(true);
    expect(byId('guide-step-exorcise').contains(byId('exorcise-elapsed'))).toBe(true);
    for (const id of ['ask-elapsed', 'exorcise-elapsed']) {
      expect(byId(id).className).toBe('meta');
      expect(byId(id).hasAttribute('role')).toBe(false);
      expect(byId(id).hasAttribute('aria-live')).toBe(false);
      expect(has(`#${id}:empty`, /display:\s*none/)).toBe(true);
    }
  });

  it('F12: the footer links to the source, and rule 1 no longer says "nothing else"', () => {
    const a = doc.querySelector(
      'footer a[href="https://github.com/seunghyeon1004/seance-kiro"]',
    );
    expect(text(a)).toBe('Source on GitHub');
    expect(a?.getAttribute('rel')).toBe('noopener');
    const rule1 = doc.querySelector('.rules li');
    expect(text(rule1)).toBe(
      'It remembers only commits. Messages, diffs, authors and dates from git history.',
    );
  });

  it('keeps the CSP rules: no inline styles, scripts or handlers', () => {
    expect(doc.querySelectorAll('[style]')).toHaveLength(0);
    for (const s of doc.querySelectorAll('script')) {
      expect(s.getAttribute('src')).toBeTruthy();
      expect((s.textContent ?? '').trim()).toBe('');
    }
    for (const n of doc.querySelectorAll('*'))
      for (const a of n.getAttributeNames()) expect(a.startsWith('on'), a).toBe(false);
  });
});
