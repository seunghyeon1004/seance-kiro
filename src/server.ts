/**
 * server.ts — Hono application for Séance.
 *
 * Routes:
 *   POST /api/summon    (summon limiter, clone slots for remote URLs)
 *   POST /api/ask       (model limiter)
 *   POST /api/exorcise  (model limiter)
 *   POST /api/ward      (ward limiter)
 *   GET  /api/health
 *   Static public/ directory
 *
 * Every /api/* request passes a 64 KB body limit before any limiter (ward-hardening §8.2).
 * createApp(deps) builds an app; sessions, limiters and the clone pool are module-level and
 * shared by every app instance.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { buildLedger, validateLedgerInput } from './evidence/ledger.js';
import { buildPrompt } from './ghost/persona.js';
import { askGhost } from './ghost/llm.js';
import type { AnthropicClient } from './ghost/llm.js';
import { verify } from './ghost/verifier.js';
import { GhostAnswerWireSchema, HUNK_UI_CHARS } from './ghost/schema.js';
import { renderWardReport } from './ghost/report.js';
import type { WardReportMeta } from './ghost/report.js';
import { computeScore } from './exorcism/score.js';
import { buildPlan } from './exorcism/plan.js';
import type {
  LedgerResult,
  VerifiedAnswerResponse,
  VerifierResult,
} from './ghost/schema.js';
import { ExorciseRequestSchema, ExorciseResponseSchema } from './ghost/schema.js';
import {
  ValidationError,
  GitError,
  CloneError,
  SessionNotFoundError,
  TimeoutError,
  ConfigError,
  ParseError,
} from './errors.js';
import { createModelLimiter, createSlotPool, clientKey } from './ratelimit.js';
import type { ModelLimiter } from './ratelimit.js';

// ---------------------------------------------------------------------------
// Session map
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = process.env['SESSION_TTL_MS']
  ? parseInt(process.env['SESSION_TTL_MS'], 10)
  : 30 * 60 * 1000; // 30 minutes

type SessionEntry = {
  ledger: LedgerResult;
  expiresAt: number;
  file?: string;
  startLine?: number;
  endLine?: number;
};

const sessions = new Map<string, SessionEntry>();

// Sweep expired sessions every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now > entry.expiresAt) {
      sessions.delete(id);
    }
  }
}, 60_000).unref(); // .unref() so it doesn't prevent process exit in tests

// ---------------------------------------------------------------------------
// Model rate limiter (R1.2, R1.4) — no new dependencies, in-memory
// ---------------------------------------------------------------------------

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const modelLimiter = createModelLimiter({
  max: parsePositiveInt(process.env['RATE_LIMIT_MAX'], 10),
  windowMs: parsePositiveInt(process.env['RATE_LIMIT_WINDOW_MS'], 600_000),
  dailyMax: parsePositiveInt(process.env['MAX_MODEL_CALLS_PER_DAY'], 300),
});

// ---------------------------------------------------------------------------
// Abuse limits (ward-hardening R10.5–R10.8, design.md §8.2). Each limiter is its own
// instance, so neither touches modelLimiter's counters. `daily.count >= Infinity` is never true.
// ---------------------------------------------------------------------------

export const summonLimiter = createModelLimiter({
  max: parsePositiveInt(process.env['SUMMON_RATE_LIMIT_MAX'], 20),
  windowMs: parsePositiveInt(process.env['SUMMON_RATE_LIMIT_WINDOW_MS'], 600_000),
  dailyMax: Number.POSITIVE_INFINITY,
});

export const wardLimiter = createModelLimiter({
  max: parsePositiveInt(process.env['WARD_RATE_LIMIT_MAX'], 60),
  windowMs: parsePositiveInt(process.env['WARD_RATE_LIMIT_WINDOW_MS'], 600_000),
  dailyMax: Number.POSITIVE_INFINITY,
});

/** At most MAX_CONCURRENT_CLONES remote clones at once; the samples take no slot (R10.6). */
export const clonePool = createSlotPool(
  parsePositiveInt(process.env['MAX_CONCURRENT_CLONES'], 3),
);

const SESSION_MAX = parsePositiveInt(process.env['SESSION_MAX'], 500);

