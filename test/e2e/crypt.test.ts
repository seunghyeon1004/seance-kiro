/* global HTMLElement, HTMLLIElement, HTMLTextAreaElement -- DOM types only; the nodes come from jsdom */
/**
 * DOM end-to-end, not a rendering test. public/index.html runs in jsdom with public/app.js evaluated
 * unmodified; every request goes to the real createApp() in process (real git, ledger, ward, plan
 * verification). Only the model is scripted. No browser is launched, so layout, focus rings, colour
 * and motion are not checked here. Stubbed: fetch (in process), matchMedia, scrollIntoView, and
 * navigator.clipboard (jsdom has none; the test reads what the page copies).
 *
 * first-seance T7 — flow 1, the judge's path on crypt (design.md §10.3, R3, R4, R12, R11.3).
 * The steps share one page, in order, as a judge would.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { CryptClient, REASONS, buildSamples, norm, openPage } from './harness.js';
import type { Page, Samples, SummonItem } from './harness.js';
import { mostFrequentAuthor } from '../../src/ghost/persona.js';
import type { EvidenceItem } from '../../src/ghost/schema.js';

const { F4, F9, F11 } = REASONS;
const CRYPT_QUESTIONS = [
  'Why is there a three second wait here?',
  'Who touched this line last, and why?',
  'Is it safe to delete the wait?',
];

let samples: Samples;
let page: Page;
let summoned: { items: SummonItem[] } | null = null;
const copied: string[] = [];

const $ = (id: string) => page.$(id);
const lastTurn = () => page.turns().at(-1)!;
const doneShown = (step: string) => {
  const d = page.doc.querySelector(
    `#guide-step-${step} .guide-done`,
  ) as HTMLElement | null;
  return d !== null && !d.hidden && d.textContent === 'done';
};
const confidence = () => $('candle').style.getPropertyValue('--confidence');
const wardRequests = () => page.requests.filter((r) => r.path === '/api/ward').length;
const button = (label: string) => {
  const b = [...page.doc.querySelectorAll('#guide button')].find(
    (x) => norm(x.textContent) === label,
  );
  if (!b) throw new Error(`no guide button "${label}"`);
  return b;
};
async function copyReport(): Promise<string> {
  const before = copied.length;
  page.click($('copy-report-btn'));
  await page.until(() => copied.length === before + 1, 'the copied report');
  return copied.at(-1)!;
}

beforeAll(async () => {
  samples = buildSamples();
  page = await openPage({
    samples,
    client: new CryptClient(),
    onSummon: (d) => {
      summoned = d;
    },
  });
  Object.defineProperty(page.window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (t: string) => {
        copied.push(t);
      },
    },
  });
}, 60_000);

afterAll(() => {
  page?.close();
  if (samples) fs.rmSync(samples.root, { recursive: true, force: true });
});

describe('flow 1: crypt', { timeout: 20_000 }, () => {
  it('1–2. wakes the server on load and hides the copy button', () => {
    expect(page.requests[0]).toMatchObject({
      path: '/api/health',
      method: 'GET',
      status: 200,
    });
    expect(page.requests[0]!.data).toMatchObject({
      status: 'ok',
      model: true,
      samples: ['crypt', 'possessed'],
    });
    expect($('copy-report-btn').hidden).toBe(true);
    expect($('copy-report-btn').hasAttribute('disabled')).toBe(false);
  });

  it('3–4. summons: the line in question, the ghost from the ledger, the guide and focus (R2, R3.1, R12.4)', async () => {
    page.submit('summon-form');
    await page.until(() => !$('seance').hidden && summoned !== null, 'the séance');
    const line7 = execFileSync('git', ['show', 'HEAD:legacy/tax.js'], {
      cwd: samples.crypt,
      encoding: 'utf8',
    }).split('\n')[6]!;
    const lis = [...page.doc.querySelectorAll('#source-lines > li')] as HTMLLIElement[];
    expect(lis.map((l) => l.value)).toEqual([7]);
    expect(lis[0]!.textContent).toBe(line7);
    expect($('source-meta').textContent).toBe(
      'legacy/tax.js, line 7, as it reads in the latest commit.',
    );
    const author = mostFrequentAuthor(summoned!.items as unknown as EvidenceItem[]);
    expect($('ghost-name').textContent).toBe(
      `${author}, speaking only from the commits.`,
    );

    expect($('guide').hidden).toBe(false);
    expect(norm($('h-guide').textContent)).toBe('Try it in three clicks');
    expect(
      [...page.doc.querySelectorAll('#guide-chips button')].map((b) =>
        norm(b.textContent),
      ),
    ).toEqual(CRYPT_QUESTIONS);
    expect(page.doc.activeElement).toBe($('h-guide'));
    expect($('possess-btn').hasAttribute('hidden')).toBe(true);
    const n = summoned!.items.length;
    expect($('summon-status').textContent).toBe(
      `Found ${n} commit${n === 1 ? '' : 's'}. The séance is open below.`,
    );
    for (const step of ['ask', 'ward', 'exorcise']) expect(doneShown(step)).toBe(false);
  });

  it('R3.8. an empty question sends nothing, says what to do, and clears on typing', () => {
    const before = page.requests.length;
    const q = page.input('q') as unknown as HTMLTextAreaElement;
    q.value = '   ';
    page.submit('ask-form');
    expect(page.requests.length).toBe(before);
    expect($('q-err').hidden).toBe(false);
    expect($('q-err').textContent).toBe(
      'Type a question first, or click one of the questions above.',
    );
    expect(q.getAttribute('aria-invalid')).toBe('true');
    expect((q.getAttribute('aria-describedby') ?? '').split(' ')).toContain('q-err');
    expect(page.doc.activeElement).toBe(q);

    q.value = 'W';
    q.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    expect($('q-err').hidden).toBe(true);
    expect($('q-err').textContent).toBe('');
    expect(q.hasAttribute('aria-invalid')).toBe(false);
    expect((q.getAttribute('aria-describedby') ?? '').split(' ')).not.toContain('q-err');
    q.value = '';
  });

  it('5. one chip sends its question at once; verified claims are labelled (R3.2, R12.1, R12.7, R12.8)', async () => {
    page.click(button(CRYPT_QUESTIONS[0]!));
    await page.until(() => page.turns().length === 1, 'the answer');
    const ask = page.requests.filter((r) => r.path === '/api/ask');
    expect(ask).toHaveLength(1);
    expect((ask[0]!.body as { question: string }).question).toBe(CRYPT_QUESTIONS[0]);

    const turn = lastTurn();
    const q = turn.previousElementSibling!;
    expect(q.className).toBe('turn-q');
    expect(q.firstElementChild?.className).toBe('visually-hidden');
    expect(q.firstElementChild?.textContent).toBe('You asked: ');
    expect(q.textContent).toBe(`You asked: ${CRYPT_QUESTIONS[0]}`);

    const mem = turn.querySelector('article.claim.memory')!;
    expect(mem.querySelector('.lab')?.textContent).toBe('Verified');
    expect(mem.querySelector('.lab')?.nextElementSibling?.className).toBe('txt');
    expect(mem.querySelector('.found-head')?.textContent).toBe(
      'The words the ward found',
    );
    expect(turn.querySelector('.lab.recorded')).toBeNull();
    const tally = turn.querySelector('.tally')!;
    for (const a of ['role', 'aria-live', 'aria-atomic'])
      expect(tally.hasAttribute(a)).toBe(false);

    const lit = [...page.doc.querySelectorAll('#ledger li.lit')];
    expect(lit.length).toBeGreaterThan(0);
    for (const row of lit) {
      expect(row.querySelector('.visually-hidden')?.textContent).toBe(
        'Cited in the latest answer',
      );
    }
    for (const row of page.doc.querySelectorAll('#ledger li:not(.lit)')) {
      expect(row.querySelector('.visually-hidden')).toBeNull();
    }

    expect(doneShown('ask')).toBe(true);
    expect($('guide-step-ask').getAttribute('data-done')).toBe('true');
    expect($('ask-status').textContent).toBe(
      'The ghost answered: 1 of 1 claims verified.',
    );
    expect($('copy-report-btn').hidden).toBe(false);
    expect($('verified-counter').textContent).toBe(
      '1 of 1 claims verified this séance, plus 1 silence claim not checked',
    );
  });

  let counter = '';
  let flame = '';
  let report = '';

  it('6. "Invent a citation" plants at once and is refused, without touching the ghost’s counter (R3.3, R4.1–R4.3)', async () => {
    counter = $('verified-counter').textContent ?? '';
    flame = confidence();
    report = await copyReport();
    expect(report.length).toBeGreaterThan(0);

    page.click(button('Invent a citation'));
    await page.until(() => page.turns().length === 2, 'the invent verdict');
    expect(wardRequests()).toBe(1);
    expect(page.input('plant-sha').value).toBe('deadbee');
    expect(page.input('plant-quote').value).toBe(
      'so Windows XP clients would not time out',
    );

    const turn = lastTurn();
    const q = turn.previousElementSibling!;
    expect(q.className).toBe('turn-q planted');
    expect(norm(q.textContent).startsWith('Planted by you')).toBe(true);
    expect(q.querySelector('.lab')?.textContent).toBe('Planted by you');
    expect(norm(q.textContent)).toBe(
      'Planted by you I added this wait so Windows XP clients would not time out.',
    );
    expect(turn.querySelector('article.claim.rejected .why')?.textContent).toBe(
      `The ward refused it: ${F4('deadbee')}`,
    );
    expect($('ward-status').textContent).toBe('The ward refused your claim.');
    expect($('verified-counter').textContent).toBe(counter);
    expect(confidence()).toBe(flame);
    expect(doneShown('ward')).toBe(true);
  });

  it('R3.3, R4.1. "Misquote a real commit" and "Blame the wrong author" send at once and are refused; the report stays the ghost’s', async () => {
    page.click(button('Misquote a real commit'));
    await page.until(() => page.turns().length === 3, 'the misquote verdict');
    expect(wardRequests()).toBe(2);
    const sha = page.input('plant-sha').value;
    expect(page.input('plant-text').value).toBe(
      'The vendor banned our account for sending too many requests.',
    );
    expect(page.input('plant-quote').value).toBe('banned our account');
    expect(lastTurn().querySelector('article.claim.rejected .why')?.textContent).toBe(
      `The ward refused it: ${F9(sha)}`,
    );

    page.click(button('Blame the wrong author'));
    await page.until(() => page.turns().length === 4, 'the wrongauthor verdict');
    expect(wardRequests()).toBe(3);
    const other = /^(.*) wrote this line\.$/.exec(page.input('plant-text').value)?.[1];
    expect(other).toBeDefined();
    expect(lastTurn().querySelector('article.claim.rejected .why')?.textContent).toBe(
      `The ward refused it: ${F11(other!)}`,
    );
    expect($('ward-status').textContent).toBe('The ward refused your claim.');

    expect($('verified-counter').textContent).toBe(counter);
    expect(confidence()).toBe(flame);
    expect(await copyReport()).toBe(report);
  });

  it('7. the exorcism renders and its status stays (R3.4, R12.3)', async () => {
    page.click($('exorcise-btn'));
    await page.until(() => !$('exorcism-wrap').hidden, 'the exorcism');
    expect($('ex-recorded').hidden).toBe(true);
    const status = $('exorcise-status').textContent ?? '';
    expect(status.startsWith('Exorcism ready:')).toBe(true);
    expect(status).toMatch(
      /^Exorcism ready: \d+ of 100, (Restless|Troubled|Haunted|Possessed)\. \d+ of \d+ plan claims verified\.$/,
    );
    expect(status).toContain(
      `${$('ex-score').textContent} of 100, ${$('ex-severity').textContent}.`,
    );
    expect($('ex-verified').hasAttribute('aria-live')).toBe(false);
    expect(doneShown('exorcise')).toBe(true);
    expect($('exorcise-btn').hasAttribute('disabled')).toBe(false);
  });

  it('8. the guide buttons come in step order, are native, enabled and in the tab order (R3.6)', () => {
    const buttons = [...page.doc.querySelectorAll('#guide button')] as HTMLElement[];
    // T8, R13.7: the possessed ghost's button stays hidden on crypt
    expect($('possess-btn').hasAttribute('hidden')).toBe(true);
    const labels = buttons.filter((b) => !b.hidden).map((b) => norm(b.textContent));
    expect(labels).toEqual([
      ...CRYPT_QUESTIONS,
      'Invent a citation',
      'Misquote a real commit',
      'Blame the wrong author',
      'Start the exorcism',
    ]);
    for (const b of buttons) {
      expect(b.getAttribute('type')).toBe('button');
      expect(b.hasAttribute('disabled')).toBe(false);
      expect(Number(b.getAttribute('tabindex') ?? '0')).toBeLessThanOrEqual(0);
    }
    expect(
      page.doc.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])'),
    ).toHaveLength(0);
  });

  it('9. a new summon starts from a clean page (R4.4, R12.2)', async () => {
    const summons = page.requests.filter((r) => r.path === '/api/summon').length;
    page.$('q').focus();
    page.submit('summon-form');
    await page.until(
      () =>
        page.requests.filter((r) => r.path === '/api/summon').length === summons + 1 &&
        page.turns().length === 0,
      'the second séance',
    );
    expect($('verified-counter').textContent).toBe('');
    for (const step of ['ask', 'ward', 'exorcise']) {
      expect(doneShown(step)).toBe(false);
      expect($(`guide-step-${step}`).getAttribute('data-done')).toBe('false');
    }
    expect($('log').children).toHaveLength(0);
    expect($('ask-status').textContent).toBe('');
    expect($('ward-status').textContent).toBe('');
    expect($('exorcise-status').textContent).toBe('');
    expect($('q-err').hidden).toBe(true);
    expect($('copy-report-btn').hidden).toBe(true);
    expect($('exorcism-wrap').hidden).toBe(true);
    expect($('ex-recorded').hidden).toBe(true);
    expect(page.doc.activeElement).toBe($('h-guide'));
    expect($('possess-btn').hasAttribute('hidden')).toBe(true);
    expect(
      [...page.doc.querySelectorAll('#guide-chips button')].map((b) =>
        norm(b.textContent),
      ),
    ).toEqual(CRYPT_QUESTIONS);
  });
});
