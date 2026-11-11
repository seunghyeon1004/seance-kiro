/**
 * Unit tests for src/ratelimit.ts
 * Uses an injected clock so no real time passes.
 */

import { describe, it, expect } from 'vitest';
import { createModelLimiter, createSlotPool, clientKey } from '../src/ratelimit.js';

// ---------------------------------------------------------------------------
// clientKey
// ---------------------------------------------------------------------------

describe('clientKey', () => {
  it('returns first hop of X-Forwarded-For (trimmed)', () => {
    expect(clientKey('1.2.3.4, 5.6.7.8', '9.9.9.9')).toBe('1.2.3.4');
  });

  it('returns first hop when only one IP', () => {
    expect(clientKey('1.2.3.4', undefined)).toBe('1.2.3.4');
  });

  it('trims whitespace from first hop', () => {
    expect(clientKey('  10.0.0.1 , 10.0.0.2', '9.9.9.9')).toBe('10.0.0.1');
  });

  it('falls back to remoteAddr when X-Forwarded-For is undefined', () => {
    expect(clientKey(undefined, '1.2.3.4')).toBe('1.2.3.4');
  });

  it('falls back to remoteAddr when X-Forwarded-For is empty string', () => {
    expect(clientKey('', '1.2.3.4')).toBe('1.2.3.4');
  });

  it('falls back to remoteAddr when X-Forwarded-For is whitespace only', () => {
    expect(clientKey('   ', '1.2.3.4')).toBe('1.2.3.4');
  });

  it('returns "unknown" when both are undefined', () => {
    expect(clientKey(undefined, undefined)).toBe('unknown');
  });

  it('returns "unknown" when both are empty', () => {
    expect(clientKey('', '')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Per-client sliding window
// ---------------------------------------------------------------------------

describe('createModelLimiter — per-client window', () => {
  it('allows max requests within the window', () => {
    let now = 0;
    const limiter = createModelLimiter({
      max: 10,
      windowMs: 60_000,
      dailyMax: 1_000,
      now: () => now,
    });

    for (let i = 0; i < 10; i++) {
      const result = limiter.check('alice');
      expect(result.ok).toBe(true);
      now += 100; // small time advance between calls
    }
  });

  it('rejects the (max+1)th request with reason "client"', () => {
    let now = 0;
    const limiter = createModelLimiter({
      max: 10,
      windowMs: 60_000,
      dailyMax: 1_000,
      now: () => now,
    });

    for (let i = 0; i < 10; i++) {
      limiter.check('alice');
      now += 100;
    }

    const result = limiter.check('alice');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('client');
      expect(result.retryAfterSec).toBeGreaterThanOrEqual(1);
    }
  });

  it('rejected calls are not counted (R1.6)', () => {
    let now = 0;
    const limiter = createModelLimiter({
      max: 3,
      windowMs: 60_000,
      dailyMax: 1_000,
      now: () => now,
    });

    limiter.check('alice'); // 1
    limiter.check('alice'); // 2
    limiter.check('alice'); // 3
    // These should all reject but not count
    limiter.check('alice');
    limiter.check('alice');
    limiter.check('alice');

    // Window slides past; only 3 were ever recorded
    now = 60_001;
    const result = limiter.check('alice');
    expect(result.ok).toBe(true);
  });

  it('window slides: oldest timestamps expire and allow new requests', () => {
    let now = 0;
    const limiter = createModelLimiter({
      max: 3,
      windowMs: 10_000,
      dailyMax: 1_000,
      now: () => now,
    });

    // Fill the window
    limiter.check('alice');
    now += 1_000; // t=0
    limiter.check('alice');
    now += 1_000; // t=1000
    limiter.check('alice');
    now += 8_500; // t=2000 — now=10500, first two expired (< 10500-10000=500)

    // t=0 and t=1000 are both < 10500-10000=500? No: 0 < 500 yes, 1000 < 500 no.
    // Actually only t=0 expires. But t=2000 is within window. So 2 remain => allow.
    const r1 = limiter.check('alice'); // count = 2 in window, allow → 3
    expect(r1.ok).toBe(true);
    // Now 3 in window → reject
    const r2 = limiter.check('alice');
    expect(r2.ok).toBe(false);
  });

  it('separate client keys are independent', () => {
    let now = 0;
    const limiter = createModelLimiter({
      max: 2,
      windowMs: 60_000,
      dailyMax: 1_000,
      now: () => now,
    });

    limiter.check('alice');
    limiter.check('alice');
    // alice is now full
    expect(limiter.check('alice').ok).toBe(false);
    // bob still has quota
    expect(limiter.check('bob').ok).toBe(true);
    expect(limiter.check('bob').ok).toBe(true);
    expect(limiter.check('bob').ok).toBe(false);
  });

  it('retryAfterSec is ceil((oldest + windowMs - now) / 1000), at least 1', () => {
    let now = 0;
    const limiter = createModelLimiter({
      max: 1,
      windowMs: 30_000,
      dailyMax: 1_000,
      now: () => now,
    });

    limiter.check('alice'); // recorded at now=0
    now = 5_000;

    const result = limiter.check('alice');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // oldest=0, windowMs=30_000, now=5_000 → ceil((0+30_000-5_000)/1000) = ceil(25) = 25
      expect(result.retryAfterSec).toBe(25);
    }
  });

  it('retryAfterSec is at least 1 even when window is nearly expired', () => {
    let now = 0;
    const limiter = createModelLimiter({
      max: 1,
      windowMs: 1_000,
      dailyMax: 1_000,
      now: () => now,
    });

    limiter.check('alice'); // t=0
    now = 999; // 1ms left in window

    const result = limiter.check('alice');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryAfterSec).toBeGreaterThanOrEqual(1);
    }
  });

  it('allows requests again after the window has fully passed', () => {
    let now = 0;
    const limiter = createModelLimiter({
      max: 2,
      windowMs: 10_000,
      dailyMax: 1_000,
      now: () => now,
    });

    limiter.check('alice');
    limiter.check('alice');
    expect(limiter.check('alice').ok).toBe(false);

    now = 10_001; // all timestamps expired
    expect(limiter.check('alice').ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Daily global cap
// ---------------------------------------------------------------------------

describe('createModelLimiter — daily cap', () => {
  it('rejects with reason "daily" when dailyMax is exceeded', () => {
    // Use a fixed UTC day. now() returns ms since epoch.
    // We want a date that is stable regardless of system timezone.
    const BASE = Date.UTC(2026, 0, 15, 0, 0, 0); // 2026-01-15T00:00:00Z
    let now = BASE;

    const limiter = createModelLimiter({
      max: 1_000,
      windowMs: 600_000,
      dailyMax: 3,
      now: () => now,
    });

    limiter.check('a');
    now += 1;
    limiter.check('b');
    now += 1;
    limiter.check('c');
    now += 1;

    const result = limiter.check('d');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('daily');
      expect(result.retryAfterSec).toBeGreaterThanOrEqual(1);
    }
  });

  it('daily counter resets when the UTC date changes', () => {
    // Start just before midnight UTC
    const BASE = Date.UTC(2026, 0, 15, 23, 59, 59, 500); // 2026-01-15T23:59:59.500Z
    let now = BASE;

    const limiter = createModelLimiter({
      max: 1_000,
      windowMs: 600_000,
      dailyMax: 2,
      now: () => now,
    });

    limiter.check('a');
    limiter.check('b');
    expect(limiter.check('c').ok).toBe(false);

    // Cross midnight UTC
    now = Date.UTC(2026, 0, 16, 0, 0, 1); // 2026-01-16T00:00:01Z
    expect(limiter.check('a').ok).toBe(true); // new day, counter reset
  });

  it('daily retryAfterSec is seconds until next UTC midnight', () => {
    // 2026-01-15T23:00:00Z → 3600 seconds until midnight
    const BASE = Date.UTC(2026, 0, 15, 23, 0, 0);
    let now = BASE;

    const limiter = createModelLimiter({
      max: 1_000,
      windowMs: 600_000,
      dailyMax: 1,
      now: () => now,
    });

    limiter.check('a');
    const result = limiter.check('b');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('daily');
      // Next midnight = 2026-01-16T00:00:00Z = BASE + 3600_000ms
      // retryAfterSec = ceil((BASE+3600_000 - BASE) / 1000) = 3600
      expect(result.retryAfterSec).toBe(3600);
    }
  });

  it('daily check happens before client check (daily wins when both exceed)', () => {
    const BASE = Date.UTC(2026, 0, 15, 0, 0, 0);
    let now = BASE;

    // max=1, dailyMax=1 — one request fills both
    const limiter = createModelLimiter({
      max: 1,
      windowMs: 600_000,
      dailyMax: 1,
      now: () => now,
    });

    limiter.check('alice');
    const result = limiter.check('alice');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Daily cap fills first → reason should be 'daily'
      expect(result.reason).toBe('daily');
    }
  });

  it('rejected calls do not increment the daily counter (R1.6)', () => {
    const BASE = Date.UTC(2026, 0, 15, 0, 0, 0);
    let now = BASE;

    const limiter = createModelLimiter({
      max: 1_000,
      windowMs: 600_000,
      dailyMax: 2,
      now: () => now,
    });

    limiter.check('a');
    limiter.check('b');
    // Daily cap hit — these should not count
    limiter.check('c');
    limiter.check('d');

    // Next day — only 2 were recorded
    now = Date.UTC(2026, 0, 16, 0, 0, 1);
    // New day: allow again
    expect(limiter.check('a').ok).toBe(true);
    expect(limiter.check('b').ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('createModelLimiter — reset', () => {
  it('reset() clears all per-client windows and the daily counter', () => {
    let now = 0;
    const limiter = createModelLimiter({
      max: 1,
      windowMs: 60_000,
      dailyMax: 1,
      now: () => now,
    });

    limiter.check('alice');
    expect(limiter.check('alice').ok).toBe(false);

    limiter.reset();
    expect(limiter.check('alice').ok).toBe(true);
  });
});

describe('pruning (R1.7)', () => {
  it('drops clients whose window has fully expired', () => {
    let t = Date.UTC(2026, 10, 9, 12, 0, 0);
    const lim = createModelLimiter({
      max: 10,
      windowMs: 1000,
      dailyMax: 1000,
      now: () => t,
    });
    for (let i = 0; i < 50; i++) lim.check(`10.0.0.${i}`);
    expect(lim.size()).toBe(50);
    t += 2000;
    lim.check('10.0.1.1');
    expect(lim.size()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// createSlotPool — ward-hardening R10.6, design.md §8.3
// ---------------------------------------------------------------------------

describe('createSlotPool (R10.6)', () => {
  it('up to max acquires succeed and the next returns null', () => {
    const pool = createSlotPool(3);
    const releases = [pool.tryAcquire(), pool.tryAcquire(), pool.tryAcquire()];
    expect(releases.every((r) => typeof r === 'function')).toBe(true);
    expect(pool.inUse()).toBe(3);
    expect(pool.tryAcquire()).toBeNull();
    expect(pool.inUse()).toBe(3);
  });

  it('release frees one slot and is idempotent', () => {
    const pool = createSlotPool(2);
    const a = pool.tryAcquire();
    const b = pool.tryAcquire();
    expect(b).not.toBeNull();
    a?.();
    a?.();
    a?.();
    expect(pool.inUse()).toBe(1);
    const c = pool.tryAcquire();
    expect(c).not.toBeNull();
    expect(pool.tryAcquire()).toBeNull();
    expect(pool.inUse()).toBe(2);
  });

  it('reset frees every slot, and a release from before the reset does not free a new slot', () => {
    const pool = createSlotPool(2);
    const old = pool.tryAcquire();
    pool.tryAcquire();
    pool.reset();
    expect(pool.inUse()).toBe(0);
    const x = pool.tryAcquire();
    const y = pool.tryAcquire();
    expect(x).not.toBeNull();
    expect(y).not.toBeNull();
    old?.();
    expect(pool.inUse()).toBe(2);
    expect(pool.tryAcquire()).toBeNull();
  });

  it('a pool of size 1 serialises', () => {
    const pool = createSlotPool(1);
    const r = pool.tryAcquire();
    expect(pool.tryAcquire()).toBeNull();
    r?.();
    expect(pool.tryAcquire()).not.toBeNull();
  });
});
