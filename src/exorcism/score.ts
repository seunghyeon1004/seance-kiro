/**
 * score.ts — Haunting score computation.
 *
 * Pure function; no I/O, no Date.now(), no Math.random().
 * The caller supplies `nowMs` — the current timestamp in milliseconds.
 */

import type { LedgerResult } from '../ghost/schema.js';
import type {
  ScoredResult,
  ScoreInput,
  MarkerLocation,
  SignalBreakdown,
} from '../ghost/schema.js';

// ---------------------------------------------------------------------------
// Compile-time signal weight constants
// ---------------------------------------------------------------------------

const AGE_WEIGHT = 25;
const CHURN_WEIGHT = 20;
const GONE_WEIGHT = 20;
const MARKER_WEIGHT = 15;
const TEST_WEIGHT = 10;
const NESTING_WEIGHT = 10;

// ---------------------------------------------------------------------------
// Compile-time normalisation constants
// ---------------------------------------------------------------------------

const AGE_FULL_DAYS = 730; // 2 years
const CHURN_FULL_RATE = 1; // 1 commit/day
const MARKER_FULL_COUNT = 10; // 10 markers in hunks
const NESTING_FULL_DEPTH = 8; // 8 indentation levels

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function msPerDay(): number {
  return 86_400_000;
}

// ---------------------------------------------------------------------------
// Signal implementations (each returns rawValue ∈ [0, 1])
// ---------------------------------------------------------------------------

function computeAgeSignal(newestDateMs: number, nowMs: number): { rawValue: number } {
  const ageDays = (nowMs - newestDateMs) / msPerDay();
  return { rawValue: clamp(ageDays / AGE_FULL_DAYS, 0, 1) };
}

function computeChurnSignal(
  n: number,
  newestDateMs: number,
  oldestDateMs: number,
): { rawValue: number } {
  const spanDays = Math.max((newestDateMs - oldestDateMs) / msPerDay(), 1);
  const commitsPerDay = n / spanDays;
  return { rawValue: clamp(commitsPerDay / CHURN_FULL_RATE, 0, 1) };
}

function computeGoneSignal(
  items: LedgerResult['items'],
  nowMs: number,
  authorGoneThresholdDays: number,
): { rawValue: number } {
  // Collect the latest commit date per author
  const authorLatestMs = new Map<string, number>();
  for (const item of items) {
    const itemMs = new Date(item.date).getTime();
    const current = authorLatestMs.get(item.author);
    if (current === undefined || itemMs > current) {
      authorLatestMs.set(item.author, itemMs);
    }
  }

  const uniqueAuthors = authorLatestMs.size;
  if (uniqueAuthors === 0) {
    return { rawValue: 0 };
  }

  const thresholdMs = authorGoneThresholdDays * msPerDay();
  let goneCount = 0;
  for (const latestMs of authorLatestMs.values()) {
    if (nowMs - latestMs > thresholdMs) {
      goneCount++;
    }
  }

  return { rawValue: goneCount / uniqueAuthors };
}

const MARKER_PATTERN = /\b(TODO|FIXME|HACK)\b/gi;

function computeMarkerSignal(items: LedgerResult['items']): {
  rawValue: number;
  markerLocations: MarkerLocation[];
} {
  let totalCount = 0;
  const markerLocations: MarkerLocation[] = [];

  for (const item of items) {
    const lines = item.hunk.split('\n');
    for (const line of lines) {
      // Reset lastIndex since we use /gi
      MARKER_PATTERN.lastIndex = 0;
      if (MARKER_PATTERN.test(line)) {
        totalCount++;
        markerLocations.push({
          sha7: item.shortSha,
          lineText: line.slice(0, 256),
        });
      }
    }
  }

  return {
    rawValue: clamp(totalCount / MARKER_FULL_COUNT, 0, 1),
    markerLocations,
  };
}

function computeTestSignal(items: LedgerResult['items']): { rawValue: number } {
  const allFiles = items.flatMap((item) => item.files);
  const hasTest = allFiles.some(
    (f) => /\.(test|spec)\.[^.]+$/.test(f) || /__tests__/.test(f),
  );
  return { rawValue: hasTest ? 0 : 1 };
}

