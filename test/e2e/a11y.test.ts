/* global HTMLElement -- DOM types only; the nodes come from jsdom */
/**
 * DOM end-to-end, not a rendering test. public/index.html runs in jsdom with public/app.js evaluated
 * unmodified; every request goes to the real createApp() in process. Only the model is scripted.
 * No browser is launched, so layout, focus rings, colour and motion are not checked here: these
 * flows prove attributes, focus and storage. Stubbed: fetch (in process), matchMedia,
 * scrollIntoView; one page per flow seeds or breaks localStorage before app.js runs.
 *
 * Accessibility and mobile audit, remaining findings C1, C4, C8, C9, S1, S2
 * (docs/kiro-evidence/audit-a11y-mobile-session.txt).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { CryptClient, buildSamples, norm, openPage } from './harness.js';
import type { OpenOptions, Page, Samples } from './harness.js';

let samples: Samples;
const pages: Page[] = [];

beforeAll(() => {
  samples = buildSamples();
}, 60_000);

afterAll(() => {
  for (const p of pages) p.close();
  if (samples) fs.rmSync(samples.root, { recursive: true, force: true });
});

async function open(extra: Partial<OpenOptions> = {}): Promise<Page> {
  const p = await openPage({ samples, client: new CryptClient(), ...extra });
  pages.push(p);
  return p;
}

async function summon(page: Page): Promise<void> {
  const n = page.requests.filter((r) => r.path === '/api/summon').length;
  page.submit('summon-form');
  await page.until(
    () =>
      !page.$('seance').hidden &&
      page.requests.filter((r) => r.path === '/api/summon').length === n + 1,
    'the séance',
  );
}

const describedBy = (el: HTMLElement): string[] =>
  (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);

/** A gate a proxy waits on, so a test can look at the page while a request runs. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const wait = new Promise<void>((r) => {
    open = r;
  });
  return { wait, open };
}

describe('C1: summon field errors are tied to their inputs', { timeout: 20_000 }, () => {
  it('marks each failing field, describes it by its error, focuses the first, and clears on a good submit', async () => {
    const page = await open();
    const repo = page.input('repo');
    const file = page.input('file');
    const start = page.input('start');
    const end = page.input('end');
    file.value = '';
    start.value = '';
    end.value = '3';
    const before = page.requests.length;
    page.submit('summon-form');

    expect(page.requests.length).toBe(before);
    expect(file.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(file)).toContain('file-err');
    expect(start.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(start)).toContain('start-err');
    expect(end.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(end)).toContain('end-err');
    expect(page.$('file-err').hidden).toBe(false);
    expect(page.doc.activeElement).toBe(file);
    // a valid field is not marked, and keeps its own help
    expect(repo.hasAttribute('aria-invalid')).toBe(false);
    expect(describedBy(repo)).toEqual(['repo-help', 'repo-note']);
    // no per-field alert stack
    expect(page.doc.querySelectorAll('#summon-form .field [role="alert"]').length).toBe(
      0,
    );

    file.value = 'legacy/tax.js';
    start.value = '7';
    end.value = '7';
    await summon(page);
    for (const f of [file, start, end]) {
      expect(f.hasAttribute('aria-invalid'), f.id).toBe(false);
      expect(
        describedBy(f).some((id) => id.endsWith('-err')),
        f.id,
      ).toBe(false);
    }
    expect(describedBy(repo)).toEqual(['repo-help', 'repo-note']);
  });
});

describe('C4: plant errors sit next to the plant fields', { timeout: 20_000 }, () => {
  it('a bad hash, a short quote and an empty claim each mark and focus their field in #plant-err', async () => {
    const page = await open();
    await summon(page);
    const sha = page.input('plant-sha');
    const quote = page.input('plant-quote');
    const text = page.input('plant-text');
    const err = page.$('plant-err');
    const notices = () => page.doc.querySelectorAll('#log .notice').length;
    const wards = () => page.requests.filter((r) => r.path === '/api/ward').length;

    expect(describedBy(sha)).toEqual(['plant-sha-help']);

    sha.value = 'xyz';
    quote.value = 'a quote long enough';
    page.click(page.$('plant-btn'));
    expect(err.hidden).toBe(false);
    expect(err.textContent).toMatch(/7 character/);
    expect(sha.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(sha)).toEqual(['plant-sha-help', 'plant-err']);
    expect(page.doc.activeElement).toBe(sha);
    expect(notices()).toBe(0);
    expect(wards()).toBe(0);

    sha.value = 'deadbee';
    quote.value = '  short ';
    page.click(page.$('plant-btn'));
    expect(err.textContent).toBe(
      'Enter the exact words from the commit, at least 8 characters, in the quote field.',
    );
    expect(sha.hasAttribute('aria-invalid')).toBe(false);
    expect(describedBy(sha)).toEqual(['plant-sha-help']);
    expect(quote.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(quote)).toEqual(['plant-err']);
    expect(page.doc.activeElement).toBe(quote);

    quote.value = 'so Windows XP clients would not time out';
    text.value = '   ';
    page.click(page.$('plant-btn'));
    expect(text.getAttribute('aria-invalid')).toBe('true');
    expect(page.doc.activeElement).toBe(text);
    expect(quote.hasAttribute('aria-invalid')).toBe(false);
    expect(quote.hasAttribute('aria-describedby')).toBe(false);
    expect(notices()).toBe(0);
    expect(wards()).toBe(0);

    text.value = 'I added this wait so Windows XP clients would not time out.';
    page.click(page.$('plant-btn'));
    expect(err.hidden).toBe(true);
    expect(err.textContent).toBe('');
    for (const f of [sha, quote, text])
      expect(f.hasAttribute('aria-invalid'), f.id).toBe(false);
    await page.until(() => page.turns().length === 1, 'the planted verdict');
    expect(wards()).toBe(1);
  });
});

describe('C9: ledger rows are not tab stops', { timeout: 20_000 }, () => {
  it('every row has tabindex -1, and a citation button still moves focus to its row', async () => {
    const page = await open();
    await summon(page);
    const rows = [...page.doc.querySelectorAll('#ledger > li')];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.getAttribute('tabindex')).toBe('-1');

    page.click(page.doc.querySelector('#guide-chips button')!);
    await page.until(() => page.turns().length === 1, 'the answer');
    const cite = page.doc.querySelector('#log .cite:not([disabled])') as HTMLElement;
    expect(cite).not.toBeNull();
    page.click(cite);
    expect(page.doc.activeElement?.id).toBe(`ledger-item-${norm(cite.textContent)}`);
  });
});

describe(
  'S1, S2: busy buttons keep focus, and the summon form is never busy',
  { timeout: 20_000 },
  () => {
    it('summon: aria-disabled while it runs, never disabled, focus kept, second submit ignored', async () => {
      const g = gate();
      const page = await open({
        proxy: async (req) => {
          if (req.path === '/api/summon') await g.wait;
          return undefined;
        },
      });
      const btn = page.$('summon-btn') as HTMLElement;
      btn.focus();
      page.submit('summon-form');
      await page.until(() => btn.getAttribute('aria-disabled') === 'true', 'busy');
      expect(btn.hasAttribute('disabled')).toBe(false);
      expect(page.doc.activeElement).toBe(btn);
      expect(page.$('summon-form').hasAttribute('aria-busy')).toBe(false);
      page.submit('summon-form');
      g.open();
      await page.until(() => !page.$('seance').hidden, 'the séance');
      expect(page.requests.filter((r) => r.path === '/api/summon').length).toBe(1);
      expect(btn.hasAttribute('aria-disabled')).toBe(false);
      expect(btn.hasAttribute('disabled')).toBe(false);
    });

    it('ask and exorcise: aria-disabled while they run, never disabled', async () => {
      const ask = gate();
      const ex = gate();
      const page = await open({
        proxy: async (req) => {
          if (req.path === '/api/ask') await ask.wait;
          if (req.path === '/api/exorcise') await ex.wait;
          return undefined;
        },
      });
      await summon(page);

      const askBtn = page.$('ask-btn') as HTMLElement;
      page.input('q').value = 'Why is there a three second wait here?';
      askBtn.focus();
      page.submit('ask-form');
      await page.until(() => askBtn.getAttribute('aria-disabled') === 'true', 'ask busy');
      expect(askBtn.hasAttribute('disabled')).toBe(false);
      expect(page.doc.activeElement).toBe(askBtn);
      ask.open();
      await page.until(() => page.turns().length === 1, 'the answer');
      expect(askBtn.hasAttribute('aria-disabled')).toBe(false);

      const exBtn = page.$('exorcise-btn') as HTMLElement;
      exBtn.focus();
      page.click(exBtn);
      await page.until(
        () => exBtn.getAttribute('aria-disabled') === 'true',
        'exorcise busy',
      );
      expect(exBtn.hasAttribute('disabled')).toBe(false);
      expect(page.doc.activeElement).toBe(exBtn);
      page.click(exBtn); // ignored by the busy guard
      ex.open();
      await page.until(() => !page.$('exorcism-wrap').hidden, 'the exorcism');
      expect(page.requests.filter((r) => r.path === '/api/exorcise').length).toBe(1);
      expect(exBtn.hasAttribute('aria-disabled')).toBe(false);
    });
  },
);

describe('C8: the candles can be stilled', { timeout: 20_000 }, () => {
  it('the button toggles html.still and its label (no aria-pressed), and stores the choice', async () => {
    const page = await open();
    const b = page.$('candles-btn');
    const html = page.doc.documentElement;
    expect(b.hidden).toBe(false);
    expect(b.getAttribute('aria-pressed')).toBeNull();
    expect(html.classList.contains('still')).toBe(false);

    page.click(b);
    expect(html.classList.contains('still')).toBe(true);
    expect(b.getAttribute('aria-pressed')).toBeNull();
    expect(norm(b.textContent)).toBe('Light the candles');
    expect(page.window.localStorage.getItem('seance-candles')).toBe('still');

    page.click(b);
    expect(html.classList.contains('still')).toBe(false);
    expect(b.getAttribute('aria-pressed')).toBeNull();
    expect(norm(b.textContent)).toBe('Still the candles');
    expect(page.window.localStorage.getItem('seance-candles')).toBe('lit');
    expect(html.hasAttribute('style')).toBe(false);
  });

  it('a stored choice is applied on load, whatever prefers-reduced-motion says', async () => {
    const page = await open({
      beforeScript: (w) => w.localStorage.setItem('seance-candles', 'still'),
    });
    expect(page.doc.documentElement.classList.contains('still')).toBe(true);
    expect(page.$('candles-btn').getAttribute('aria-pressed')).toBeNull();
    expect(norm(page.$('candles-btn').textContent)).toBe('Light the candles');
  });

  it('works when localStorage throws', async () => {
    const page = await open({
      beforeScript: (w) => {
        Object.defineProperty(w, 'localStorage', {
          configurable: true,
          get() {
            throw new Error('storage is blocked');
          },
        });
      },
    });
    const b = page.$('candles-btn');
    expect(b.hidden).toBe(false);
    page.click(b);
    expect(page.doc.documentElement.classList.contains('still')).toBe(true);
    expect(norm(b.textContent)).toBe('Light the candles');
  });
});
