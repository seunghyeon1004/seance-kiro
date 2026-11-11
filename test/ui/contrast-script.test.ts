/**
 * scripts/contrast.mjs (audit C18, C5): it reads the real :root values from tokens.css, fails when
 * the comment table and the tokens disagree, checks the pairs styles.css actually uses, and holds
 * non-text pairs to 3:1. The script runs as `npm run contrast` does, on the real tokens and on
 * altered copies written to a temp dir.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/contrast.mjs');
const TOKENS = fs.readFileSync(path.join(ROOT, 'public/tokens.css'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-contrast-'));

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(tokensCss?: string): { code: number; out: string } {
  const args = [SCRIPT];
  if (tokensCss !== undefined) {
    const p = path.join(tmp, `tokens-${Math.random().toString(36).slice(2)}.css`);
    fs.writeFileSync(p, tokensCss);
    args.push(p);
  }
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { code: r.status ?? -1, out: `${r.stdout}\n${r.stderr}` };
}

/** Replace the value of a token in the :root block only (the comment table is left alone). */
function setRootToken(css: string, name: string, value: string): string {
  const start = css.indexOf(':root {');
  const head = css.slice(0, start);
  const body = css.slice(start);
  const re = new RegExp(`(${name}:\\s*)[^;]+;`);
  expect(re.test(body), name).toBe(true);
  return head + body.replace(re, `$1${value};`);
}

describe('npm run contrast', () => {
  it('passes on the real tokens and checks rule-strong as a 3:1 non-text pair', () => {
    const { code, out } = run();
    expect(code, out).toBe(0);
    const line = out
      .split('\n')
      .find((l) => /--color-rule-strong\s+--color-paper\s/.test(l) && /non-text/.test(l));
    expect(line, out).toBeDefined();
    const ratio = Number(/([\d.]+):1/.exec(line!)?.[1]);
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(ratio).toBeLessThan(4.5); // passes only because non-text pairs need 3:1
  });

  it('checks usage pairs that are not in the table (color-mix backgrounds and the focus ring)', () => {
    const { out } = run();
    expect(out).toMatch(/--color-ink\s+\.err background/);
    expect(out).toMatch(/--color-muted\s+lit ledger row/);
    expect(out).toMatch(/--color-focus\s+--color-paper\s.*non-text/);
  });

  it('fails when a :root value no longer matches the comment table', () => {
    const { code, out } = run(
      setRootToken(TOKENS, '--color-muted', 'oklch(71% 0.02 80)'),
    );
    expect(code).toBe(1);
    expect(out).toMatch(/table.*--color-muted|--color-muted.*table/i);
  });

  it('fails when the table names a token that :root does not declare', () => {
    const { code, out } = run(
      TOKENS.replace('--color-ink-2 (oklch(82%', '--color-inky (oklch(82%'),
    );
    expect(code).toBe(1);
    expect(out).toMatch(/--color-inky/);
  });

  it('fails a non-text pair under 3:1, read from :root and not from the table', () => {
    const weak = 'oklch(33% 0.02 60)';
    const css = setRootToken(TOKENS, '--color-rule-strong', weak).replace(
      /(non-text: --color-rule-strong \(oklch\()[^)]+(\)\))/g,
      `$133% 0.02 60$2`,
    );
    const { code, out } = run(css);
    expect(code).toBe(1);
    expect(out).toMatch(/--color-rule-strong.*FAIL/);
  });

  it('fails a text pair under 4.5:1 that the table does not list', () => {
    // flame drives the accent-ink-on-flame hover pair, which only the usage list checks
    const { code, out } = run(
      setRootToken(TOKENS, '--color-flame', 'oklch(30% 0.15 80)'),
    );
    expect(code).toBe(1);
    expect(out).toMatch(/--color-accent-ink\s+--color-flame.*FAIL/);
  });
});
