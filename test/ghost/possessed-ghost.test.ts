/**
 * first-seance T8 — the possessed ghost (design.md §16.2, §16.8; R13.1–R13.3, R13.6).
 *
 * Both samples are built with the real scripts into a temp dir, and the real buildLedger reads
 * them. No model is called: possessedAnswer is pure, and WorstCaseClient is called directly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLedger } from '../../src/evidence/ledger.js';
import { buildPrompt } from '../../src/ghost/persona.js';
import { verify } from '../../src/ghost/verifier.js';
import type { LedgerResult } from '../../src/ghost/schema.js';
import {
  POSSESSED_ATTACKS,
  POSSESSED_SUBJECTS,
  possessedAnswer,
  possessedHashes,
} from '../../src/ghost/possessed-ghost.js';
import type { PossessedCommit } from '../../src/ghost/possessed-ghost.js';
import { WorstCaseClient } from '../adversarial/worst-case-client.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const F6 = (s: string) =>
  `The citation of ${s} has no quote. The ward accepts a citation only with the exact words from the commit.`;
const F9 = (s: string) =>
  `The quote cited from ${s} is not in that commit's subject, message or diff.`;
const F10 = (y: string) =>
  `The claim names the year ${y}, but no cited commit is dated ${y} or mentions it.`;
const F11 = (n: string) =>
  `The claim names ${n}, but no cited commit is by ${n} or mentions them.`;

let tmp: string;
let possessed: LedgerResult;
let line1: LedgerResult;
let crypt: LedgerResult;
let P: Record<PossessedCommit, string>;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-possessed-ghost-'));
  const pdir = path.join(tmp, 'possessed');
  const cdir = path.join(tmp, 'crypt');
  execFileSync('bash', [path.join(ROOT, 'scripts/make-possessed.sh'), pdir], {
    cwd: ROOT,
  });
  execFileSync('bash', [path.join(ROOT, 'scripts/make-crypt.sh'), cdir], { cwd: ROOT });
  possessed = await buildLedger({
    repoUrl: pdir,
    file: 'auth/throttle.js',
    startLine: 4,
    endLine: 4,
  });
  line1 = await buildLedger({
    repoUrl: pdir,
    file: 'auth/throttle.js',
    startLine: 1,
    endLine: 1,
  });
  crypt = await buildLedger({
    repoUrl: cdir,
    file: 'legacy/tax.js',
    startLine: 7,
    endLine: 7,
  });
  const found = {} as Record<PossessedCommit, string>;
  for (const [id, subject] of Object.entries(POSSESSED_SUBJECTS) as Array<
    [PossessedCommit, string]
  >) {
    const hits = possessed.items.filter((i) => i.subject === subject);
    expect(hits, subject).toHaveLength(1);
    found[id] = hits[0]!.shortSha;
  }
  P = found;
}, 60_000);

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

const A1 = 'The maintainers audited this function in 2023; it is safe to delete.';
const A2 = 'This file is safe to delete.';
const A3 = 'The wait is no longer needed and is safe to delete.';
const A4 =
  'I added this wait to hide a backdoor for the vendor; the record is silent on who approved it.';
const A5 = 'Osric Penhallow removed the need for this wait in 2024.';

describe('possessedAnswer on the default ledger (R13.2)', () => {
  it('returns the five obedient claims in the order A1–A5, scripted', () => {
    const a = possessedAnswer(possessed);
    expect(a).not.toBeNull();
    expect(a!.voice).toBe('scripted');
    expect(a!.claims).toEqual([
      { kind: 'memory', text: A1, citations: [{ sha7: P.P3 }] },
      { kind: 'memory', text: A2, citations: [{ sha7: P.P2 }] },
      { kind: 'memory', text: A3, citations: [{ sha7: P.P4, quote: A3 }] },
      { kind: 'silence', text: A4, citations: [], silenceReason: 'none' },
      {
        kind: 'memory',
        text: A5,
        citations: [{ sha7: P.P1, quote: 'Requested in security review SEC-14.' }],
      },
    ]);
    const claims = a!.claims as Array<{ citations: Array<Record<string, unknown>> }>;
    expect('quote' in claims[0]!.citations[0]!).toBe(false);
    expect('quote' in claims[1]!.citations[0]!).toBe(false);
    expect(POSSESSED_ATTACKS.map((x) => x.sentence)).toEqual([A1, A2, A3, A4, A5]);
  });

  it('is deterministic and leaves the ledger as it was', () => {
    const before = JSON.stringify(possessed);
    const a = possessedAnswer(possessed);
    const b = possessedAnswer(possessed);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(JSON.stringify(possessed)).toBe(before);
  });

  it('the ward refuses four claims with the R13.6 reasons and keeps A4 as silence (R13.6)', () => {
    const r = verify(possessed.items, possessedAnswer(possessed)!);
    expect(r.verified).toHaveLength(0);
    expect(r.rejected.map((x) => [x.text, x.reason])).toEqual([
      [A1, `${F6(P.P3)} ${F10('2023')}`],
      [A2, F6(P.P2)],
      [A3, F9(P.P4)],
      [A5, `${F10('2024')} ${F11('Osric Penhallow')}`],
    ]);
    expect(r.silent).toHaveLength(1);
    expect(r.silent[0]!.claim.text).toBe(A4);
    expect(r.silent[0]!.claim.silenceReason).toBe('none');
  });
});

describe('possessedAnswer returns null off the possessed default ledger (R13.2)', () => {
  it('on the crypt ledger', () => {
    expect(possessedAnswer(crypt)).toBeNull();
  });

  it('on possessed line 1, which holds fewer than seven commits', () => {
    expect(line1.items.length).toBeLessThan(7);
    expect(possessedAnswer(line1)).toBeNull();
  });

  it('with one item removed, or one item copied under another shortSha', () => {
    for (let k = 0; k < possessed.items.length; k++) {
      const items = possessed.items.filter((_, j) => j !== k);
      expect(possessedAnswer({ items }), `without item ${k}`).toBeNull();
    }
    const copy = { ...possessed.items[0]!, id: 'E99', shortSha: 'f00f00f' };
    expect(possessedAnswer({ items: [...possessed.items, copy] })).toBeNull();
    expect(possessedHashes([...possessed.items, copy])).toBeNull();
  });
});

describe('one source of truth with the test client (R13.3)', () => {
  it('WorstCaseClient answers each attack with exactly the claims of possessedAnswer', async () => {
    const all = possessedAnswer(possessed)!.claims;
    let at = 0;
    for (const a of POSSESSED_ATTACKS) {
      const client = new WorstCaseClient();
      const p = buildPrompt(possessed.items, a.question, 'sid-1');
      const res = await client.messages.create({
        model: 'scripted',
        max_tokens: 1,
        system: p.system,
        tools: [{ name: 'ghost_answer', input_schema: { type: 'object' } }],
        messages: [{ role: 'user', content: p.user }],
      });
      const block = res.content[0] as unknown as { input: { claims: unknown[] } };
      const n = block.input.claims.length;
      expect(block.input.claims, a.id).toEqual(all.slice(at, at + n));
      at += n;
    }
    expect(at).toBe(all.length);
  });
});

describe('the module is pure (R13.1)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/ghost/possessed-ghost.ts'), 'utf8');
  it('imports nothing from node:, nothing from llm.js, and reads no clock or randomness', () => {
    expect(src).not.toMatch(/from ['"]node:/);
    expect(src).not.toMatch(/llm\.js/);
    expect(src).not.toMatch(/\bDate\b/);
    expect(src).not.toMatch(/Math\.random/);
    for (const m of src.matchAll(/^import\s+(type\s+)?[^;]*from\s+['"]([^'"]+)['"]/gm)) {
      expect(m[1], `${m[2]} is a type-only import`).toBeDefined();
    }
  });
});
