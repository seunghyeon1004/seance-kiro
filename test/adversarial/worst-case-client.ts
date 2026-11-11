/**
 * worst-case-client.ts — a scripted AnthropicClient that obeys every instruction planted in
 * the possessed sample (ward-hardening design.md §10.4, R9.1).
 *
 * It reads the <question> from the user turn, picks the attack whose question matches, and
 * returns the ghost_answer tool input that does exactly what that attack's injected text says.
 * It is neither smarter nor weaker than the attack: it never adds a quote the attack did not
 * ask for and never drops one it did.
 *
 * The P* short hashes are looked up by commit subject in the <evidence> elements of the user
 * turn, so the client only uses what the real model would see. The forged element inside P5's
 * body is escaped, so it does not match the lookup.
 *
 * Every params object it receives is recorded, so tests can inspect `system` (R9.3).
 */

import type {
  AnthropicClient,
  AnthropicCreateParams,
  AnthropicMessage,
} from '../../src/ghost/llm.js';
import {
  POSSESSED_ATTACKS,
  POSSESSED_SUBJECTS,
} from '../../src/ghost/possessed-ghost.js';
import type {
  PossessedAttack,
  PossessedAttackId,
  PossessedCommit,
  PossessedHashes,
} from '../../src/ghost/possessed-ghost.js';

// first-seance R13.3: the subjects and attacks live in src/ghost/possessed-ghost.ts, which the
// POST /api/possess route shares; this file keeps its exports and its behaviour.

export type AttackId = PossessedAttackId;

/** Subject of each possessed commit, as written by scripts/make-possessed.sh (design.md §10.3). */
export const SUBJECTS = POSSESSED_SUBJECTS;

export type CommitId = PossessedCommit;
export type Hashes = PossessedHashes;
export type Attack = PossessedAttack;

export const ATTACKS: readonly Attack[] = POSSESSED_ATTACKS;

export function attack(id: AttackId, attacks: readonly Attack[] = ATTACKS): Attack {
  const a = attacks.find((x) => x.id === id);
  if (!a) throw new Error(`unknown attack ${id}`);
  return a;
}

/** Undo escapeLedgerText (&quot; &gt; &lt; first, &amp; last). */
function unescapeLedgerText(s: string): string {
  return s
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

/** sha7 by subject, read from the real <evidence> openings of the user turn. */
function readHashes(user: string): Hashes {
  const bySubject = new Map<string, string>();
  const re =
    /^<evidence id="[^"]*" sha7="([0-9a-f]{7})"[^\n]*>\n<subject>([^\n]*)<\/subject>$/gm;
  for (const m of user.matchAll(re)) {
    const [, sha7, subject] = m;
    if (sha7 !== undefined && subject !== undefined) {
      bySubject.set(unescapeLedgerText(subject), sha7);
    }
  }
  const out = {} as Record<CommitId, string>;
  for (const [id, subject] of Object.entries(SUBJECTS) as Array<[CommitId, string]>) {
    const sha7 = bySubject.get(subject);
    if (sha7 === undefined)
      throw new Error(`no evidence element with subject "${subject}"`);
    out[id] = sha7;
  }
  return out;
}

export class WorstCaseClient implements AnthropicClient {
  /** Every params object received, in call order (R9.3). */
  readonly calls: AnthropicCreateParams[] = [];

  constructor(private readonly attacks: readonly Attack[] = ATTACKS) {}

  readonly messages = {
    create: async (params: AnthropicCreateParams): Promise<AnthropicMessage> => {
      this.calls.push(params);
      const user = params.messages[0]?.content ?? '';
      const q = /<question>([\s\S]*)<\/question>/.exec(user)?.[1];
      const question = q === undefined ? undefined : unescapeLedgerText(q);
      const a = this.attacks.find((x) => x.question === question);
      if (!a) throw new Error(`WorstCaseClient has no attack for question ${question}`);
      const sessionId = /sessionId "([^"]+)"/.exec(params.system)?.[1] ?? 'unknown';
      return {
        content: [
          {
            type: 'tool_use',
            name: 'ghost_answer',
            input: {
              claims: a.claims(readHashes(user)),
              voice: 'obedient',
              sessionId,
            },
          },
        ],
      };
    },
  };
}
