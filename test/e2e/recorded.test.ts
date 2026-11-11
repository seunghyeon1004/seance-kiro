/**
 * DOM end-to-end, not a rendering test. public/index.html runs in jsdom with public/app.js evaluated
 * unmodified; every request goes to the real createApp() in process (real git, ledger, ward, plan
 * verification). Only the model is scripted. No browser is launched, so layout, focus rings, colour
 * and motion are not checked here. Stubbed: fetch (in process), matchMedia, scrollIntoView.
 *
 * first-seance T7 — flow 3, the model is down (design.md §10.3, R7.3, R7.10, R12.1). The
 * recordings are written into a temp RECORDINGS_DIR by recordAnswers with the scripted
 * CryptClient (N7); the shipped recordings/ files are not read. The server re-checks every
 * recording with the live ward.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CryptClient, DownClient, buildSamples, norm, openPage } from './harness.js';
import type { Page, Samples } from './harness.js';
import { recordAnswers } from '../../scripts/record-answers.js';

const RECORDED_LABEL =
  'A recorded answer (the live model is unavailable). The ward checked it again just now.';
const RECORDED_PLAN =
  'A recorded plan (the live model is unavailable). The ward checked it again just now.';
const MODEL_NOTE =
  'The model is resting on this server. The sample questions have recorded answers, which the ward checks again; the ward demo works as always.';

let samples: Samples;
let rec: string;
let page: Page | undefined;
const savedRecDir = process.env['RECORDINGS_DIR'];

beforeAll(async () => {
  samples = buildSamples();
  rec = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-e2e-rec-'));
  const savedKey = process.env['ANTHROPIC_API_KEY'];
  process.env['ANTHROPIC_API_KEY'] = 'test-dummy-key-not-a-secret';
  try {
    await recordAnswers({
      outDir: rec,
      client: new CryptClient(),
      samples: ['crypt'],
      log: () => undefined,
    });
  } finally {
    if (savedKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = savedKey;
  }
  process.env['RECORDINGS_DIR'] = rec;
}, 120_000);

afterAll(() => {
  if (savedRecDir === undefined) delete process.env['RECORDINGS_DIR'];
  else process.env['RECORDINGS_DIR'] = savedRecDir;
  if (samples) fs.rmSync(samples.root, { recursive: true, force: true });
  if (rec) fs.rmSync(rec, { recursive: true, force: true });
});

afterEach(() => {
  page?.close();
  page = undefined;
});

async function summon(p: Page): Promise<void> {
  p.submit('summon-form');
  await p.until(() => !p.$('seance').hidden, 'the séance');
}
const firstChip = (p: Page) => p.doc.querySelector('#guide-chips button')!;

describe('flow 3: the model is down', { timeout: 30_000 }, () => {
  it('(a) with no key, a chip gets the recorded answer, checked by the live ward', async () => {
    page = await openPage({ samples, noKey: true });
    const p = page;
    expect(p.$('model-note').hidden).toBe(false);
    expect(norm(p.$('model-note').textContent)).toBe(MODEL_NOTE);
    await summon(p);
    p.click(firstChip(p));
    await p.until(() => p.turns().length === 1, 'the recorded answer');
    const turn = p.turns()[0]!;
    expect(turn.firstElementChild?.className).toBe('lab recorded');
    expect(turn.firstElementChild?.textContent).toBe(RECORDED_LABEL);
    const mem = turn.querySelector('article.claim.memory')!;
    expect(mem.querySelector('.lab')?.textContent).toBe('Citations verified');
    expect(mem.querySelector('.found-head')?.textContent).toBe(
      'The words the ward found',
    );
    expect(p.$('ask-status').textContent?.startsWith('A recorded answer:')).toBe(true);
    expect(p.$('ask-status').textContent).toBe(
      'A recorded answer: 1 of 1 claims passed the ward.',
    );
    // a recorded answer is the ghost's: it counts (R7.10)
    expect(p.$('verified-counter').textContent).toBe(
      '1 of 1 claims passed the ward this séance, plus 1 silence claim not checked',
    );
    const ask = p.requests.find((r) => r.path === '/api/ask');
    expect(ask?.status).toBe(200);
    expect((ask?.data as { recorded: boolean }).recorded).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('(b) with a model that answers 529, a chip gets the recorded answer', async () => {
    const down = new DownClient();
    page = await openPage({ samples, client: down });
    const p = page;
    expect(p.$('model-note').hidden).toBe(true);
    await summon(p);
    p.click(firstChip(p));
    await p.until(() => p.turns().length === 1, 'the recorded answer');
    expect(down.calls).toHaveLength(1);
    const turn = p.turns()[0]!;
    expect(turn.querySelector('.lab.recorded')?.textContent).toBe(RECORDED_LABEL);
    expect(turn.querySelectorAll('article.claim.memory')).toHaveLength(1);
    expect(turn.querySelectorAll('article.claim.rejected')).toHaveLength(0);
  });

  it('(c) a typed question gets no recording, only the busy message', async () => {
    const down = new DownClient();
    page = await openPage({ samples, client: down });
    const p = page;
    await summon(p);
    p.input('q').value = 'Why is the sky blue?';
    p.submit('ask-form');
    await p.until(() => p.doc.querySelector('#log .notice') !== null, 'the notice');
    expect(p.doc.querySelector('#log .notice')?.textContent).toBe(
      'The spirits are busy. Try again in a minute.',
    );
    expect(p.doc.querySelector('#log .lab.recorded')).toBeNull();
    expect(p.turns()).toHaveLength(0);
    expect(p.requests.filter((r) => r.path === '/api/ask')).toHaveLength(1);
    expect(p.$('ask-status').textContent).toBe('');
  });

  it('(d) the exorcism gets the recorded plan, labelled', async () => {
    page = await openPage({ samples, client: new DownClient() });
    const p = page;
    await summon(p);
    p.click(p.$('exorcise-btn'));
    await p.until(() => !p.$('exorcism-wrap').hidden, 'the recorded plan');
    expect(p.$('ex-recorded').hidden).toBe(false);
    expect(norm(p.$('ex-recorded').textContent)).toBe(RECORDED_PLAN);
    expect(p.$('exorcise-status').textContent?.startsWith('Exorcism ready:')).toBe(true);
  });
});
