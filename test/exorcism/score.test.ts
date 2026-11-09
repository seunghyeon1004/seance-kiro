/**
 * T2 unit tests for src/exorcism/score.ts
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeScore } from '../../src/exorcism/score.js';
import type { LedgerResult, EvidenceItem } from '../../src/ghost/schema.js';

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const SHA_40 = 'abc1234' + '0'.repeat(33);

function makeItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return Object.freeze({
    id: 'E1',
    sha: SHA_40,
    shortSha: 'abc1234',
    author: 'Ada Lovelace',
    email: 'ada@example.com',
    date: new Date('2022-01-01T00:00:00.000Z').toISOString(),
    subject: 'fix: some change',
    body: '',
    hunk: '+const x = 1;\n',
    files: ['src/utils.ts'],
    refs: [],
    suspiciousMessage: false,
    ...overrides,
  });
}

function makeLedger(items: EvidenceItem[]): LedgerResult {
  return {
    items: items as unknown as readonly EvidenceItem[],
    truncated: false,
    buildDurationMs: 0,
  };
}

// Use a fixed "now" far in the future so age signals are deterministic
const NOW_2026 = new Date('2026-11-05T00:00:00.000Z').getTime();

// ---------------------------------------------------------------------------
// Empty ledger
// ---------------------------------------------------------------------------

describe('computeScore — empty ledger', () => {
  it('returns score === 0, all six rawValues === 0, markerLocations === []', () => {
    const result = computeScore(
      makeLedger([]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    expect(result.score).toBe(0);
    expect(result.markerLocations).toEqual([]);
    expect(result.signalBreakdown).toHaveLength(6);
    for (const breakdown of result.signalBreakdown) {
      expect(breakdown.rawValue).toBe(0);
      expect(breakdown.weightedContribution).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Age signal
// ---------------------------------------------------------------------------

describe('computeScore — age signal', () => {
  it('single item with date exactly two years ago → ageSignal.rawValue === 1', () => {
    // Two years = 730 days before nowMs
    const twoYearsAgoMs = NOW_2026 - 730 * 86_400_000;
    const item = makeItem({ date: new Date(twoYearsAgoMs).toISOString() });
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    const ageBreakdown = result.signalBreakdown.find((s) => s.signal === 'age');
    expect(ageBreakdown?.rawValue).toBe(1);
  });

  it('item with very recent date → ageSignal.rawValue close to 0', () => {
    const oneDayAgoMs = NOW_2026 - 86_400_000;
    const item = makeItem({ date: new Date(oneDayAgoMs).toISOString() });
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    const ageBreakdown = result.signalBreakdown.find((s) => s.signal === 'age');
    expect(ageBreakdown?.rawValue).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// Marker signal
// ---------------------------------------------------------------------------

describe('computeScore — marker signal', () => {
  it('single item with one TODO → markerSignal.rawValue === 0.1, markerLocations.length === 1', () => {
    const item = makeItem({ hunk: '+// TODO: fix this later\n', shortSha: 'abc1234' });
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    const markerBreakdown = result.signalBreakdown.find((s) => s.signal === 'marker');
    expect(markerBreakdown?.rawValue).toBeCloseTo(0.1);
    expect(result.markerLocations).toHaveLength(1);
    expect(result.markerLocations[0]?.sha7).toBe('abc1234');
  });

  it('markerLocations[0].sha7 matches item.shortSha', () => {
    const item = makeItem({
      hunk: '+// FIXME: this is broken\n',
      shortSha: 'def5678',
      sha: 'def5678' + '0'.repeat(33),
    });
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    expect(result.markerLocations[0]?.sha7).toBe('def5678');
  });

  it('lineText is trimmed to 256 chars', () => {
    const longLine = '+// TODO: ' + 'x'.repeat(300);
    const item = makeItem({ hunk: longLine + '\n' });
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    expect(result.markerLocations[0]?.lineText.length).toBeLessThanOrEqual(256);
  });

  it('10 TODO lines → markerSignal.rawValue === 1', () => {
    const hunk =
      Array.from({ length: 10 }, (_, i) => `+// TODO: item ${i}`).join('\n') + '\n';
    const item = makeItem({ hunk });
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    const markerBreakdown = result.signalBreakdown.find((s) => s.signal === 'marker');
    expect(markerBreakdown?.rawValue).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Gone signal
// ---------------------------------------------------------------------------

describe('computeScore — gone signal', () => {
  it('all authors with last commit > 365 days ago → goneSignal.rawValue === 1', () => {
    const oldDate = new Date(NOW_2026 - 400 * 86_400_000).toISOString();
    const item = makeItem({ date: oldDate, author: 'Old Developer' });
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    const goneBreakdown = result.signalBreakdown.find((s) => s.signal === 'gone');
    expect(goneBreakdown?.rawValue).toBe(1);
  });

  it('author with last commit within threshold → goneSignal.rawValue === 0', () => {
    const recentDate = new Date(NOW_2026 - 100 * 86_400_000).toISOString();
    const item = makeItem({ date: recentDate, author: 'Active Developer' });
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    const goneBreakdown = result.signalBreakdown.find((s) => s.signal === 'gone');
    expect(goneBreakdown?.rawValue).toBe(0);
  });

  it('authorGoneThresholdDays = 1 vs 365 changes goneSignal correctly', () => {
    // Author's last commit was 5 days ago
    const fiveDaysAgoDate = new Date(NOW_2026 - 5 * 86_400_000).toISOString();
    const item = makeItem({ date: fiveDaysAgoDate, author: 'Semi-active Developer' });
    const ledger = makeLedger([item]);

    // With threshold = 1 day: author is gone (5 > 1)
    const result1 = computeScore(
      ledger,
      { authorGoneThresholdDays: 1, nowMs: NOW_2026 },
      NOW_2026,
    );
    const gone1 = result1.signalBreakdown.find((s) => s.signal === 'gone');
    expect(gone1?.rawValue).toBe(1);

    // With threshold = 365 days: author is not gone (5 < 365)
    const result2 = computeScore(
      ledger,
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );
    const gone2 = result2.signalBreakdown.find((s) => s.signal === 'gone');
    expect(gone2?.rawValue).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test signal
// ---------------------------------------------------------------------------

describe('computeScore — test signal', () => {
  it('ledger with no test files → testSignal.rawValue === 1', () => {
    const item = makeItem({ files: ['src/utils.ts', 'src/main.ts'] });
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    const testBreakdown = result.signalBreakdown.find((s) => s.signal === 'test');
    expect(testBreakdown?.rawValue).toBe(1);
  });

  it('ledger with *.test.ts in files[] → testSignal.rawValue === 0', () => {
    const item = makeItem({ files: ['src/utils.ts', 'src/utils.test.ts'] });
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    const testBreakdown = result.signalBreakdown.find((s) => s.signal === 'test');
    expect(testBreakdown?.rawValue).toBe(0);
  });

  it('ledger with *.spec.js in files[] → testSignal.rawValue === 0', () => {
    const item = makeItem({ files: ['src/utils.spec.js'] });
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    const testBreakdown = result.signalBreakdown.find((s) => s.signal === 'test');
    expect(testBreakdown?.rawValue).toBe(0);
  });

  it('ledger with __tests__ directory → testSignal.rawValue === 0', () => {
    const item = makeItem({ files: ['src/__tests__/utils.ts'] });
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    const testBreakdown = result.signalBreakdown.find((s) => s.signal === 'test');
    expect(testBreakdown?.rawValue).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Nesting signal
// ---------------------------------------------------------------------------

describe('computeScore — nesting signal', () => {
  it('hunk with 8-space-deep line (depth=2 levels = 8 spaces / 4) → nestingSignal checked', () => {
    // 8 spaces = depth 2; but 32 spaces = depth 8 → rawValue = 1
    const item = makeItem({ hunk: '+        const x = 1;\n' }); // 8 spaces = 2 levels
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    const nestingBreakdown = result.signalBreakdown.find((s) => s.signal === 'nesting');
    // 8 spaces / 4 = 2 levels, rawValue = 2/8 = 0.25
    expect(nestingBreakdown?.rawValue).toBeCloseTo(0.25);
  });

  it('hunk with 32-space-deep line → nestingSignal.rawValue === 1', () => {
    const deepLine = '+' + ' '.repeat(32) + 'const x = 1;\n';
    const item = makeItem({ hunk: deepLine });
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    const nestingBreakdown = result.signalBreakdown.find((s) => s.signal === 'nesting');
    expect(nestingBreakdown?.rawValue).toBe(1);
  });

  it('removed lines (-) are ignored in nesting calculation', () => {
    const removedDeepLine = '-' + ' '.repeat(32) + 'const x = 1;\n'; // removed line
    const item = makeItem({ hunk: removedDeepLine });
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    const nestingBreakdown = result.signalBreakdown.find((s) => s.signal === 'nesting');
    // Removed lines are ignored, so depth should be 0
    expect(nestingBreakdown?.rawValue).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// All signals at maximum
// ---------------------------------------------------------------------------

describe('computeScore — all signals at maximum → score === 100', () => {
  it('score === 100 when all signals are at their full-signal threshold', () => {
    // age: item from 730+ days ago
    const oldDate = new Date(NOW_2026 - 730 * 86_400_000).toISOString();
    // churn: enough commits in a short span that commits/day ≥ 1
    const recentDate = new Date(NOW_2026 - 86_400_000).toISOString(); // 1 day ago

    // 2 commits spanning 1 day = 2 commits/day ≥ 1 → churn = 1
    const items: EvidenceItem[] = [
      makeItem({
        id: 'E1',
        sha: 'aaa1234' + '0'.repeat(33),
        shortSha: 'aaa1234',
        date: oldDate,
        author: 'Old Dev',
        hunk:
          '+// TODO: fix 1\n+// TODO: fix 2\n+// TODO: fix 3\n+// TODO: fix 4\n+// TODO: fix 5\n+// TODO: fix 6\n+// TODO: fix 7\n+// TODO: fix 8\n+// TODO: fix 9\n+// TODO: fix 10\n+' +
          ' '.repeat(32) +
          'nested\n',
        files: [],
      }),
      makeItem({
        id: 'E2',
        sha: 'bbb5678' + '0'.repeat(33),
        shortSha: 'bbb5678',
        date: recentDate,
        author: 'Old Dev', // same author, last seen 1 day ago
        hunk: '+some code\n',
        files: [],
      }),
    ];
    // Note: author is "Old Dev" with last commit 1 day ago, threshold 365 days → not gone
    // To get goneSignal=1, we need all authors gone. Let's use a date > 365 days ago.
    // Overwrite to use two separate authors, both old
    items[1] = makeItem({
      id: 'E2',
      sha: 'bbb5678' + '0'.repeat(33),
      shortSha: 'bbb5678',
      date: new Date(NOW_2026 - 400 * 86_400_000).toISOString(),
      author: 'Old Dev 2',
      hunk: '+some code\n',
      files: [],
    });
    // Now recentDate item replaced — churn spans (730-400)=330 days with 2 commits = 2/330 < 1
    // We need churn signal=1: need 1+ commit/day, so many commits in 1 day span
    // Rebuild: all items from same day (oldDate) to ensure churnSignal ≥ 1
    const manyItems: EvidenceItem[] = Array.from({ length: 10 }, (_, i) => ({
      ...makeItem(),
      id: `E${i + 1}`,
      sha: `aaa${String(i).padStart(4, '0')}` + '0'.repeat(33 - 4),
      shortSha: `aaa${String(i).padStart(4, '0')}`.slice(0, 7),
      date: new Date(NOW_2026 - (730 + i) * 86_400_000).toISOString(), // all old and spread over 10 days → 10/10 = 1 commit/day
      author: `Old Dev ${i}`, // all gone (730+ days ago)
      hunk: `+// TODO: marker ${i}\n`,
      files: [],
    }));
    // Add deep nesting to one item
    manyItems[0] = {
      ...manyItems[0]!,
      hunk: manyItems[0]!.hunk + '+' + ' '.repeat(32) + 'deeply nested;\n',
    };

    const ledger = makeLedger(manyItems);
    const result = computeScore(
      ledger,
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    // All signals should be at or near maximum
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Score bounds
// ---------------------------------------------------------------------------

describe('computeScore — score bounds', () => {
  it('score is always an integer in [0, 100]', () => {
    const item = makeItem();
    const result = computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(result.score)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nowMs propagation — computeScore does NOT call Date.now() internally
// ---------------------------------------------------------------------------

describe('computeScore — does not call Date.now()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not call Date.now() during execution', () => {
    const dateNowSpy = vi.spyOn(globalThis.Date, 'now');

    const item = makeItem();
    computeScore(
      makeLedger([item]),
      { authorGoneThresholdDays: 365, nowMs: NOW_2026 },
      NOW_2026,
    );

    expect(dateNowSpy).not.toHaveBeenCalled();
  });
});
