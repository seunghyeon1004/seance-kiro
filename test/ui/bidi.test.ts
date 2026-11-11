/**
 * ward-hardening R11.8 (inquisitor review, suspected bidi finding) — static CSS test.
 *
 * Every container of untrusted text on the page takes `unicode-bidi: plaintext`, so an
 * embedding or override control inside a claim, quote, ledger row, source line, map tile or
 * question line is confined to that element and cannot reorder the fixed labels around it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../public/styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Selectors of every rule whose declarations include `unicode-bidi: plaintext`. */
function plaintextSelectors(): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|;)\s*unicode-bidi\s*:\s*plaintext\s*(;|$)/.test(m[2] ?? '')) continue;
    for (const s of (m[1] ?? '').split(',')) out.add(s.trim().replace(/\s+/g, ' '));
  }
  return out;
}

describe('untrusted text containers isolate bidi controls (R11.8)', () => {
  const required = [
    '.claim .txt', // claim text
    '.claim .why', // refusal reasons and unanswered questions
    '.found-quote', // the words the ward found
    '.ledger li', // ledger rows
    '.ledger .who', // author name
    '.ledger .subject', // commit subject
    '.ledger pre', // message and diff
    '.source-lines li', // source lines
    '.map-tile', // map tiles
    '.map-path', // the path in a tile
    '.turn-q', // question lines
  ];
  it.each(required)('%s has unicode-bidi: plaintext', (sel) => {
    expect(plaintextSelectors().has(sel)).toBe(true);
  });
});
