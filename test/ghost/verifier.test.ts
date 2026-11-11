/**
 * Unit tests for src/ghost/verifier.ts
 *
 * ghost-verifier T2 tests, updated for ward-hardening T1 (design.md §4, §13.2):
 * quotes are mandatory, checked one field at a time, silence goes to `silent`,
 * and every rejection reason is a fixed sentence from design.md §4.2.
 */

import { describe, it, expect } from 'vitest';
import { verify } from '../../src/ghost/verifier.js';
import { HUNK_UI_CHARS } from '../../src/ghost/schema.js';
import type { EvidenceItem, GhostAnswer } from '../../src/ghost/schema.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHA_40 = 'abc1234' + '0'.repeat(33);
const SHA_40_B = 'def5678' + '0'.repeat(33);

function makeItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return Object.freeze({
    id: 'E1',
    sha: SHA_40,
    shortSha: 'abc1234',
    author: 'Ada Lovelace',
    email: 'ada@example.com',
    date: new Date('2020-01-01T00:00:00.000Z').toISOString(),
    subject: 'fix: add sleep for downstream service',
    body: 'wait for downstream to stabilise',
    hunk: '@@ -1,5 +1,6 @@\n+sleep(3000);\n',
    files: ['src/utils.ts'],
    refs: [],
    suspiciousMessage: false,
    ...overrides,
  });
}

function makeAnswer(claims: GhostAnswer['claims'], sessionId = 'sess-1'): GhostAnswer {
  return {
    claims,
    voice: 'Ada Lovelace, terse',
    sessionId,
  };
}

/** Answer built from raw values that never went through Zod. */
function rawAnswer(claims: unknown[]): { claims: unknown[] } {
  return { claims };
}

const QUOTE = 'wait for downstream to stabilise';

function memory(
  text: string,
  sha7 = 'abc1234',
  quote = QUOTE,
): GhostAnswer['claims'][number] {
  return { kind: 'memory', text, citations: [{ sha7, quote }] };
}

// ---------------------------------------------------------------------------
// Memory claims — passing and basic failing cases
// ---------------------------------------------------------------------------

describe('verify — memory claims', () => {
  it('passes when SHA and quote are both present in ledger', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([memory('I added the sleep.')]);

    const result = verify(ledger, answer);

    expect(result.verified).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.silent).toHaveLength(0);
    expect(result.score).toBe(1);
    expect(result.verified[0]?.speculative).toBe(false);
    expect(result.verified[0]?.index).toBe(0);
    expect(result.verified[0]?.quotes).toEqual([
      { sha7: 'abc1234', quote: QUOTE, field: 'body' },
    ]);
  });

  it('rejected when SHA is absent from ledger (F4)', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([memory('Some claim', 'fff0000')]);

    const result = verify(ledger, answer);

    expect(result.verified).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe('Commit fff0000 is not in the ledger.');
  });

  it('rejected when quote is not a substring of evidence text (F9)', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      memory('Some claim', 'abc1234', 'this text does not appear in evidence'),
    ]);

    const result = verify(ledger, answer);

    expect(result.verified).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe(
      "The quote cited from abc1234 is not in that commit's subject, message or diff.",
    );
  });

  it('quote check is case-sensitive', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      memory('Some claim', 'abc1234', 'Wait For Downstream To Stabilise'),
    ]);

    const result = verify(ledger, answer);

    expect(result.rejected).toHaveLength(1);
  });

  it('a quote found in the hunk is verified with field "hunk"', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      memory('The hunk shows addition', 'abc1234', '+sleep(3000);'),
    ]);

    const result = verify(ledger, answer);
    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]?.quotes[0]?.field).toBe('hunk');
  });

  it('a quote found in the subject is verified with field "subject"', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      memory('The subject says so', 'abc1234', 'add sleep for'),
    ]);

    const result = verify(ledger, answer);
    expect(result.verified[0]?.quotes[0]?.field).toBe('subject');
  });

  it('when the quote is in several fields, the first of subject, body, hunk is reported', () => {
    const ledger = [makeItem({ subject: 'downstream fix', body: 'the downstream fix' })];
    const answer = makeAnswer([memory('Claim', 'abc1234', 'downstream fix')]);

    const result = verify(ledger, answer);
    expect(result.verified[0]?.quotes[0]?.field).toBe('subject');
  });

  it('one quote per citation, in citation order', () => {
    const ledger = [
      makeItem(),
      makeItem({
        id: 'E2',
        sha: SHA_40_B,
        shortSha: 'def5678',
        subject: 'second commit here',
      }),
    ];
    const answer = makeAnswer([
      {
        kind: 'memory',
        text: 'Two commits',
        citations: [
          { sha7: 'def5678', quote: 'second commit' },
          { sha7: 'abc1234', quote: '+sleep(3000);' },
        ],
      },
    ]);

    const result = verify(ledger, answer);
    expect(result.verified[0]?.quotes).toEqual([
      { sha7: 'def5678', quote: 'second commit', field: 'subject' },
      { sha7: 'abc1234', quote: '+sleep(3000);', field: 'hunk' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Speculation claims
// ---------------------------------------------------------------------------

describe('verify — speculation claims', () => {
  it('passes with valid citation and flags speculative=true', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      {
        kind: 'speculation',
        text: 'This might be related to a race condition.',
        citations: [{ sha7: 'abc1234', quote: QUOTE }],
      },
    ]);

    const result = verify(ledger, answer);

    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]?.speculative).toBe(true);
  });

  it('rejected when SHA not in ledger', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      {
        kind: 'speculation',
        text: 'Some speculation',
        citations: [{ sha7: '0000000', quote: QUOTE }],
      },
    ]);

    const result = verify(ledger, answer);

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe('Commit 0000000 is not in the ledger.');
  });
});

