/**
 * inquisitor review (2026-11-11), finding 4 — ward-hardening R11.4–R11.6.
 *
 * Year and ledger-author detection compares NFKC-normalised text with default-ignorable
 * characters removed, on the claim and on the ledger. Quote checks stay raw and
 * case-sensitive. Matching stays case-sensitive (a stated limit).
 */

import { describe, it, expect } from 'vitest';
import { verify } from '../../src/ghost/verifier.js';
import { detectionText } from '../../src/ghost/verifier.js';
import type { EvidenceItem } from '../../src/ghost/schema.js';

const BOB_QUOTE = 'retry the vendor call once';

function item(overrides: Partial<EvidenceItem>): EvidenceItem {
  return Object.freeze({
    id: 'E1',
    sha: 'abc1234' + '0'.repeat(33),
    shortSha: 'abc1234',
    author: 'Bob',
    email: 'bob@example.com',
    date: '2020-03-01T00:00:00.000Z',
    subject: 'fix: retry the vendor call once',
    body: 'the vendor drops the first call',
    hunk: '@@ -1 +1 @@\n+retry();\n',
    files: ['a.ts'],
    refs: [],
    suspiciousMessage: false,
    ...overrides,
  });
}

const bob = item({});
const alice = item({
  id: 'E2',
  sha: 'def5678' + '0'.repeat(33),
  shortSha: 'def5678',
  author: 'Alice',
  date: '2024-01-01T00:00:00.000Z',
  subject: 'feat: the queue',
  body: 'a queue for the vendor',
});

const citeBob = (text: string): unknown => ({
  kind: 'memory',
  text,
  citations: [{ sha7: 'abc1234', quote: BOB_QUOTE }],
});

describe('detectionText (R11.4)', () => {
  it('applies NFKC and removes every listed default-ignorable character', () => {
    const ignorables = [
      0xad, 0x34f, 0x61c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180c, 0x180d, 0x180e,
      0x180f, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d,
      0x202e, 0x2060, 0x2064, 0x206f, 0x3164, 0xfe00, 0xfe0f, 0xfeff, 0xffa0, 0xe0000,
      0xe0001, 0xe0041, 0xe007f, 0xe0100, 0xe0fff,
    ];
    for (const cp of ignorables) {
      const s = `A${String.fromCodePoint(cp)}lice`;
      expect(detectionText(s), cp.toString(16)).toBe('Alice');
    }
    expect(detectionText('２０２４')).toBe('2024');
    expect(detectionText('Jose\u0301')).toBe('Jos\u00e9');
  });

  it('keeps case', () => {
    expect(detectionText('alice')).toBe('alice');
  });
});

describe('verify — year detection after normalisation (R11.4)', () => {
  it('full-width digits name a year: ２０２４ with only Bob’s 2020 commit cited is rejected', () => {
    const r = verify([bob, alice], { claims: [citeBob('Bob wrote this in ２０２４.')] });
    expect(r.verified).toHaveLength(0);
    expect(r.rejected[0]?.reason).toBe(
      'The claim names the year 2024, but no cited commit is dated 2024 or mentions it.',
    );
  });

  it('a zero-width character inside a year does not hide it', () => {
    const r = verify([bob], { claims: [citeBob('Bob wrote this in 20\u200B24.')] });
    expect(r.verified).toHaveLength(0);
    expect(r.rejected[0]?.reason).toContain('the year 2024');
  });

  it('a supported full-width year is still verified', () => {
    const r = verify([bob], { claims: [citeBob('Bob wrote this in ２０２０.')] });
    expect(r.verified).toHaveLength(1);
  });
});

