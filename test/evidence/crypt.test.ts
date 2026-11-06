/**
 * Real-git integration test: builds the sample crypt with scripts/make-crypt.sh and runs the whole ledger pipeline on it.
 * (Earlier unit tests mocked git, which hid two real-world bugs: `git log -L` rejects --follow, and blame dates need UTC ISO.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLedger } from '../../src/evidence/ledger.js';
import { verify } from '../../src/ghost/verifier.js';

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-crypt-'));
  execFileSync('bash', [path.resolve(__dirname, '../../scripts/make-crypt.sh'), dir], { stdio: 'ignore' });
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('ledger on the sample crypt (real git)', () => {
  it('finds the 2020 reason behind the 3 second wait, even though blame points at a later rename', async () => {
    const r = await buildLedger({ repoUrl: dir, file: 'legacy/tax.js', startLine: 7, endLine: 7 });
    const subjects = r.items.map((i) => i.subject);
    expect(subjects).toContain('hack: wait 3s before calling the tax vendor');
    expect(subjects).toContain('refactor: rename variables in tax.js');
    const hack = r.items.find((i) => i.subject.startsWith('hack:'))!;
    expect(hack.author).toBe('Dmitri Volkov');
    expect(hack.date.startsWith('2020-02-11')).toBe(true);
    expect(hack.refs).toContain('#7');
    expect(hack.body).toContain('429');
  });

  it('the verifier accepts a cited quote and rejects a fabricated memory against that ledger', async () => {
    const r = await buildLedger({ repoUrl: dir, file: 'legacy/tax.js', startLine: 7, endLine: 7 });
    const hack = r.items.find((i) => i.subject.startsWith('hack:'))!;
    const out = verify(r.items, {
      voice: 'test',
      claims: [
        { kind: 'memory', text: 'The vendor returns 429 on bursts.', citations: [{ sha7: hack.shortSha, quote: 'returns 429' }] },
        { kind: 'memory', text: 'I added it for Windows XP support.', citations: [{ sha7: 'deadbee' }] },
      ],
    } as never);
    expect(out.verified).toHaveLength(1);
    expect(out.rejected).toHaveLength(1);
    expect(out.score).toBeCloseTo(0.5);
  });
});