function computeNestingSignal(items: LedgerResult['items']): { rawValue: number } {
  let maxDepth = 0;

  for (const item of items) {
    const lines = item.hunk.split('\n');
    for (const line of lines) {
      // Only consider added (+) or context ( ) lines
      if (!line.startsWith('+') && !line.startsWith(' ')) {
        continue;
      }
      // Strip the leading +/space character before measuring indentation
      const content = line.slice(1);
      let whitespace = 0;
      for (const ch of content) {
        if (ch === '\t') {
          whitespace += 4;
        } else if (ch === ' ') {
          whitespace++;
        } else {
          break;
        }
      }
      const depth = whitespace / 4;
      if (depth > maxDepth) {
        maxDepth = depth;
      }
    }
  }

  return { rawValue: clamp(maxDepth / NESTING_FULL_DEPTH, 0, 1) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the haunting score for a given ledger and scoring parameters.
 *
 * @param ledger  - Immutable Evidence Ledger from a Séance session.
 * @param input   - Caller-supplied parameters (authorGoneThresholdDays, nowMs).
 * @param nowMs   - Current timestamp in ms; caller supplies this so the function
 *                  remains pure (no internal Date.now() call).
 * @returns       ScoredResult with integer score [0, 100], six signal breakdowns,
 *                and marker locations.
 */
export function computeScore(
  ledger: LedgerResult,
  input: ScoreInput,
  nowMs: number,
): ScoredResult {
  const { items } = ledger;

  if (items.length === 0) {
    const signalBreakdown: SignalBreakdown[] = [
      { signal: 'age', rawValue: 0, weightedContribution: 0 },
      { signal: 'churn', rawValue: 0, weightedContribution: 0 },
      { signal: 'gone', rawValue: 0, weightedContribution: 0 },
      { signal: 'marker', rawValue: 0, weightedContribution: 0 },
      { signal: 'test', rawValue: 0, weightedContribution: 0 },
      { signal: 'nesting', rawValue: 0, weightedContribution: 0 },
    ];
    return { score: 0, signalBreakdown, markerLocations: [] };
  }

  // Compute date range
  let oldestDateMs = Infinity;
  let newestDateMs = -Infinity;
  for (const item of items) {
    const ms = new Date(item.date).getTime();
    if (ms < oldestDateMs) oldestDateMs = ms;
    if (ms > newestDateMs) newestDateMs = ms;
  }

  const age = computeAgeSignal(newestDateMs, nowMs);
  const churn = computeChurnSignal(items.length, newestDateMs, oldestDateMs);
  const gone = computeGoneSignal(items, nowMs, input.authorGoneThresholdDays);
  const marker = computeMarkerSignal(items);
  const testSignal = computeTestSignal(items);
  const nesting = computeNestingSignal(items);

  const rawAge = age.rawValue;
  const rawChurn = churn.rawValue;
  const rawGone = gone.rawValue;
  const rawMarker = marker.rawValue;
  const rawTest = testSignal.rawValue;
  const rawNesting = nesting.rawValue;

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        rawAge * AGE_WEIGHT +
          rawChurn * CHURN_WEIGHT +
          rawGone * GONE_WEIGHT +
          rawMarker * MARKER_WEIGHT +
          rawTest * TEST_WEIGHT +
          rawNesting * NESTING_WEIGHT,
      ),
    ),
  );

  const signalBreakdown: SignalBreakdown[] = [
    { signal: 'age', rawValue: rawAge, weightedContribution: rawAge * AGE_WEIGHT },
    {
      signal: 'churn',
      rawValue: rawChurn,
      weightedContribution: rawChurn * CHURN_WEIGHT,
    },
    { signal: 'gone', rawValue: rawGone, weightedContribution: rawGone * GONE_WEIGHT },
    {
      signal: 'marker',
      rawValue: rawMarker,
      weightedContribution: rawMarker * MARKER_WEIGHT,
    },
    {
      signal: 'test',
      rawValue: rawTest,
      weightedContribution: rawTest * TEST_WEIGHT,
    },
    {
      signal: 'nesting',
      rawValue: rawNesting,
      weightedContribution: rawNesting * NESTING_WEIGHT,
    },
  ];

  return {
    score,
    signalBreakdown,
    markerLocations: marker.markerLocations,
  };
}