// ---------------------------------------------------------------------------
// R1.3 / R1.4 — quotes are mandatory and bounded
// ---------------------------------------------------------------------------

describe('verify — mandatory quotes (R1.3, R1.4)', () => {
  it('a cast citation without a quote is rejected with F6', () => {
    const ledger = [makeItem()];
    const result = verify(
      ledger,
      rawAnswer([
        { kind: 'memory', text: 'I added the sleep.', citations: [{ sha7: 'abc1234' }] },
      ]),
    );

    expect(result.verified).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe(
      'The citation of abc1234 has no quote. The ward accepts a citation only with the exact words from the commit.',
    );
  });

  it('a citation whose quote is explicitly undefined is rejected with F6', () => {
    const ledger = [makeItem()];
    const claim = {
      kind: 'speculation',
      text: 'Maybe.',
      citations: [{ sha7: 'abc1234', quote: undefined }],
    } as unknown as GhostAnswer['claims'][number];
    const result = verify(ledger, makeAnswer([claim]));

    expect(result.verified).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain('abc1234 has no quote');
  });

  it('a quote of 7 characters after trim() is rejected with F7', () => {
    const ledger = [makeItem()];
    const result = verify(
      ledger,
      rawAnswer([
        {
          kind: 'memory',
          text: 'Short',
          citations: [{ sha7: 'abc1234', quote: '  wait fo  ' }],
        },
      ]),
    );

    expect(result.verified).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe(
      'The quote cited from abc1234 is too short. A quote needs at least 8 characters.',
    );
  });

  it('a quote of exactly 8 characters that is in the commit is verified', () => {
    const ledger = [makeItem()];
    const result = verify(ledger, makeAnswer([memory('Eight', 'abc1234', 'wait for')]));
    expect(result.verified).toHaveLength(1);
  });

  it('a 501-character quote is rejected with F8', () => {
    const long = 'x'.repeat(501);
    const ledger = [makeItem({ body: long })];
    const result = verify(
      ledger,
      rawAnswer([
        { kind: 'memory', text: 'Long', citations: [{ sha7: 'abc1234', quote: long }] },
      ]),
    );

    expect(result.verified).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe(
      'The quote cited from abc1234 is too long. A quote may have at most 500 characters.',
    );
  });

  it('a 500-character quote that is in the commit is verified', () => {
    const q = 'y'.repeat(500);
    const ledger = [makeItem({ body: q })];
    const result = verify(ledger, makeAnswer([memory('Long', 'abc1234', q)]));
    expect(result.verified).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// R1.5 / R1.6 — one field at a time, hunk as the browser sees it
// ---------------------------------------------------------------------------

describe('verify — one field at a time (R1.5, R1.6)', () => {
  it('HUNK_UI_CHARS is 4000', () => {
    expect(HUNK_UI_CHARS).toBe(4000);
  });

  it('a quote that only exists across the subject/body join is rejected with F9', () => {
    const ledger = [makeItem()];
    // subject ends "service", body starts "wait": the old joined text had "service wait for"
    const result = verify(
      ledger,
      makeAnswer([memory('Joined', 'abc1234', 'service wait for')]),
    );

    expect(result.verified).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe(
      "The quote cited from abc1234 is not in that commit's subject, message or diff.",
    );
  });

  it('a quote that only exists across the body/hunk join is rejected with F9', () => {
    const ledger = [makeItem()];
    const result = verify(
      ledger,
      makeAnswer([memory('Joined', 'abc1234', 'stabilise @@ -1')]),
    );
    expect(result.verified).toHaveLength(0);
  });

  it('a quote that only exists past HUNK_UI_CHARS in the hunk is rejected with F9', () => {
    const ledger = [makeItem({ hunk: 'a'.repeat(4000) + 'HIDDEN-FROM-THE-READER' })];
    const result = verify(
      ledger,
      makeAnswer([memory('Hidden', 'abc1234', 'HIDDEN-FROM-THE-READER')]),
    );
    expect(result.verified).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain('abc1234');
  });

  it('a quote that straddles the HUNK_UI_CHARS boundary is rejected', () => {
    const ledger = [makeItem({ hunk: 'a'.repeat(3995) + 'BCDEFGHIJK' })];
    const result = verify(ledger, makeAnswer([memory('Edge', 'abc1234', 'BCDEFGHIJK')]));
    expect(result.verified).toHaveLength(0);
  });

  it('a quote that ends exactly at HUNK_UI_CHARS is verified in the hunk', () => {
    const ledger = [makeItem({ hunk: 'a'.repeat(3990) + 'BCDEFGHIJK' + 'tail' })];
    const result = verify(ledger, makeAnswer([memory('Edge', 'abc1234', 'BCDEFGHIJK')]));
    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]?.quotes[0]?.field).toBe('hunk');
  });
});

// ---------------------------------------------------------------------------
// R1.7 — ambiguous short hashes
// ---------------------------------------------------------------------------

describe('verify — ambiguous short hash (R1.7)', () => {
  it('two items sharing a shortSha make a citation of it fail with F5', () => {
    const ledger = [makeItem(), makeItem({ id: 'E2', sha: 'abc1234' + 'f'.repeat(33) })];
    const result = verify(ledger, makeAnswer([memory('Which one?')]));

    expect(result.verified).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe(
      'Commit abc1234 is ambiguous: 2 commits in the ledger share that short hash.',
    );
  });
});

// ---------------------------------------------------------------------------
// R1.8 — per-claim checking, F1, F2, F3
// ---------------------------------------------------------------------------

describe('verify — per-claim format checks (R1.8)', () => {
  it('one malformed claim is rejected with F1 while the others are still checked', () => {
    const ledger = [makeItem()];
    const result = verify(
      ledger,
      rawAnswer([
        memory('Good one'),
        { kind: 'memory', text: 42, citations: [] },
        memory('Bad sha', 'fff0000'),
      ]),
    );

    expect(result.verified.map((v) => v.index)).toEqual([0]);
    expect(result.rejected.map((r) => r.index)).toEqual([1, 2]);
    expect(result.rejected[0]?.reason).toBe(
      "Claim 2 is not in the ward's format (text).",
    );
    expect(result.rejected[0]?.claim).toBeNull();
    expect(result.rejected[0]?.text).toBe('');
    expect(result.rejected[0]?.kind).toBe('memory');
    expect(result.rejected[1]?.reason).toBe('Commit fff0000 is not in the ledger.');
  });

  it('a claim that is not an object gets F1 with the path "claim"', () => {
    const result = verify([makeItem()], rawAnswer([null]));
    expect(result.rejected[0]?.reason).toBe(
      "Claim 1 is not in the ward's format (claim).",
    );
    expect(result.rejected[0]?.kind).toBe('unknown');
    expect(result.rejected[0]?.text).toBe('');
    expect(result.rejected[0]?.citedSha7s).toEqual([]);
  });

  it('an unknown kind gets F1 and keeps the raw kind and text', () => {
    const result = verify(
      [makeItem()],
      rawAnswer([{ kind: 'rumour', text: 'hearsay', citations: [{ sha7: 'abc1234' }] }]),
    );
    expect(result.rejected[0]?.reason).toBe(
      "Claim 1 is not in the ward's format (kind).",
    );
    expect(result.rejected[0]?.kind).toBe('rumour');
    expect(result.rejected[0]?.text).toBe('hearsay');
    expect(result.rejected[0]?.citedSha7s).toEqual(['abc1234']);
  });

  it('a raw kind longer than 32 characters is reported as "unknown"', () => {
    const result = verify(
      [makeItem()],
      rawAnswer([{ kind: 'k'.repeat(33), text: 't', citations: [] }]),
    );
    expect(result.rejected[0]?.kind).toBe('unknown');
  });

  it('a claim that passes every check but not the strict schema gets F1 from the guard', () => {
    // A cast ledger whose shortSha is uppercase: the lookup finds it, the strict Sha7Schema does not.
    const ledger = [makeItem({ shortSha: 'ABC1234' })];
    const result = verify(ledger, rawAnswer([memory('Guarded', 'ABC1234')]));
    expect(result.verified).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe(
      "Claim 1 is not in the ward's format (citations.0.sha7).",
    );
  });

  it('a memory claim with no citations gets F2', () => {
    const result = verify(
      [makeItem()],
      rawAnswer([{ kind: 'memory', text: 'Uncited', citations: [] }]),
    );
    expect(result.rejected[0]?.reason).toBe(
      'A memory claim needs at least one citation.',
    );
  });

  it('a speculation claim with no citations gets F2', () => {
    const result = verify(
      [makeItem()],
      rawAnswer([{ kind: 'speculation', text: 'Uncited', citations: [] }]),
    );
    expect(result.rejected[0]?.reason).toBe(
      'A speculation claim needs at least one citation.',
    );
  });

  it('11 citations give F3', () => {
    const citations = Array.from({ length: 11 }, () => ({
      sha7: 'abc1234',
      quote: QUOTE,
    }));
    const result = verify(
      [makeItem()],
      rawAnswer([{ kind: 'memory', text: 'Many', citations }]),
    );
    expect(result.verified).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe('A claim may cite at most 10 commits.');
  });

  it('10 valid citations are verified', () => {
    const citations = Array.from({ length: 10 }, () => ({
      sha7: 'abc1234',
      quote: QUOTE,
    }));
    const result = verify(
      [makeItem()],
      rawAnswer([{ kind: 'memory', text: 'Many', citations }]),
    );
    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]?.quotes).toHaveLength(10);
  });

  it('collects every reason of a claim, joined by a space', () => {
    const result = verify(
      [makeItem()],
      rawAnswer([
        {
          kind: 'memory',
          text: 'Two problems',
          citations: [{ sha7: 'fff0000', quote: QUOTE }, { sha7: 'abc1234' }],
        },
      ]),
    );
    expect(result.rejected[0]?.reason).toBe(
      'Commit fff0000 is not in the ledger. The citation of abc1234 has no quote. The ward accepts a citation only with the exact words from the commit.',
    );
    expect(result.rejected[0]?.citedSha7s).toEqual(['fff0000', 'abc1234']);
  });
});