/**
 * Store a session, first removing the oldest by creation order while the map is full (R10.7).
 * Map iteration follows insertion order, and the sliding expiry never re-inserts an entry.
 */
function rememberSession(id: string, entry: SessionEntry): void {
  while (sessions.size >= SESSION_MAX) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
  sessions.set(id, entry);
}

const BODY_LIMIT_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const GITHUB_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;

const SummonRequestSchema = z
  .object({
    repoUrl: z
      .string()
      .min(1)
      .refine(
        (url) => {
          // If it looks like a URL, it must be a GitHub URL
          if (url.startsWith('http://') || url.startsWith('https://')) {
            return GITHUB_URL_RE.test(url);
          }
          return true;
        },
        { message: 'remote URLs must be https://github.com/<owner>/<repo>' },
      ),
    file: z.string().min(1),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    githubToken: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.endLine < val.startLine) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endLine'],
        message: `endLine (${val.endLine}) must be >= startLine (${val.startLine})`,
      });
    }
  });

const AskRequestSchema = z.object({
  sessionId: z.string().min(1),
  question: z.string().min(1).max(1000),
});

// ---------------------------------------------------------------------------
// Error → HTTP mapping
// ---------------------------------------------------------------------------

function toHttpError(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof ValidationError) {
    return { status: 400, code: err.code, message: err.message };
  }
  if (err instanceof SessionNotFoundError) {
    return { status: 404, code: err.code, message: err.message };
  }
  if (err instanceof GitError || err instanceof CloneError) {
    // The raw message can hold command lines, temp paths and git stderr: log it, never send it (R10.2)
    console.error('[seance] git failure', { code: err.code, message: err.message });
    return err instanceof GitError
      ? {
          status: 422,
          code: err.code,
          message:
            'Git could not read that file and line range. Check the file path and the line numbers.',
        }
      : {
          status: 422,
          code: err.code,
          message:
            'The repository could not be cloned. It may be private, missing, too large or too slow to download.',
        };
  }
  if (err instanceof TimeoutError) {
    return { status: 503, code: err.code, message: err.message };
  }
  if (
    err instanceof ParseError &&
    (err.message.includes('LLM') || err.message.includes('Fixture'))
  ) {
    return { status: 503, code: 'LLM_ERROR', message: err.message };
  }
  if (err instanceof ConfigError) {
    return { status: 503, code: err.code, message: err.message };
  }
  console.error(
    '[seance] unexpected error:',
    err instanceof Error ? (err.stack ?? err.message) : String(err),
  );
  return { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
}

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRYPT_DIR = process.env['CRYPT_DIR'] ?? path.join(ROOT, 'data', 'crypt');
const ALLOW_LOCAL = process.env['ALLOW_LOCAL'] === '1';
/** Reject-claim text is shown by default (it is the point of the ward); set REDACT_REJECTED=1 to hide it. */
const REDACT = process.env['REDACT_REJECTED'] === '1';
const REDACTED_TEXT = '[claim redacted - failed verification]';