describe('verify — author detection after normalisation (R11.4)', () => {
  it('A\\u200Blice with only Bob cited is rejected', () => {
    const r = verify([bob, alice], { claims: [citeBob('A\u200Blice wrote this.')] });
    expect(r.verified).toHaveLength(0);
    expect(r.rejected[0]?.reason).toBe(
      'The claim names Alice, but no cited commit is by Alice or mentions them.',
    );
  });

  it('the full concrete input of the review is rejected', () => {
    const r = verify([bob, alice], {
      claims: [citeBob('A\u200Blice wrote this in ２０２４.')],
    });
    expect(r.verified).toHaveLength(0);
    expect(r.rejected[0]?.reason).toContain('the year 2024');
    expect(r.rejected[0]?.reason).toContain('names Alice');
  });

  it('a tag character or a Hangul filler inside the name does not hide it', () => {
    for (const hidden of ['A\u{E0041}lice', 'Al\uFFA0ice', 'Ali\u00ADce']) {
      const r = verify([bob, alice], { claims: [citeBob(`${hidden} wrote this.`)] });
      expect(r.verified, hidden).toHaveLength(0);
    }
  });

  it('a decomposed form of a composed ledger name is detected', () => {
    const jose = item({
      id: 'E2',
      sha: 'def5678' + '0'.repeat(33),
      shortSha: 'def5678',
      author: 'Jos\u00e9',
    });
    const r = verify([bob, jose], { claims: [citeBob('Jose\u0301 wrote this.')] });
    expect(r.verified).toHaveLength(0);
    expect(r.rejected[0]?.reason).toContain('names Jos\u00e9');
  });

  it('a ledger author whose name hides a zero-width character is detected in plain text', () => {
    const hidden = item({
      id: 'E2',
      sha: 'def5678' + '0'.repeat(33),
      shortSha: 'def5678',
      author: 'Mal\u200Blory',
    });
    const r = verify([bob, hidden], { claims: [citeBob('Mallory wrote this.')] });
    expect(r.verified).toHaveLength(0);
  });

  it('a cited author named with a zero-width character is still verified', () => {
    const r = verify([bob, alice], {
      claims: [
        {
          kind: 'memory',
          text: 'A\u200Blice added the queue.',
          citations: [{ sha7: 'def5678', quote: 'a queue for the vendor' }],
        },
      ],
    });
    expect(r.verified).toHaveLength(1);
  });

  it('stated limit: a lower-cased name is not detected (matching stays case-sensitive)', () => {
    const r = verify([bob, alice], { claims: [citeBob('alice wrote this.')] });
    expect(r.verified).toHaveLength(1);
  });
});