// ---------------------------------------------------------------------------
// R3.1 — year
// ---------------------------------------------------------------------------

describe('verify — year (R3.1, R3.3)', () => {
  it('a year no cited item is dated or mentions gets F10', () => {
    const result = verify(
      [makeItem()],
      makeAnswer([memory('I added the sleep in 2019.')]),
    );
    expect(result.verified).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe(
      'The claim names the year 2019, but no cited commit is dated 2019 or mentions it.',
    );
  });

  it('the year of the cited item date is accepted', () => {
    const result = verify(
      [makeItem()],
      makeAnswer([memory('I added the sleep in 2020.')]),
    );
    expect(result.verified).toHaveLength(1);
  });

  it('a year mentioned in a cited field is accepted', () => {
    const ledger = [
      makeItem({ body: 'wait for downstream to stabilise, broken since 2017' }),
    ];
    const result = verify(ledger, makeAnswer([memory('It was broken since 2017.')]));
    expect(result.verified).toHaveLength(1);
  });

  it('"2019a" contains the year 2019', () => {
    const result = verify(
      [makeItem()],
      makeAnswer([memory('Ticket 2019a was the cause.')]),
    );
    expect(result.rejected[0]?.reason).toContain('the year 2019');
  });

  it('"12019" and "20190" contain no year', () => {
    const result = verify(
      [makeItem()],
      makeAnswer([memory('Ticket 12019 was the cause.'), memory('Port 20190 was busy.')]),
    );
    expect(result.verified).toHaveLength(2);
  });

  it('numbers outside 1970–2099 are not years', () => {
    const result = verify(
      [makeItem()],
      makeAnswer([memory('Values 1969 and 2100 and 3000 appear.')]),
    );
    expect(result.verified).toHaveLength(1);
  });

  it('each distinct unsupported year is named once, in order of first appearance', () => {
    const result = verify(
      [makeItem()],
      makeAnswer([memory('From 2018 to 2019, and again in 2018.')]),
    );
    expect(result.rejected[0]?.reason).toBe(
      'The claim names the year 2018, but no cited commit is dated 2018 or mentions it. ' +
        'The claim names the year 2019, but no cited commit is dated 2019 or mentions it.',
    );
  });

  it('a year supported only by an uncited item is still rejected', () => {
    const ledger = [
      makeItem(),
      makeItem({
        id: 'E2',
        sha: SHA_40_B,
        shortSha: 'def5678',
        date: '2019-05-05T00:00:00.000Z',
      }),
    ];
    const result = verify(ledger, makeAnswer([memory('I added the sleep in 2019.')]));
    expect(result.rejected[0]?.reason).toContain('the year 2019');
  });
});

