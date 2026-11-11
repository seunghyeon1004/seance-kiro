/* global Element, HTMLElement -- DOM types only; the nodes come from jsdom */
/**
 * DOM end-to-end, not a rendering test. public/index.html runs in jsdom with public/app.js evaluated
 * unmodified; every request goes to the real createApp() in process (real git, ledger, ward, plan
 * verification). Only the model is scripted. No browser is launched, so layout, colour and motion
 * are not checked here: test/ui/polish.test.ts reads the CSS. Stubbed: fetch (in process),
 * matchMedia (answered per query by the `media` option), scrollIntoView and focus (recorded).
 *
 * first-seance T12 — the polish addendum from the two re-audits (requirements.md R15,
 * design.md §18): docs/kiro-evidence/reaudit-layout-session.txt and reaudit-first-run-session.txt.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import {
  CryptClient,
  DownClient,
  REASONS,
  buildSamples,
  norm,
  openPage,
} from './harness.js';
import type { Page, ProxyRequest, Samples, SummonItem } from './harness.js';

const { F11 } = REASONS;
const LIMIT =
  "The ward checks that each quote is really in the cited commit. It cannot check that the ghost's sentence says the same thing as the quote, so read both.";
const WAIT = 'Wait for the ghost to finish answering.';
const GH_NOTE = 'Séance reads the default branch and the most recent 100 commits.';
const BLOB_NOTE =
  'Filled in the file and lines from the link. Séance reads the default branch, not the branch or commit in the link.';
const NO_MODEL_NOTE =
  'The live model is unavailable here, so only the sample lines have recorded answers.';
const ORDERED_LABEL =
  'Not verified: the commits ordered this sentence as a silence claim. A silence claim cites nothing, so the ward never verifies it.';
const POSSESSED_LINE =
  "This sample's commits try to give the ghost orders. Flagged commits are marked.";
const EX_WORDS =
  "The summary, the tests, the steps and the reasons are the model's words. The ward checked only the cited claims shown under each step.";
const WIDE = '(min-width: 60rem)';

type Hook = (req: ProxyRequest) => Promise<Response | undefined>;

let samples: Samples;
const pages: Page[] = [];

beforeAll(() => {
  samples = buildSamples();
}, 60_000);

afterAll(() => {
  for (const p of pages) p.close();
  if (samples) fs.rmSync(samples.root, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A page whose proxy runs `hooks[path]` when one is set, and passes the request on otherwise. */
async function open(
  hooks: Record<string, Hook | undefined>,
  extra: Partial<Parameters<typeof openPage>[0]> = {},
): Promise<Page> {
  const p = await openPage({
    samples,
    client: new CryptClient(),
    proxy: (req) => {
      const h = hooks[req.path];
      return h ? h(req) : undefined;
    },
    ...extra,
  } as Parameters<typeof openPage>[0]);
  pages.push(p);
  return p;
}

async function summonWith(p: Page, repo: string, file: string, a: number, b: number) {
  p.setRepo(repo);
  p.input('file').value = file;
  p.input('start').value = String(a);
  p.input('end').value = String(b);
  const n = p.requests.filter((r) => r.path === '/api/summon').length;
  p.submit('summon-form');
  await p.until(
    () =>
      p.requests.filter((r) => r.path === '/api/summon').length === n + 1 &&
      !p.$('summon-btn').hasAttribute('aria-disabled'),
    'the summon',
  );
}

const chips = (p: Page): HTMLElement[] => [
  ...p.doc.querySelectorAll<HTMLElement>('#guide-chips button'),
];
const preset = (p: Page, name: string): HTMLElement =>
  p.doc.querySelector<HTMLElement>(`[data-preset="${name}"]`)!;
