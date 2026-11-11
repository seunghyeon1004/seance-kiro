/**
 * DOM end-to-end, not a rendering test. public/index.html runs in jsdom with public/app.js evaluated
 * unmodified; every request goes to the real createApp() in process (real git, ledger, ward, plan
 * verification). Only the model is scripted. No browser is launched, so layout, focus rings, colour
 * and motion are not checked here. Stubbed: fetch (in process), matchMedia, scrollIntoView.
 *
 * first-seance T7 — flow 5, the session expired (design.md §10.3, R10.3). The server's session map
 * is cleared, as the TTL sweep would do.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { CryptClient, buildSamples, norm, openPage } from './harness.js';
import type { Page, Samples } from './harness.js';

const ENDED = 'The séance has ended. Summon the ghost again.';

let samples: Samples;
let page: Page;

beforeAll(async () => {
  samples = buildSamples();
  page = await openPage({ samples, client: new CryptClient() });
}, 60_000);

afterAll(() => {
  page?.close();
  if (samples) fs.rmSync(samples.root, { recursive: true, force: true });
});

async function summon(): Promise<void> {
  const n = page.requests.filter((r) => r.path === '/api/summon').length;
  page.submit('summon-form');
  await page.until(
    () =>
      !page.$('seance').hidden &&
      page.requests.filter((r) => r.path === '/api/summon').length === n + 1,
    'the séance',
  );
}
function expectEnded(): void {
  expect(page.$('seance').hidden).toBe(true);
  expect(page.$('summon-err').hidden).toBe(false);
  expect(page.$('summon-err').textContent).toBe(ENDED);
  expect(page.doc.activeElement).toBe(page.$('repo'));
}

describe('flow 5: the session expired', { timeout: 20_000 }, () => {
  it('a chip question returns to the summon form', async () => {
    await summon();
    page.server.sessions.clear();
    page.click(page.doc.querySelector('#guide-chips button')!);
    await page.until(() => page.$('seance').hidden, 'the end of the séance');
    expectEnded();
    expect(page.requests.at(-1)).toMatchObject({ path: '/api/ask', status: 404 });
  });

  it('a planted claim returns to the summon form', async () => {
    await summon();
    page.server.sessions.clear();
    const invent = [...page.doc.querySelectorAll('#guide button')].find(
      (b) => norm(b.textContent) === 'Invent a citation',
    )!;
    page.click(invent);
    await page.until(() => page.$('seance').hidden, 'the end of the séance');
    expectEnded();
    expect(page.requests.at(-1)).toMatchObject({ path: '/api/ward', status: 404 });
  });

  it('the exorcism returns to the summon form', async () => {
    await summon();
    page.server.sessions.clear();
    page.click(page.$('exorcise-btn'));
    await page.until(() => page.$('seance').hidden, 'the end of the séance');
    expectEnded();
  });
});
