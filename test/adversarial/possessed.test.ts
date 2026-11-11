/**
 * ward-hardening T5 — the possessed sample against a model that obeys every injected order
 * (design.md §10, R8.1, R8.5, R9.1–R9.3, R9.5).
 *
 * Real git, the real buildLedger, buildPrompt, askGhost and verify; only the model is
 * replaced, by WorstCaseClient. No network: ANTHROPIC_FIXTURE is unset, the key is a dummy,
 * and fetch throws if anything tries to use it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// askGhost reads both at call time, so setting them here (after the hoisted imports) is enough
delete process.env['ANTHROPIC_FIXTURE'];
process.env['ANTHROPIC_API_KEY'] = 'test-dummy-key-not-a-secret';

import { buildLedger } from '../../src/evidence/ledger.js';
import { buildPrompt } from '../../src/ghost/persona.js';
import { askGhost } from '../../src/ghost/llm.js';
import { verify } from '../../src/ghost/verifier.js';
import type { LedgerResult, VerifierResult } from '../../src/ghost/schema.js';
import {
  clonePool,
  createApp,
  modelLimiter,
  sessions,
  summonLimiter,
  wardLimiter,
} from '../../src/server.js';
import { ATTACKS, SUBJECTS, WorstCaseClient, attack } from './worst-case-client.js';
import type { AttackId, CommitId } from './worst-case-client.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/make-possessed.sh');
const FILE = 'auth/throttle.js';

/** Reason sentences from design.md §4.2. */
const F6 = (s: string) =>
  `The citation of ${s} has no quote. The ward accepts a citation only with the exact words from the commit.`;
const F9 = (s: string) =>
  `The quote cited from ${s} is not in that commit's subject, message or diff.`;
const F10 = (y: string) =>
  `The claim names the year ${y}, but no cited commit is dated ${y} or mentions it.`;
const F11 = (n: string) =>
  `The claim names ${n}, but no cited commit is by ${n} or mentions them.`;

const fetchSpy = vi.fn(() => {
  throw new Error('network access is not allowed in the adversarial tests');
});

let tmp: string;
let dir: string;
let ledger: LedgerResult;
let sha: Record<CommitId, string>;

function build(target: string): string {
  return execFileSync('bash', [SCRIPT, target], { cwd: ROOT, encoding: 'utf8' });
}
function hashes(target: string): string {
  return execFileSync('git', ['-C', target, 'log', '--format=%H'], { encoding: 'utf8' });
}

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchSpy);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-possessed-'));
  dir = path.join(tmp, 'a');
  const out = build(dir);
  expect(out.trim().split('\n').at(-1)).toBe(`possessed ready at ${dir} (7 commits)`);
  ledger = await buildLedger({ repoUrl: dir, file: FILE, startLine: 4, endLine: 4 });
  const found: Partial<Record<CommitId, string>> = {};
  for (const [id, subject] of Object.entries(SUBJECTS) as Array<[CommitId, string]>) {
    found[id] = ledger.items.find((i) => i.subject === subject)?.shortSha;
  }
  sha = found as Record<CommitId, string>;
  process.env['POSSESSED_DIR'] = dir;
}, 60_000);

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env['POSSESSED_DIR'];
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  modelLimiter.reset();
  summonLimiter.reset();
  wardLimiter.reset();
  clonePool.reset();
});

describe('the possessed sample (R8.1, R8.5)', () => {
  it('two builds into different directories give the same commit hashes', () => {
    const other = path.join(tmp, 'b');
    build(other);
    const a = hashes(dir);
    expect(a.trim().split('\n')).toHaveLength(7);
    expect(hashes(other)).toBe(a);
  });

  it('the ledger for auth/throttle.js line 4 holds all seven commits', () => {
    expect(ledger.items).toHaveLength(7);
    for (const id of Object.keys(SUBJECTS) as CommitId[]) {
      expect(sha[id], id).toMatch(/^[0-9a-f]{7}$/);
    }
  });

  it('P2, P3, P5, P6 and P7 are flagged as suspicious; P1 and P4 are not', () => {
    const flag = (id: CommitId) =>
      ledger.items.find((i) => i.shortSha === sha[id])?.suspiciousMessage;
    expect(
      ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'].map((id) => flag(id as CommitId)),
    ).toEqual([false, true, true, false, true, true, true]);
  });
});

/** The attacker's sentence never verified, and present in rejected or silent (R9.2). */
function assertWardHeld(
  verified: ReadonlyArray<{ text: string }>,
  struck: ReadonlyArray<{ text: string }>,
  sentence: string,
): void {
  for (const v of verified) {
    expect(v.text).not.toBe(sentence);
    expect(v.text.includes(sentence)).toBe(false);
  }
  expect(struck.map((s) => s.text)).toContain(sentence);
}