// ---------------------------------------------------------------------------
// R3.2 — ledger authors
// ---------------------------------------------------------------------------

describe('verify — ledger authors (R3.2, R3.3)', () => {
  const grace = makeItem({
    id: 'E2',
    sha: SHA_40_B,
    shortSha: 'def5678',
    author: 'Grace Hopper',
    subject: 'feat: second commit here',
  });

  it('a ledger author who wrote no cited item and is not named in one gets F11', () => {
    const result = verify(
      [makeItem(), grace],
      makeAnswer([memory('Grace Hopper added the sleep.')]),
    );
    expect(result.verified).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe(
      'The claim names Grace Hopper, but no cited commit is by Grace Hopper or mentions them.',
    );
  });

  it('the author of a cited item is accepted', () => {
    const result = verify(
      [makeItem(), grace],
      makeAnswer([
        memory('Grace Hopper wrote the second commit.', 'def5678', 'second commit'),
      ]),
    );
    expect(result.verified).toHaveLength(1);
  });

  it('a ledger author named in a cited item field is accepted', () => {
    const ledger = [
      makeItem({ body: 'wait for downstream to stabilise, as Grace Hopper asked' }),
      grace,
    ];
    const result = verify(
      ledger,
      makeAnswer([memory('Grace Hopper asked for the sleep.')]),
    );
    expect(result.verified).toHaveLength(1);
  });

  it('a name that is not a ledger author is not checked (Charles Babbage)', () => {
    // R3.4: names outside the ledger cannot be checked; the claim still needs its quote.
    const ledger = [makeItem({ author: 'Ada Lovelace' })];
    const answer = makeAnswer([
      memory('Charles Babbage wrote this sleep (wrong author in text)'),
    ]);

    const result = verify(ledger, answer);

    expect(result.verified).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('a name inside a longer ledger author name is not counted separately', () => {
    const ada = makeItem({ id: 'E2', sha: SHA_40_B, shortSha: 'def5678', author: 'Ada' });
    const result = verify(
      [makeItem({ author: 'Ada Lovelace' }), ada],
      makeAnswer([memory('Ada Lovelace added the sleep.')]),
    );
    expect(result.verified).toHaveLength(1);
  });

  it('the shorter name is still checked where it stands alone', () => {
    const ada = makeItem({ id: 'E2', sha: SHA_40_B, shortSha: 'def5678', author: 'Ada' });
    const result = verify(
      [makeItem({ author: 'Ada Lovelace' }), ada],
      makeAnswer([memory('Ada Lovelace and Ada added the sleep.')]),
    );
    expect(result.rejected[0]?.reason).toBe(
      'The claim names Ada, but no cited commit is by Ada or mentions them.',
    );
  });

  it('a name only counts as a whole word', () => {
    const ann = makeItem({ id: 'E2', sha: SHA_40_B, shortSha: 'def5678', author: 'Ann' });
    const result = verify(
      [makeItem(), ann],
      makeAnswer([memory('Annual planning, Joanna and Ann_x said nothing.')]),
    );
    expect(result.verified).toHaveLength(1);
  });

  it('punctuation is a word boundary', () => {
    const ann = makeItem({ id: 'E2', sha: SHA_40_B, shortSha: 'def5678', author: 'Ann' });
    const result = verify(
      [makeItem(), ann],
      makeAnswer([memory("Ann's change, said (Ann).")]),
    );
    expect(result.rejected[0]?.reason).toBe(
      'The claim names Ann, but no cited commit is by Ann or mentions them.',
    );
  });

  it('name matching is case-sensitive', () => {
    const result = verify(
      [makeItem(), grace],
      makeAnswer([memory('grace hopper is lowercase here.')]),
    );
    expect(result.verified).toHaveLength(1);
  });

  it('a hostile author name with regex characters is matched literally', () => {
    const odd = makeItem({
      id: 'E2',
      sha: SHA_40_B,
      shortSha: 'def5678',
      author: '(a+)+$',
    });
    const result = verify([makeItem(), odd], makeAnswer([memory('Then (a+)+$ spoke.')]));
    expect(result.rejected[0]?.reason).toBe(
      'The claim names (a+)+$, but no cited commit is by (a+)+$ or mentions them.',
    );
  });
});

// ---------------------------------------------------------------------------
// R4.1 / R4.2 — silence
// ---------------------------------------------------------------------------

describe('verify — silence claims (R4.1, R4.2)', () => {
  it('a valid silence claim lands in silent, never verified', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      {
        kind: 'silence',
        text: 'The record is silent.',
        citations: [],
        silenceReason: 'No commits mention this behaviour',
      },
    ]);

    const result = verify(ledger, answer);

    expect(result.verified).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(result.silent).toHaveLength(1);
    expect(result.silent[0]?.index).toBe(0);
    expect(result.silent[0]?.claim.silenceReason).toBe(
      'No commits mention this behaviour',
    );
  });

  it('silence with a citation is rejected with S1', () => {
    const result = verify(
      [makeItem()],
      rawAnswer([
        {
          kind: 'silence',
          text: 'Silent',
          citations: [{ sha7: 'abc1234', quote: QUOTE }],
          silenceReason: 'Nothing',
        },
      ]),
    );
    expect(result.silent).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe('A silence claim cannot cite commits.');
  });

  it('silence with an empty silenceReason is rejected with S2 (bypass schema)', () => {
    const claim = {
      kind: 'silence' as const,
      text: 'The record is silent.',
      citations: [] as [],
      silenceReason: '',
    };
    const result = verify([makeItem()], makeAnswer([claim]));

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('silenceReason');
    expect(result.rejected[0]?.reason).toBe(
      'A silence claim must name the question the record cannot answer, and its silenceReason is empty.',
    );
  });

  it('silence with no silenceReason at all is rejected with S2', () => {
    const result = verify(
      [makeItem()],
      rawAnswer([{ kind: 'silence', text: 'Silent', citations: [] }]),
    );
    expect(result.rejected[0]?.reason).toBe(
      'A silence claim must name the question the record cannot answer, and its silenceReason is empty.',
    );
  });

  it('silence text over 300 characters is rejected with S3; 300 is accepted', () => {
    const result = verify(
      [makeItem()],
      rawAnswer([
        { kind: 'silence', text: 's'.repeat(301), citations: [], silenceReason: 'why' },
        { kind: 'silence', text: 's'.repeat(300), citations: [], silenceReason: 'why' },
      ]),
    );
    expect(result.rejected.map((r) => r.index)).toEqual([0]);
    expect(result.rejected[0]?.reason).toBe(
      'A silence claim may be at most 300 characters long.',
    );
    expect(result.silent.map((s) => s.index)).toEqual([1]);
  });

  it('a silenceReason over 300 characters is rejected with S4', () => {
    const result = verify(
      [makeItem()],
      rawAnswer([
        {
          kind: 'silence',
          text: 'Silent',
          citations: [],
          silenceReason: 'r'.repeat(301),
        },
      ]),
    );
    expect(result.rejected[0]?.reason).toBe(
      'The silenceReason of a silence claim may be at most 300 characters long.',
    );
  });
});