describe('verify — quotes stay raw and case-sensitive (R11.5)', () => {
  it('a quote that matches only after normalisation is rejected', () => {
    for (const quote of [
      'retry the\u200B vendor call',
      'ｒetry the vendor call',
      'Retry the vendor call',
    ]) {
      const r = verify([bob], {
        claims: [
          {
            kind: 'memory',
            text: 'Bob did it.',
            citations: [{ sha7: 'abc1234', quote }],
          },
        ],
      });
      expect(r.verified, quote).toHaveLength(0);
      expect(r.rejected[0]?.reason).toContain(
        "The quote cited from abc1234 is not in that commit's subject, message or diff.",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// inquisitor second pass (2026-11-11), finding 2 — ward-hardening R12.1–R12.4
// ---------------------------------------------------------------------------

/** Every Default_Ignorable_Code_Point of the running Node, enumerated with the static property. */
const DI_RE = /^\p{Default_Ignorable_Code_Point}$/u;
const ALL_DI: readonly number[] = (() => {
  const out: number[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    if (DI_RE.test(String.fromCodePoint(cp))) out.push(cp);
  }
  return out;
})();

/** The hand-kept list of R11.4, as it stood before R12.1. */
const R11_4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xe0000, 0xe0fff],
];

describe('detection form — the whole Default_Ignorable_Code_Point class (R12.1)', () => {
  it('the property covers every code point of the R11.4 list in this Node', () => {
    for (const [lo, hi] of R11_4_RANGES) {
      for (let cp = lo; cp <= hi; cp++) {
        expect(DI_RE.test(String.fromCodePoint(cp)), cp.toString(16)).toBe(true);
      }
    }
    expect(ALL_DI).toContain(0x1bca0);
    expect(ALL_DI).toContain(0x1d173);
    expect(ALL_DI).toContain(0xfff0);
  });

  it('detectionText removes every one of them', () => {
    for (const cp of ALL_DI) {
      expect(detectionText(`A${String.fromCodePoint(cp)}lice`), cp.toString(16)).toBe(
        'Alice',
      );
    }
  });
});

describe('verify — the review example, U+1BCA0 and U+1D173 (R12.2)', () => {
  const supported = item({ subject: 'chore: supported phrase', body: '' });

  it('A\\u{1BCA0}lice … 20\\u{1D173}24 citing only Bob’s 2020 commit is rejected for both', () => {
    const r = verify([supported, alice], {
      claims: [
        {
          kind: 'memory',
          text: 'A\u{1BCA0}lice wrote this in 20\u{1D173}24.',
          citations: [{ sha7: 'abc1234', quote: 'supported phrase' }],
        },
      ],
    });
    expect(r.verified).toHaveLength(0);
    expect(r.rejected[0]?.reason).toContain(
      'The claim names Alice, but no cited commit is by Alice or mentions them.',
    );
    expect(r.rejected[0]?.reason).toContain(
      'The claim names the year 2024, but no cited commit is dated 2024 or mentions it.',
    );
  });

  it('every default-ignorable code point inside Alice and inside 2024 is caught', () => {
    for (const cp of ALL_DI) {
      const ch = String.fromCodePoint(cp);
      const r = verify([bob, alice], {
        claims: [citeBob(`Al${ch}ice wrote this in 202${ch}4.`)],
      });
      expect(r.verified, cp.toString(16)).toHaveLength(0);
      expect(r.rejected[0]?.reason, cp.toString(16)).toContain('names Alice');
      expect(r.rejected[0]?.reason, cp.toString(16)).toContain('the year 2024');
    }
  });

  it('a cited author written with U+1BCA0 is still verified', () => {
    const r = verify([bob, alice], {
      claims: [
        {
          kind: 'memory',
          text: 'A\u{1BCA0}lice added the queue.',
          citations: [{ sha7: 'def5678', quote: 'a queue for the vendor' }],
        },
      ],
    });
    expect(r.verified).toHaveLength(1);
  });

  it('only stricter (R12.3): claims the R11.4 form rejects stay rejected', () => {
    // Removing U+1BCA0 too would glue "Bob" into "Bobby" and "2024" into "20245"
    const carol = item({ author: 'Carol' });
    const bob2021 = item({
      id: 'E2',
      sha: 'def5678' + '0'.repeat(33),
      shortSha: 'def5678',
      date: '2021-03-01T00:00:00.000Z',
    });
    for (const text of [
      'B\u200Bob\u{1BCA0}by did it.',
      'Carol did it in 20\u200B24\u{1BCA0}5.',
    ]) {
      const r = verify([carol, bob2021], { claims: [citeBob(text)] });
      expect(r.verified, JSON.stringify(text)).toHaveLength(0);
    }
  });

  it('stated limits stay: a lower-cased name and a Cyrillic homoglyph are not detected', () => {
    for (const text of ['alice wrote this.', '\u0410lice wrote this.']) {
      const r = verify([bob, alice], { claims: [citeBob(text)] });
      expect(r.verified, JSON.stringify(text)).toHaveLength(1);
    }
  });

  it('quotes stay raw: a quote matching only once U+1BCA0 is removed is refused', () => {
    const r = verify([bob], {
      claims: [
        {
          kind: 'memory',
          text: 'Bob did it.',
          citations: [{ sha7: 'abc1234', quote: 'retry the\u{1BCA0} vendor call' }],
        },
      ],
    });
    expect(r.verified).toHaveLength(0);
    expect(r.rejected[0]?.reason).toContain("is not in that commit's subject");
  });
});
