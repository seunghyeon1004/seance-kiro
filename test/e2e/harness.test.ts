/**
 * DOM end-to-end, not a rendering test. public/index.html runs in jsdom with public/app.js evaluated
 * unmodified; every request goes to the real createApp() in process (real git, ledger, ward, plan
 * verification). Only the model is scripted. No browser is launched, so layout, focus rings, colour
 * and motion are not checked here. Stubbed: fetch (in process), matchMedia, scrollIntoView.
 *
 * first-seance T4 — a smoke test of the shared harness (R11.1, R11.2).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { CryptClient, buildSamples, norm, openPage } from './harness.js';
import type { Page, Samples, SummonItem } from './harness.js';

let samples: Samples;
let page: Page;
let summoned: { items: SummonItem[] } | null = null;
let nodeFetch: unknown;

beforeAll(async () => {
  samples = buildSamples();
  page = await openPage({
    samples,
    client: new CryptClient(),
    onSummon: (d) => {
      summoned = d;
    },
  });
  nodeFetch = globalThis.fetch;
}, 60_000);

afterAll(() => {
  page?.close();
  if (samples) fs.rmSync(samples.root, { recursive: true, force: true });
});

describe('the shared harness', { timeout: 20_000 }, () => {
  it('opens the page with app.js running', () => {
    expect(page.$('summon-form').tagName).toBe('FORM');
    expect(page.input('repo').value).toBe('crypt');
    expect(page.$('seance').hidden).toBe(true);
  });

  it('summons crypt through the real server and shows its ledger rows', async () => {
    page.submit('summon-form');
    await page.until(() => !page.$('seance').hidden && summoned !== null, 'the séance');

    const summon = page.requests.find((r) => r.path === '/api/summon');
    expect(summon).toEqual({
      path: '/api/summon',
      method: 'POST',
      body: { repoUrl: 'crypt', file: 'legacy/tax.js', startLine: 7, endLine: 7 },
      status: 200,
    });

    // The rows are the commits that real git found in the built sample
    const shas = execFileSync(
      'git',
      ['log', '--format=%h', '--abbrev=7', '-L7,7:legacy/tax.js', '--no-patch'],
      { cwd: samples.crypt, encoding: 'utf8' },
    )
      .split('\n')
      .filter((s) => /^[0-9a-f]{7}$/.test(s));
    expect(shas.length).toBeGreaterThan(0);
    const rows = [...page.doc.querySelectorAll('#ledger > li')];
    expect(rows.map((li) => li.getAttribute('data-sha')).sort()).toEqual(
      [...shas].sort(),
    );
    expect(summoned!.items.map((i) => i.shortSha)).toEqual(
      rows.map((li) => li.getAttribute('data-sha')),
    );
    expect(norm(rows[0]!.querySelector('.subject')?.textContent)).toBe(
      summoned!.items[0]!.subject,
    );
  });

  it("never called Node's global fetch", () => {
    expect(nodeFetch).toBe(globalThis.fetch);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