/** "crypt" and "possessed" are the bundled sample repos. Local paths are refused unless ALLOW_LOCAL=1 (hosted demos must not read the server disk). */
function resolveRepo(repoUrl: string): string {
  if (repoUrl === 'crypt') {
    if (!fs.existsSync(path.join(CRYPT_DIR, '.git'))) {
      throw new ValidationError(
        'The sample crypt has not been built; run scripts/make-crypt.sh',
      );
    }
    return CRYPT_DIR;
  }
  if (repoUrl === 'possessed') {
    // Read per request, so a test can point it at a freshly built sample (R8.2)
    const dir = process.env['POSSESSED_DIR'] ?? path.join(ROOT, 'data', 'possessed');
    if (!fs.existsSync(path.join(dir, '.git'))) {
      throw new ValidationError(
        'The possessed sample has not been built; run scripts/make-possessed.sh',
      );
    }
    return dir;
  }
  if (/^https:\/\//.test(repoUrl)) return repoUrl;
  if (!ALLOW_LOCAL)
    throw new ValidationError(
      'Use the sample crypt or a https://github.com/<owner>/<repo> URL',
    );
  return repoUrl;
}

/** True when any cited sha7 is the shortSha of a ledger item flagged as suspicious (R6.4). */
function citesSuspicious(ledger: LedgerResult, sha7s: readonly string[]): boolean {
  return sha7s.some((s) =>
    ledger.items.some((i) => i.shortSha === s && i.suspiciousMessage),
  );
}

/** Shared /api/ask and /api/ward response (ward-hardening design.md §9.1). */
function toAnswerResponse(
  ledger: LedgerResult,
  result: VerifierResult,
  voice: string,
  report: string,
  sessionId?: string,
): VerifiedAnswerResponse {
  const response: VerifiedAnswerResponse = {
    voice,
    verified: result.verified.map((v) => ({
      text: v.claim.text,
      kind: v.claim.kind,
      citations: v.claim.citations,
      speculative: v.speculative,
      quotes: v.quotes,
      citesSuspicious: citesSuspicious(
        ledger,
        v.claim.citations.map((c) => c.sha7),
      ),
    })),
    rejected: result.rejected.map((r) => ({
      text: REDACT ? REDACTED_TEXT : r.text,
      kind: r.kind,
      reason: r.reason,
      citesSuspicious: citesSuspicious(ledger, r.citedSha7s),
    })),
    silent: result.silent.map((s) => ({
      text: s.claim.text,
      silenceReason: s.claim.silenceReason,
    })),
    tally: {
      verified: result.verified.length,
      checked: result.verified.length + result.rejected.length,
      silent: result.silent.length,
    },
    score: result.score,
    report,
  };
  return sessionId === undefined ? response : { sessionId, ...response };
}

// ---------------------------------------------------------------------------
// Hono app — createApp(deps); sessions and limiters stay module-level and shared
// ---------------------------------------------------------------------------

export interface AppDeps {
  /** Injected model client, forwarded to askGhost and buildPlan (tests, design.md §8.1). */
  anthropicClient?: AnthropicClient;
}

/**
 * Per-client limiter middleware with the model limiter's response shape: 429,
 * { error, code: 'RATE_LIMITED' } and Retry-After (design.md §8.2).
 */
function limitBy(
  limiter: ModelLimiter,
  messages: { client: string; daily?: string },
): MiddlewareHandler {
  return async (c, next) => {
    const xff = c.req.header('x-forwarded-for');
    let remote: string | undefined;
    try {
      remote = getConnInfo(c).remote.address;
    } catch {
      remote = undefined; // app.fetch() in tests has no socket
    }
    const result = limiter.check(clientKey(xff, remote));
    if (!result.ok) {
      const error =
        result.reason === 'daily' && messages.daily !== undefined
          ? messages.daily
          : messages.client;
      return c.newResponse(JSON.stringify({ error, code: 'RATE_LIMITED' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(result.retryAfterSec),
        },
      });
    }
    await next();
  };
}

/** Model rate limit on the LLM-calling routes only (model-rate-limit R1.1); same bodies as before. */
const modelRateLimit = limitBy(modelLimiter, {
  client: 'The spirits are tired. Let them rest a few minutes before you call again.',
  daily: 'The séance is closed for tonight. The spirits will answer again tomorrow.',
});
const summonRateLimit = limitBy(summonLimiter, {
  client: 'Too many summonings from here. Wait a few minutes and try again.',
});
const wardRateLimit = limitBy(wardLimiter, {
  client: 'The ward needs a short rest. Wait a few minutes before sending more claims.',
});

export function createApp(deps: AppDeps = {}): Hono {
  const app = new Hono();

  // Apply security headers to all responses
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    }),
  );

  // Body limit before every limiter, so an oversized request consumes no limiter slot (R10.3)
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: (c) =>
        c.json(
          { code: 'PAYLOAD_TOO_LARGE', message: 'The request is larger than 64 KB.' },
          413,
        ),
    }),
  );

  app.use('/api/ask', modelRateLimit);
  app.use('/api/exorcise', modelRateLimit);
  app.use('/api/summon', summonRateLimit);
  app.use('/api/ward', wardRateLimit);

  registerRoutes(app, deps);
  return app;
}

