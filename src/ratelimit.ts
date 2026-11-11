/**
 * ratelimit.ts — In-memory sliding-window rate limiter for model-calling routes.
 *
 * Implements spec model-rate-limit R1.2–R1.7:
 *  - Per-client sliding window (Map<key, timestamp[]>)
 *  - Global UTC-day cap ({ day, count })
 *  - Injectable clock for deterministic tests
 *  - No external dependencies
 */

export interface LimiterOptions {
  /** Max requests per client per windowMs. */
  max: number;
  /** Sliding window duration in milliseconds. */
  windowMs: number;
  /** Max model-calling requests across all clients per UTC day. */
  dailyMax: number;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

export type LimitResult =
  | { ok: true }
  | { ok: false; reason: 'client' | 'daily'; retryAfterSec: number };

export interface ModelLimiter {
  /** Check and, if allowed, record a request for `key`. */
  check(key: string): LimitResult;
  /** Clear all state — used in tests. */
  reset(): void;
  /** Number of client keys currently tracked. */
  size(): number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a UTC timestamp as 'YYYY-MM-DD'. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Seconds until the next UTC midnight after `now`. Minimum 1. */
function secsUntilNextMidnightUtc(now: number): number {
  const d = new Date(now);
  const nextMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((nextMidnight - now) / 1000));
}

// ---------------------------------------------------------------------------
// clientKey — R1.3
// ---------------------------------------------------------------------------

/**
 * Derive the per-client key from request headers / socket address.
 *
 * Priority:
 *  1. First (leftmost) entry of `X-Forwarded-For` (trimmed), when non-empty.
 *  2. `remoteAddr` when non-empty.
 *  3. The string `"unknown"`.
 */
export function clientKey(
  xForwardedFor: string | undefined,
  remoteAddr: string | undefined,
): string {
  if (xForwardedFor) {
    const first = xForwardedFor.split(',')[0]?.trim() ?? '';
    if (first) return first;
  }
  if (remoteAddr && remoteAddr.trim()) return remoteAddr.trim();
  return 'unknown';
}

// ---------------------------------------------------------------------------
// createModelLimiter — R1.2, R1.4, R1.6, R1.7
// ---------------------------------------------------------------------------

export function createModelLimiter(opts: LimiterOptions): ModelLimiter {
  const { max, windowMs, dailyMax } = opts;
  const now = opts.now ?? Date.now.bind(Date);

  // Per-client: map from key → array of recorded timestamps (all within the window).
  const windows = new Map<string, number[]>();

  // Daily global counter.
  let daily: { day: string; count: number } = { day: '', count: 0 };
  let lastPrune = 0;

  /** Drop every client whose timestamps have all expired (R1.7: bounded memory). */
  function prune(ts: number): void {
    const cutoff = ts - windowMs;
    for (const [k, list] of windows) {
      if (list.length === 0 || (list[list.length - 1] as number) <= cutoff)
        windows.delete(k);
    }
    lastPrune = ts;
  }

  function check(key: string): LimitResult {
    const ts = now();
    if (ts - lastPrune >= windowMs) prune(ts);

    // --- Daily cap (check first per design.md) ---
    const today = utcDay(ts);
    if (daily.day !== today) {
      // New UTC day: reset counter.
      daily = { day: today, count: 0 };
    }
    if (daily.count >= dailyMax) {
      return { ok: false, reason: 'daily', retryAfterSec: secsUntilNextMidnightUtc(ts) };
    }

    // --- Per-client window ---
    // Prune expired timestamps (older than ts - windowMs).
    const cutoff = ts - windowMs;
    let timestamps = windows.get(key) ?? [];
    timestamps = timestamps.filter((t) => t > cutoff);

    if (timestamps.length >= max) {
      const oldest = timestamps[0]!; // sorted ascending because we always append
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - ts) / 1000));
      return { ok: false, reason: 'client', retryAfterSec };
    }

    // --- Both passed: record the request ---
    timestamps.push(ts);
    if (timestamps.length === 0) {
      windows.delete(key);
    } else {
      windows.set(key, timestamps);
    }
    daily.count += 1;

    return { ok: true };
  }

  function size(): number {
    return windows.size;
  }

  function reset(): void {
    windows.clear();
    daily = { day: '', count: 0 };
    lastPrune = 0;
  }

  return { check, reset, size };
}

// ---------------------------------------------------------------------------
// createSlotPool — ward-hardening R10.6, design.md §8.3
// ---------------------------------------------------------------------------

export interface SlotPool {
  /** Returns a release function (idempotent), or null when all slots are taken. */
  tryAcquire(): (() => void) | null;
  /** Number of slots currently held. */
  inUse(): number;
  /** Free every slot — used in tests. Release functions from before the reset become no-ops. */
  reset(): void;
}

/** A counting semaphore with no waiting: callers that find every slot taken get null. */
export function createSlotPool(max: number): SlotPool {
  let held = 0;
  let generation = 0;

  function tryAcquire(): (() => void) | null {
    if (held >= max) return null;
    held += 1;
    const gen = generation;
    let released = false;
    return () => {
      if (released || gen !== generation) return;
      released = true;
      held -= 1;
    };
  }

  function inUse(): number {
    return held;
  }

  function reset(): void {
    held = 0;
    generation += 1;
  }

  return { tryAcquire, inUse, reset };
}