const describedBy = (n: Element): string[] =>
  (n.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
const limitsIn = (n: Element): number =>
  [...n.querySelectorAll('p.meta')].filter((x) => x.textContent === LIMIT).length;

// ---------------------------------------------------------------------------
// The crypt on a wide screen: copy, scroll and focus, the limit sentence, errors in place
// ---------------------------------------------------------------------------

describe('crypt, wide screen', { timeout: 30_000 }, () => {
  const hooks: Record<string, Hook | undefined> = {};
  let p: Page;
  let summoned: { items: SummonItem[] } | null = null;

  beforeAll(async () => {
    p = await open(hooks, {
      media: { [WIDE]: true },
      nodeTimers: true,
      onSummon: (d) => {
        summoned = d;
      },
    });
  }, 30_000);

  it('F5: a GitHub link in the repository field adds the default-branch note', () => {
    p.setRepo('https://github.com/acme/billing');
    expect(p.$('repo-note').hidden).toBe(false);
    expect(p.$('repo-note').textContent).toBe(GH_NOTE);
    p.setRepo('https://github.com/acme/billing/blob/main/src/a.js#L3');
    expect(p.$('repo-note').textContent).toBe(`${BLOB_NOTE} ${GH_NOTE}`);
    p.setRepo('crypt');
    expect(p.$('repo-note').hidden).toBe(true);
    expect(p.$('repo-note').textContent).toBe('');
  });

  it('F6, L4: the summon sends no token; on a wide screen #seance is scrolled to and #h-guide focused without scrolling', async () => {
    await summonWith(p, 'crypt', 'legacy/tax.js', 7, 7);
    const sent = p.requests.filter((r) => r.path === '/api/summon').at(-1)!;
    expect(sent.body).toEqual({
      repoUrl: 'crypt',
      file: 'legacy/tax.js',
      startLine: 7,
      endLine: 7,
    });
    const scroll = p.scrolls.at(-1)!;
    expect(scroll.id).toBe('seance');
    expect(scroll.options).toMatchObject({ block: 'start' });
    const focus = p.focuses.at(-1)!;
    expect(focus.id).toBe('h-guide');
    expect(focus.options).toEqual({ preventScroll: true });
    expect(focus.seq).toBeGreaterThan(scroll.seq);
    expect(p.doc.activeElement).toBe(p.$('h-guide'));
    // F5: the possessed line is for the possessed sample only
    expect(p.$('crypt-possessed').hidden).toBe(true);
    // F9: a sample line on a server with a model needs no way back
    expect(p.$('guide-ask-note').hidden).toBe(true);
    expect(p.$('back-btn').hidden).toBe(true);
    // F10: a ledger with commits keeps every preset
    for (const n of ['invent', 'misquote', 'wrongauthor'])
      expect(preset(p, n).hidden, n).toBe(false);
  });

  it('L14: the ghost’s name is inserted in a <bdi> next to the fixed copy', () => {
    const name = p.$('ghost-name');
    const bdi = name.querySelector('bdi');
    expect(bdi).not.toBeNull();
    expect(name.firstChild).toBe(bdi);
    expect(name.textContent).toBe(`${bdi!.textContent}, speaking only from the commits.`);
    expect(summoned!.items.map((i) => i.author)).toContain(bdi!.textContent);
  });

  it('F3, L11: a chip answer says "passed the ward", carries the limit sentence once, and takes focus after its scroll', async () => {
    const before = p.focuses.length;
    p.click(chips(p)[0]!);
    await p.until(() => p.turns().length === 1, 'the answer');
    const turn = p.turns()[0]!;
    expect(norm(turn.querySelector('.tally')?.textContent)).toBe(
      '1 of 1 claims passed the ward. 1 silence claim was not checked.',
    );
    expect(turn.querySelector('.tally strong')?.textContent).toBe('1 of 1');
    expect(turn.querySelector('.tally')?.nextElementSibling?.textContent).toBe(LIMIT);
    expect(p.$('ask-status').textContent).toBe(
      'The ghost answered: 1 of 1 claims passed the ward.',
    );
    expect(p.$('verified-counter').textContent).toBe(
      '1 of 1 claims passed the ward this séance, plus 1 silence claim not checked',
    );
    expect(turn.getAttribute('tabindex')).toBe('-1');
    expect(p.doc.activeElement).toBe(turn);
    const f = p.focuses.slice(before).find((x) => x.el === turn)!;
    expect(f.options).toEqual({ preventScroll: true });
    const s = p.scrolls.filter((x) => x.el === turn).at(-1)!;
    expect(f.seq).toBeGreaterThan(s.seq);
    // the claim's own label is unchanged: the citations are verified, not the sentence
    expect(turn.querySelector('article.claim.memory .lab')?.textContent).toBe(
      'Citations verified',
    );
  });

  it('F3: the second ghost answer has no limit sentence; the page shows it once', async () => {
    p.click(chips(p)[1]!);
    await p.until(() => p.turns().length === 2, 'the second answer');
    expect(limitsIn(p.turns()[1]!)).toBe(0);
    expect(limitsIn(p.$('log'))).toBe(1);
    expect(p.doc.getElementById('ward-limit')).toBeNull();
  });

  it('F10: chip and preset clicks while the ghost answers say to wait; ask shows elapsed seconds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const g = gate();
    hooks['/api/ask'] = async () => {
      await g.wait;
      return undefined;
    };
    const asks = p.requests.filter((r) => r.path === '/api/ask').length;
    const wards = p.requests.filter((r) => r.path === '/api/ward').length;
    p.click(chips(p)[2]!);
    await p.until(() => p.$('ask-status').textContent === 'The ghost stirs…', 'busy');
    p.click(chips(p)[0]!);
    expect(p.$('guide-ask-status').textContent).toBe(WAIT);
    p.click(preset(p, 'invent'));
    expect(p.$('ward-status').textContent).toBe(WAIT);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(p.$('ask-elapsed').textContent).toBe('2 seconds so far');
    g.open();
    await p.until(() => p.turns().length === 3, 'the third answer');
    hooks['/api/ask'] = undefined;
    expect(p.$('ask-elapsed').textContent).toBe('');
    expect(p.requests.filter((r) => r.path === '/api/ask').length).toBe(asks + 1);
    expect(p.requests.filter((r) => r.path === '/api/ward').length).toBe(wards);
    expect(p.$('guide-ask-status').textContent).toBe('');
  });

  it('F1, L11: "Blame the wrong author" says "<name> wrote commit <sha7>." about a commit by someone else; the planted turn takes focus and has no limit sentence', async () => {
    const n = p.turns().length;
    p.click(preset(p, 'wrongauthor'));
    await p.until(() => p.turns().length === n + 1, 'the wrongauthor verdict');
    const claim = (
      p.requests.at(-1)!.body as {
        answer: {
          claims: Array<{
            text: string;
            citations: Array<{ sha7: string; quote: string }>;
          }>;
        };
      }
    ).answer.claims[0]!;
    const m = /^(.+) wrote commit ([0-9a-f]{7})\.$/.exec(claim.text);
    expect(m).not.toBeNull();
    const [, other, sha] = m!;
    expect(claim.citations).toEqual([{ sha7: sha, quote: claim.citations[0]!.quote }]);
    const cited = summoned!.items.find((i) => i.shortSha === sha)!;
    expect(cited.author).not.toBe(other);
    expect(claim.citations[0]!.quote).toBe(cited.subject);
    const turn = p.turns().at(-1)!;
    expect(turn.querySelector('article.claim.rejected .why')?.textContent).toBe(
      `The ward refused it: ${F11(other!)}`,
    );
    expect(limitsIn(turn)).toBe(0);
    expect(p.doc.activeElement).toBe(turn);
  });

  it('L6: a failed preset is reported in step 2, tied to its button, not in the log', async () => {
    hooks['/api/ward'] = async () =>
      json(429, { error: 'The ward needs a short rest.', code: 'RATE_LIMITED' });
    const notices = p.doc.querySelectorAll('#log .notice').length;
    const b = preset(p, 'invent');
    p.click(b);
    await p.until(() => !p.$('ward-err').hidden, 'the ward error');
    hooks['/api/ward'] = undefined;
    expect(p.$('ward-err').textContent).toBe('The ward needs a short rest.');
    expect(p.$('ward-err').getAttribute('role')).toBe('alert');
    expect(p.$('guide-step-ward').contains(p.$('ward-err'))).toBe(true);
    expect(describedBy(b)).toContain('ward-err');
    expect(p.doc.querySelectorAll('#log .notice').length).toBe(notices);
    // the next press clears it
    p.click(b);
    await p.until(() => p.$('ward-err').hidden, 'the cleared error');
    expect(describedBy(b)).not.toContain('ward-err');
  });

  it('L6, F10: a failed exorcism is reported in step 3; the next one shows elapsed seconds and the F7 and F3 copy', async () => {
    hooks['/api/exorcise'] = async () =>
      json(503, {
        code: 'MODEL_BUSY',
        message: 'The spirits are busy. Try again in a minute.',
      });
    const notices = p.doc.querySelectorAll('#log .notice').length;
    const b = p.$('exorcise-btn');
    p.click(b);
    await p.until(() => !p.$('exorcise-err').hidden, 'the exorcise error');
    expect(p.$('exorcise-err').textContent).toBe(
      'The spirits are busy. Try again in a minute.',
    );
    expect(p.$('exorcise-err').getAttribute('role')).toBe('alert');
    expect(p.$('guide-step-exorcise').contains(p.$('exorcise-err'))).toBe(true);
    expect(describedBy(b)).toContain('exorcise-err');
    expect(p.doc.querySelectorAll('#log .notice').length).toBe(notices);

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const g = gate();
    hooks['/api/exorcise'] = async () => {
      await g.wait;
      return undefined;
    };
    p.click(b);
    await p.until(() => p.$('exorcise-err').hidden, 'the cleared error');
    expect(describedBy(b)).not.toContain('exorcise-err');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(p.$('exorcise-elapsed').textContent).toBe('1 second so far');
    g.open();
    await p.until(() => !p.$('exorcism-wrap').hidden, 'the exorcism');
    hooks['/api/exorcise'] = undefined;
    expect(p.$('exorcise-elapsed').textContent).toBe('');

    expect(norm(p.$('ex-words').textContent)).toBe(EX_WORDS);
    expect(norm(p.$('ex-tests-lab').textContent)).toBe(
      'Read each test before you run it.',
    );
    expect(p.$('exorcism').textContent).not.toContain("model's words, not checked");
    expect(p.$('ex-verified').textContent).toMatch(
      /^\d+ of \d+ plan claims passed the ward\.$/,
    );
    expect(p.$('exorcise-status').textContent).toMatch(
      /^Exorcism ready: \d+ of 100, (Restless|Troubled|Haunted|Possessed)\. \d+ of \d+ plan claims passed the ward\.$/,
    );
  });

  it('L12: a cite click scrolls its row with block "nearest"', () => {
    const cite = p.doc.querySelector<HTMLElement>('#log .cite:not([disabled])')!;
    p.click(cite);
    const s = p.scrolls.at(-1)!;
    expect(s.id).toBe(`ledger-item-${norm(cite.textContent)}`);
    expect(s.options).toMatchObject({ block: 'nearest' });
  });

  it('F10: an empty ledger hides the misquote and wrong-author buttons, and a new summon shows them again', async () => {
    hooks['/api/summon'] = async (req) => {
      const res = await req.forward();
      const data = (await res.json()) as Record<string, unknown>;
      return json(200, { ...data, items: [] });
    };
    await summonWith(p, 'crypt', 'legacy/tax.js', 7, 7);
    hooks['/api/summon'] = undefined;
    expect(p.doc.querySelectorAll('#ledger > li')).toHaveLength(0);
    expect(preset(p, 'invent').hidden).toBe(false);
    expect(preset(p, 'misquote').hidden).toBe(true);
    expect(preset(p, 'wrongauthor').hidden).toBe(true);
    await summonWith(p, 'crypt', 'legacy/tax.js', 7, 7);
    expect(preset(p, 'misquote').hidden).toBe(false);
    expect(preset(p, 'wrongauthor').hidden).toBe(false);
  });

  it('L14: map names sit in <bdi> elements', () => {
    const legendName = p.doc.querySelector('#map-legend .map-name');
    expect(legendName?.tagName).toBe('BDI');
    const h = p.doc.querySelector('#map-groups h3')!;
    expect(h.querySelector('bdi')?.textContent).toBe('Priya Ramanathan');
    expect(norm(h.textContent)).toBe('Haunted by Priya Ramanathan');
    const who = p.doc.querySelector('#map-groups .map-who bdi');
    expect(who).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The narrow screen keeps the current scroll target (L4)
// ---------------------------------------------------------------------------

describe('crypt, narrow screen', { timeout: 30_000 }, () => {
  it('L4: below 60rem the page scrolls to #h-guide, as before', async () => {
    const p = await open({});
    await summonWith(p, 'crypt', 'legacy/tax.js', 7, 7);
    const scroll = p.scrolls.at(-1)!;
    expect(scroll.id).toBe('h-guide');
    expect(scroll.options).toMatchObject({ block: 'start' });
    expect(p.doc.activeElement).toBe(p.$('h-guide'));
    expect(p.focuses.at(-1)!.options).toEqual({ preventScroll: true });
  });
});

// ---------------------------------------------------------------------------
// The possessed sample: the crypt line, the scripted silence claim, errors in step 2
// ---------------------------------------------------------------------------

describe('possessed', { timeout: 30_000 }, () => {
  const hooks: Record<string, Hook | undefined> = {};
  let p: Page;

  beforeAll(async () => {
    p = await open(hooks);
    await summonWith(p, 'possessed', 'auth/throttle.js', 4, 4);
  }, 30_000);

  it('F5: the crypt says once that this sample’s commits give orders', () => {
    const line = p.$('crypt-possessed');
    expect(line.hidden).toBe(false);
    expect(norm(line.textContent)).toBe(POSSESSED_LINE);
  });

  it('F2, L11: the scripted silence claim is labelled as not verified and styled as unverified; #ward-status counts from the tally', async () => {
    p.click(p.$('possess-btn'));
    await p.until(() => p.turns().length === 1, 'the scripted verdict');
    const turn = p.turns()[0]!;
    const sil = [...turn.querySelectorAll('article.claim.silence')];
    expect(sil).toHaveLength(1);
    expect(sil[0]!.classList.contains('ordered')).toBe(true);
    expect(sil[0]!.querySelector('.lab')?.textContent).toBe(ORDERED_LABEL);
    expect(p.$('ward-status').textContent).toBe(
      '0 of 4 claims from the possessed ghost passed the ward. 1 silence claim was not checked.',
    );
    expect(limitsIn(turn)).toBe(0);
    expect(p.doc.activeElement).toBe(turn);
  });

  it('L6: a failed possess is reported in step 2, tied to the button', async () => {
    hooks['/api/possess'] = async () =>
      json(429, { error: 'The ward needs a short rest.', code: 'RATE_LIMITED' });
    const notices = p.doc.querySelectorAll('#log .notice').length;
    p.click(p.$('possess-btn'));
    await p.until(() => !p.$('ward-err').hidden, 'the possess error');
    hooks['/api/possess'] = undefined;
    expect(p.$('ward-err').textContent).toBe('The ward needs a short rest.');
    expect(describedBy(p.$('possess-btn'))).toContain('ward-err');
    expect(p.doc.querySelectorAll('#log .notice').length).toBe(notices);
  });

  it('F5: a crypt summon hides the possessed line again', async () => {
    await summonWith(p, 'crypt', 'legacy/tax.js', 7, 7);
    expect(p.$('crypt-possessed').hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No model on this server (F9)
// ---------------------------------------------------------------------------

describe('no model on this server', { timeout: 30_000 }, () => {
  let p: Page;

  beforeAll(async () => {
    p = await open({}, { noKey: true });
  }, 30_000);

  it('F9: the sample line needs no way back', async () => {
    await summonWith(p, 'crypt', 'legacy/tax.js', 7, 7);
    expect(p.$('guide-ask-note').hidden).toBe(true);
    expect(p.$('back-btn').hidden).toBe(true);
  });

  it('F8, F9: "Summon here" on another file shows the note and "Back to crypt, line 7"; the "You are here" tile has no button', async () => {
    const here = p.doc.querySelector('#map .map-tile[data-path="legacy/tax.js"]')!;
    expect(here.querySelector('button')).toBeNull();
    const b = p.doc.querySelector<HTMLElement>(
      '#map .map-tile[data-path="legacy/vendor.js"] button',
    )!;
    const n = p.requests.filter((r) => r.path === '/api/summon').length;
    p.click(b);
    await p.until(
      () =>
        p.requests.filter((r) => r.path === '/api/summon').length === n + 1 &&
        !p.$('map').hasAttribute('aria-busy'),
      'the whole-file summon',
    );
    expect(p.$('guide-ask-note').hidden).toBe(false);
    expect(norm(p.$('guide-ask-note').textContent)).toBe(NO_MODEL_NOTE);
    expect(p.$('back-btn').hidden).toBe(false);
    expect(norm(p.$('back-btn').textContent)).toBe('Back to crypt, line 7');
  });

  it('F9: the button summons the sample’s default range again and the recordings answer', async () => {
    const n = p.requests.filter((r) => r.path === '/api/summon').length;
    p.click(p.$('back-btn'));
    await p.until(
      () =>
        p.requests.filter((r) => r.path === '/api/summon').length === n + 1 &&
        !p.$('summon-btn').hasAttribute('aria-disabled'),
      'the summon back',
    );
    expect(p.requests.filter((r) => r.path === '/api/summon').at(-1)!.body).toEqual({
      repoUrl: 'crypt',
      file: 'legacy/tax.js',
      startLine: 7,
      endLine: 7,
    });
    expect(p.input('file').value).toBe('legacy/tax.js');
    expect(p.input('start').value).toBe('7');
    expect(p.input('end').value).toBe('7');
    expect(p.$('guide-ask-note').hidden).toBe(true);
    expect(p.$('back-btn').hidden).toBe(true);
  });

  it('F9: the button goes back to the last sample used', async () => {
    await summonWith(p, 'possessed', 'auth/throttle.js', 1, 2);
    expect(p.$('guide-ask-note').hidden).toBe(false);
    expect(norm(p.$('back-btn').textContent)).toBe('Back to possessed, line 4');
  });
});

// ---------------------------------------------------------------------------
// The model fails on a range with no recording (F9)
// ---------------------------------------------------------------------------

describe('the model fails outside a sample line', { timeout: 30_000 }, () => {
  it('F9: after a model failure the note and the way back appear', async () => {
    const p = await open({}, { client: new DownClient() });
    await summonWith(p, 'crypt', 'legacy/tax.js', 1, 2);
    expect(p.$('guide-ask-note').hidden).toBe(true);
    p.click(chips(p)[0]!);
    await p.until(() => !p.$('guide-ask-note').hidden, 'the note');
    expect(norm(p.$('guide-ask-note').textContent)).toBe(NO_MODEL_NOTE);
    expect(norm(p.$('back-btn').textContent)).toBe('Back to crypt, line 7');
  });
});