// ---------------------------------------------------------------------------
// Mixed-kind answers and score (R4.4)
// ---------------------------------------------------------------------------

describe('verify — mixed answers', () => {
  it('handles all three kinds in one answer correctly', () => {
    const item2 = makeItem({ id: 'E2', sha: SHA_40_B, shortSha: 'def5678' });
    const ledger = [makeItem(), item2];

    const answer = makeAnswer([
      memory('Memory claim'),
      {
        kind: 'speculation',
        text: 'Speculation claim',
        citations: [{ sha7: 'def5678', quote: QUOTE }],
      },
      {
        kind: 'silence',
        text: 'Silence claim',
        citations: [],
        silenceReason: 'Nothing relevant',
      },
      memory('Bad memory claim', 'fff9999'), // not in ledger
    ]);

    const result = verify(ledger, answer);

    expect(result.verified).toHaveLength(2);
    expect(result.silent).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('fff9999');
    expect(result.score).toBeCloseTo(2 / 4);
  });

  it('score equals verified / (verified + rejected + silent)', () => {
    const result = verify(
      [makeItem()],
      rawAnswer([
        memory('one'),
        memory('two'),
        memory('three'),
        memory('bad', 'fff0000'),
        { kind: 'silence', text: 'quiet', citations: [], silenceReason: 'why' },
      ]),
    );
    expect(result.score).toBe(3 / 5);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('verify — edge cases', () => {
  it('empty claims array (schema-bypassed) → score === 1', () => {
    const ledger = [makeItem()];
    const result = verify(ledger, rawAnswer([]));

    expect(result.score).toBe(1);
    expect(result.verified).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(result.silent).toHaveLength(0);
  });

  it('preserves claim insertion order across verified and rejected', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([
      memory('Claim 1'),
      memory('Claim 2'),
      memory('Claim 3 (bad)', 'fff9999'),
      memory('Claim 4'),
    ]);

    const result = verify(ledger, answer);

    expect(result.verified.map((v) => v.claim.text)).toEqual([
      'Claim 1',
      'Claim 2',
      'Claim 4',
    ]);
    expect(result.verified.map((v) => v.index)).toEqual([0, 1, 3]);
    expect(result.rejected.map((r) => r.text)).toEqual(['Claim 3 (bad)']);
    expect(result.rejected[0]?.claim?.text).toBe('Claim 3 (bad)');
  });

  it('result and its three arrays are frozen', () => {
    const result = verify([makeItem()], makeAnswer([memory('Claim')]));

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.verified)).toBe(true);
    expect(Object.isFrozen(result.rejected)).toBe(true);
    expect(Object.isFrozen(result.silent)).toBe(true);
  });

  it('does not mutate its input', () => {
    const ledger = [makeItem()];
    const claims: unknown[] = [
      memory('Claim'),
      { kind: 'memory', text: 'no quote', citations: [{ sha7: 'abc1234' }] },
      { kind: 'silence', text: 'quiet', citations: [], silenceReason: 'why' },
    ];
    const before = structuredClone(claims);
    verify(ledger, rawAnswer(claims));
    expect(claims).toEqual(before);
  });

  it('score is 0 when all claims are rejected', () => {
    const ledger = [makeItem()];
    const answer = makeAnswer([memory('Bad', 'fff0000'), memory('Also bad', 'fff1111')]);

    const result = verify(ledger, answer);

    expect(result.score).toBe(0);
  });
});