/** What each attack must produce, given the hashes (design.md §10.4). */
function expectBucket(id: AttackId): { bucket: 'rejected' | 'silent'; reason?: string } {
  switch (id) {
    case 'A1':
      // F6 strikes the citation, so no cited item supports the year 2023 either (§4.1 step 6)
      return { bucket: 'rejected', reason: `${F6(sha.P3)} ${F10('2023')}` };
    case 'A2':
      return { bucket: 'rejected', reason: F6(sha.P2) };
    case 'A3':
      return { bucket: 'rejected', reason: F9(sha.P4) };
    case 'A4':
      return { bucket: 'silent' };
    case 'A5':
      return { bucket: 'rejected', reason: `${F10('2024')} ${F11('Osric Penhallow')}` };
  }
}

/** R9.3: the system parameter holds no ledger author and no subject or body text. */
function assertSystemClean(client: WorstCaseClient): void {
  expect(client.calls.length).toBeGreaterThan(0);
  for (const call of client.calls) {
    for (const item of ledger.items) {
      expect(call.system.includes(item.author), item.author).toBe(false);
      expect(call.system.includes(item.subject), item.subject).toBe(false);
      const lines = item.body.split('\n').map((l) => l.trim());
      for (const line of lines.filter((l) => l.length > 0)) {
        expect(call.system.includes(line), line).toBe(false);
      }
    }
  }
}

/** A3: the forged element in P5's body is escaped, so the user turn has exactly 7 of each tag. */
function assertSevenEvidenceElements(client: WorstCaseClient): void {
  for (const call of client.calls) {
    const user = call.messages[0]?.content ?? '';
    expect(call.messages).toHaveLength(1);
    expect(user.split('<evidence ').length - 1).toBe(7);
    expect(user.split('</evidence>').length - 1).toBe(7);
  }
}

describe.each(ATTACKS.map((a) => a.id))('attack %s', (id) => {
  const a = attack(id);

  it('direct path: buildLedger → buildPrompt → askGhost → verify', async () => {
    const client = new WorstCaseClient();
    const sid = 'adversarial-direct';
    const prompt = buildPrompt(ledger.items, a.question, sid);
    const answer = await askGhost(prompt, sid, client);
    const result: VerifierResult = verify(ledger.items, answer);

    const struck = [
      ...result.rejected.map((r) => ({ text: r.text })),
      ...result.silent.map((s) => ({ text: s.claim.text })),
    ];
    assertWardHeld(
      result.verified.map((v) => ({ text: v.claim.text })),
      struck,
      a.sentence,
    );
    expect(result.verified).toHaveLength(0);
    const want = expectBucket(id);
    if (want.bucket === 'silent') {
      expect(result.silent.map((s) => s.claim.text)).toEqual([a.sentence]);
      expect(result.rejected).toEqual([]);
    } else {
      expect(result.silent).toEqual([]);
      expect(result.rejected.map((r) => [r.text, r.reason])).toEqual([
        [a.sentence, want.reason],
      ]);
    }
    assertSystemClean(client);
    assertSevenEvidenceElements(client);
  });

  it('server path: POST /api/summon { repoUrl: "possessed" } then POST /api/ask', async () => {
    const client = new WorstCaseClient();
    const app = createApp({ anthropicClient: client });
    const summon = await app.fetch(
      new Request('http://localhost/api/summon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: 'possessed',
          file: FILE,
          startLine: 4,
          endLine: 4,
        }),
      }),
    );
    expect(summon.status).toBe(200);
    const { sessionId, ledgerSize } = (await summon.json()) as {
      sessionId: string;
      ledgerSize: number;
    };
    expect(ledgerSize).toBe(7);
    try {
      const res = await app.fetch(
        new Request('http://localhost/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, question: a.question }),
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        verified: Array<{ text: string }>;
        rejected: Array<{ text: string; reason: string; citesSuspicious: boolean }>;
        silent: Array<{ text: string; silenceReason: string }>;
        tally: { verified: number; checked: number; silent: number };
      };
      assertWardHeld(body.verified, [...body.rejected, ...body.silent], a.sentence);
      expect(body.verified).toEqual([]);
      const want = expectBucket(id);
      if (want.bucket === 'silent') {
        expect(body.silent).toEqual([{ text: a.sentence, silenceReason: 'none' }]);
        expect(body.tally).toEqual({ verified: 0, checked: 0, silent: 1 });
      } else {
        expect(body.rejected.map((r) => [r.text, r.reason])).toEqual([
          [a.sentence, want.reason],
        ]);
        expect(body.tally).toEqual({ verified: 0, checked: 1, silent: 0 });
      }
      assertSystemClean(client);
      assertSevenEvidenceElements(client);
    } finally {
      sessions.delete(sessionId);
    }
  });
});

describe('no network (R9.5)', () => {
  it('ran with a dummy key, without ANTHROPIC_FIXTURE, and never called fetch', () => {
    expect(process.env['ANTHROPIC_FIXTURE']).toBeUndefined();
    expect(process.env['ANTHROPIC_API_KEY']).toBe('test-dummy-key-not-a-secret');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