function registerRoutes(app: Hono, deps: AppDeps): void {
  // ---------------------------------------------------------------------------
  // GET /api/health
  // ---------------------------------------------------------------------------

  app.get('/api/health', (c) => {
    return c.json({ status: 'ok', uptime: process.uptime() });
  });

  // ---------------------------------------------------------------------------
  // POST /api/summon
  // ---------------------------------------------------------------------------

  app.post('/api/summon', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' },
        400,
      );
    }

    const parsed = SummonRequestSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ code: 'VALIDATION_ERROR', message }, 400);
    }

    const input = parsed.data;

    try {
      // design.md §8.4: validate (R10.1), resolve, take a clone slot for remote URLs (R10.6)
      const valid = validateLedgerInput({
        repoUrl: input.repoUrl,
        file: input.file,
        startLine: input.startLine,
        endLine: input.endLine,
        githubToken: input.githubToken,
      });
      const repoUrl = resolveRepo(valid.repoUrl);

      let release: (() => void) | undefined;
      if (/^https:\/\//.test(repoUrl)) {
        const acquired = clonePool.tryAcquire();
        if (acquired === null) {
          return c.json(
            {
              code: 'BUSY',
              message:
                'Too many repositories are being cloned right now. Try again in a minute.',
            },
            503,
            { 'Retry-After': '30' },
          );
        }
        release = acquired;
      }

      let ledger: LedgerResult;
      try {
        ledger = await buildLedger({ ...valid, repoUrl });
      } finally {
        release?.();
      }

      const sessionId = crypto.randomUUID();
      rememberSession(sessionId, {
        ledger,
        expiresAt: Date.now() + SESSION_TTL_MS,
        file: valid.file,
        startLine: valid.startLine,
        endLine: valid.endLine,
      });

      return c.json({
        sessionId,
        ledgerSize: ledger.items.length,
        truncated: ledger.truncated,
        buildDurationMs: ledger.buildDurationMs,
        items: ledger.items.map((i) => ({
          id: i.id,
          sha: i.sha,
          shortSha: i.shortSha,
          author: i.author,
          date: i.date,
          subject: i.subject,
          body: i.body,
          hunk: i.hunk.slice(0, HUNK_UI_CHARS),
          files: i.files,
          refs: i.refs,
          pr: i.pr,
          suspiciousMessage: i.suspiciousMessage,
        })),
      });
    } catch (err: unknown) {
      const { status, code, message } = toHttpError(err);
      return c.json({ code, message }, status as 400 | 422 | 500);
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/ask
  // ---------------------------------------------------------------------------

  app.post('/api/ask', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' },
        400,
      );
    }

    const parsed = AskRequestSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ code: 'VALIDATION_ERROR', message }, 400);
    }

    const { sessionId, question } = parsed.data;

    try {
      // Look up session (throw SessionNotFoundError if absent or expired)
      const entry = sessions.get(sessionId);
      if (!entry || Date.now() > entry.expiresAt) {
        if (entry) sessions.delete(sessionId);
        throw new SessionNotFoundError(`Session "${sessionId}" not found or has expired`);
      }

      const { ledger } = entry;

      // Build prompt, call LLM, verify
      const prompt = buildPrompt(ledger.items, question, sessionId);
      const ghostAnswer = await askGhost(prompt, sessionId, deps.anthropicClient);
      const verifierResult = verify(ledger.items, ghostAnswer);

      // Build the ward report (R1.1, R1.3)
      const reportMeta: WardReportMeta = {};
      if (entry.file !== undefined) {
        reportMeta.file = entry.file;
        if (entry.startLine !== undefined && entry.endLine !== undefined) {
          reportMeta.lines = { start: entry.startLine, end: entry.endLine };
        }
      }
      const report = renderWardReport(verifierResult, reportMeta);

      // Reset session expiry (sliding window)
      entry.expiresAt = Date.now() + SESSION_TTL_MS;

      return c.json(
        toAnswerResponse(ledger, verifierResult, ghostAnswer.voice, report, sessionId),
      );
    } catch (err: unknown) {
      const { status, code, message } = toHttpError(err);
      return c.json({ code, message }, status as 400 | 404 | 503 | 500);
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/exorcise
  // ---------------------------------------------------------------------------

  app.post('/api/exorcise', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' },
        400,
      );
    }

    const parsed = ExorciseRequestSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ code: 'VALIDATION_ERROR', message }, 400);
    }

    const { sessionId, authorGoneThresholdDays } = parsed.data;

    try {
      // Look up session (throw SessionNotFoundError if absent or expired)
      const session = sessions.get(sessionId);
      if (!session || Date.now() > session.expiresAt) {
        if (session) sessions.delete(sessionId);
        throw new SessionNotFoundError(`Session "${sessionId}" not found or has expired`);
      }

      const nowMs = Date.now();
      const scoredResult = computeScore(
        session.ledger,
        { authorGoneThresholdDays: authorGoneThresholdDays ?? 365, nowMs },
        nowMs,
      );

      const plan = await buildPlan(
        session.ledger,
        scoredResult,
        sessionId,
        deps.anthropicClient,
      );

      // Reset session expiry (sliding window)
      session.expiresAt = nowMs + SESSION_TTL_MS;

      // With REDACT_REJECTED=1, rejected claim text and the model's words in dropped entries are hidden
      const redactRejected = <T extends { text: string }>(r: T): T =>
        REDACT ? { ...r, text: REDACTED_TEXT } : r;

      return c.json(
        ExorciseResponseSchema.parse({
          sessionId,
          score: scoredResult.score,
          signalBreakdown: scoredResult.signalBreakdown,
          markerLocations: scoredResult.markerLocations,
          plan: {
            characterizationTests: plan.characterizationTests,
            steps: plan.steps.map((step) => ({
              ...step,
              rejectedClaims: step.rejectedClaims.map(redactRejected),
            })),
            doNotTouchList: plan.doNotTouchList.map((entry) => ({
              ...entry,
              rejectedClaims: entry.rejectedClaims.map(redactRejected),
            })),
            dropped: plan.dropped.map((d) => ({
              ...d,
              title: REDACT ? REDACTED_TEXT : d.title,
              modelText: REDACT ? REDACTED_TEXT : d.modelText,
              rejectedClaims: d.rejectedClaims.map(redactRejected),
            })),
            summary: plan.summary,
          },
          verifierScore: plan.verifierScore,
        }),
      );
    } catch (err: unknown) {
      const { status, code, message } = toHttpError(err);
      return c.json({ code, message }, status as 400 | 404 | 503 | 500);
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/ward : run any claim set through the Verifier (used by the "plant a false memory" demo)
  // ---------------------------------------------------------------------------

  app.post('/api/ward', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      sessionId?: string;
      answer?: unknown;
    } | null;
    const entry = body?.sessionId ? sessions.get(body.sessionId) : undefined;
    if (!entry || Date.now() > entry.expiresAt) {
      return c.json(
        { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' },
        404,
      );
    }
    const parsed = GhostAnswerWireSchema.safeParse(body?.answer);
    if (!parsed.success) {
      return c.json(
        {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        },
        400,
      );
    }
    const r = verify(entry.ledger.items, parsed.data);
    const wardMeta: WardReportMeta = {};
    if (entry.file !== undefined) {
      wardMeta.file = entry.file;
      if (entry.startLine !== undefined && entry.endLine !== undefined) {
        wardMeta.lines = { start: entry.startLine, end: entry.endLine };
      }
    }
    const wardReport = renderWardReport(r, wardMeta);
    return c.json(toAnswerResponse(entry.ledger, r, parsed.data.voice, wardReport));
  });

  // ---------------------------------------------------------------------------
  // Static UI
  // ---------------------------------------------------------------------------

  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
  };
  app.get('/*', (c) => {
    const base = path.join(ROOT, 'public');
    const p = new URL(c.req.url).pathname;
    const target = path.resolve(
      base,
      '.' + path.posix.normalize('/' + (p === '/' ? 'index.html' : p)),
    );
    if (!target.startsWith(base + path.sep)) return c.text('not found', 404);
    try {
      return new Response(fs.readFileSync(target), {
        headers: {
          'content-type': MIME[path.extname(target)] ?? 'application/octet-stream',
          'cache-control': 'no-cache',
        },
      });
    } catch {
      return c.text('not found', 404);
    }
  });
}

// ---------------------------------------------------------------------------
// Export for testing + optional server start
// ---------------------------------------------------------------------------

export const app: Hono = createApp();
export { sessions };

// Start server when run directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 3000;
  serve({ fetch: app.fetch, port });
  console.log(`Séance listening on http://localhost:${port}`);
}

export default app;
