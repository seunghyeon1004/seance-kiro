/**
 * server.ts — Hono application for Séance.
 *
 * Routes:
 *   POST /api/summon    (summon limiter, clone slots for remote URLs)
 *   POST /api/ask       (model gate: recordings, then the model limiter)
 *   POST /api/exorcise  (model gate: recordings, then the model limiter)
 *   POST /api/ward      (ward limiter)
 *   GET  /api/health
 *   Static public/ directory
 *
 * Every /api/* request passes a 64 KB body limit before any limiter (ward-hardening §8.2).
 * createApp(deps) builds an app; sessions, limiters and the clone pool are module-level and
 * shared by every app instance.
 */

import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { buildLedger, validateLedgerInput } from './evidence/ledger.js';
import { isSuspicious } from './evidence/refs.js';
import { buildPrompt, mostFrequentAuthor } from './ghost/persona.js';
import { askGhost, modelConfigured } from './ghost/llm.js';
import type { AnthropicClient } from './ghost/llm.js';
import { verify } from './ghost/verifier.js';
import { GhostAnswerWireSchema, HUNK_UI_CHARS } from './ghost/schema.js';
import { renderWardReport } from './ghost/report.js';
import type { WardReportMeta } from './ghost/report.js';
import { computeScore } from './exorcism/score.js';
import { buildPlan, verifyPlanClaims } from './exorcism/plan.js';
import type {
  EvidenceItem,
  ExorciseResponse,
  LedgerResult,
  ScoredResult,
  VerifiedAnswerResponse,
  VerifiedRefactorPlan,
  VerifierResult,
} from './ghost/schema.js';
import {
  ExorciseRequestSchema,
  ExorciseResponseSchema,
  PossessRequestSchema,
} from './ghost/schema.js';
import {
  SAMPLE_NAMES,
  SAMPLE_RANGES,
  loadRecording,
  recordingTargetFor,
} from './ghost/recordings.js';
import { possessedAnswer } from './ghost/possessed-ghost.js';
import type {
  AskRecording,
  ExorciseRecording,
  Recording,
  SampleName,
} from './ghost/recordings.js';
import {
  ValidationError,
  GitError,
  CloneError,
  SessionNotFoundError,
  TimeoutError,
  ConfigError,
  ParseError,
  HistoryError,
  ModelConfigError,
  ModelBusyError,
  SeanceError,
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
  /** Set when the repoUrl was 'crypt' or 'possessed' (design.md §3.2); the range is checked by recordingTargetFor. */
  sample?: SampleName;
};

/** How a recording came to be served (design.md §3.4). */
type RecordedVia = 'no-model' | 'daily-cap' | 'model-failure';
/** Per-request values set by modelGate and read by the /api/ask and /api/exorcise handlers. */
type AppEnv = {
  Variables: {
    recording: Recording | undefined;
    recordedVia: RecordedVia | undefined;
  };
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
// Error → HTTP mapping (first-seance design.md §3.3)
// ---------------------------------------------------------------------------

/** The fixed sentences a visitor sees; details go only to the server log (R6.1, R6.3, R8.1). */
const ERROR_MESSAGES = {
  HISTORY_ERROR:
    'Git could not read the history of these lines in time. Try a smaller range, or try again.',
  GIT_ERROR:
    'Git could not read that file and line range. Check the file path and the line numbers.',
  CLONE_ERROR:
    'The repository could not be cloned. It may be private, missing, too large or too slow to download.',
  MODEL_CONFIG:
    "The ghost cannot be reached: the server's model key or model name is wrong.",
  MODEL_BUSY: 'The spirits are busy. Try again in a minute.',
  TIMEOUT: 'The ghost took too long to answer.',
  LLM_ERROR: "The ghost's answer was not in a form the ward can read. Try asking again.",
  CONFIG_ERROR:
    'The ghost cannot speak on this server (no model key). The crypt and the ward still work.',
} as const;

type HttpError = {
  status: 400 | 404 | 422 | 500 | 503;
  code: string;
  message: string;
  headers?: Record<string, string>;
};

function toHttpError(err: unknown): HttpError {
  if (err instanceof ValidationError) {
    return { status: 400, code: err.code, message: err.message };
  }
  if (err instanceof SessionNotFoundError) {
    return { status: 404, code: err.code, message: err.message };
  }
  // Every row below logs the full error first, so the details exist only in the server log
  if (err instanceof HistoryError) {
    console.error('[seance] HISTORY_ERROR', { code: err.code, message: err.message });
    return { status: 422, code: err.code, message: ERROR_MESSAGES.HISTORY_ERROR };
  }
  if (err instanceof GitError || err instanceof CloneError) {
    // The raw message can hold command lines, temp paths and git stderr: log it, never send it (R10.2)
    console.error('[seance] git failure', { code: err.code, message: err.message });
    return err instanceof GitError
      ? { status: 422, code: err.code, message: ERROR_MESSAGES.GIT_ERROR }
      : { status: 422, code: err.code, message: ERROR_MESSAGES.CLONE_ERROR };
  }
  const model = (
    code: keyof typeof ERROR_MESSAGES,
    e: SeanceError,
    headers?: Record<string, string>,
  ): HttpError => {
    // The API key is already redacted inside classifyModelError
    console.error(`[seance] ${code}`, { code: e.code, message: e.message });
    return {
      status: 503,
      code,
      message: ERROR_MESSAGES[code],
      ...(headers ? { headers } : {}),
    };
  };
  if (err instanceof ModelConfigError) return model('MODEL_CONFIG', err);
  if (err instanceof ModelBusyError) {
    return model('MODEL_BUSY', err, { 'Retry-After': '60' });
  }
  if (err instanceof TimeoutError) return model('TIMEOUT', err);
  // Every ParseError that reaches a route comes from askGhost or askPlan (design.md §3.3 row 8)
  if (err instanceof ParseError) return model('LLM_ERROR', err);
  if (err instanceof ConfigError) return model('CONFIG_ERROR', err);
  console.error(
    '[seance] unexpected error:',
    err instanceof Error ? (err.stack ?? err.message) : String(err),
  );
  return { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
}

/** The JSON error response for toHttpError's result, with its headers (R6.2). */
function errorResponse(c: Context, err: unknown): Response {
  const { status, code, message, headers } = toHttpError(err);
  return c.json({ code, message }, status, headers);
}

/** The failures R7.3 lets a recording answer for (the daily cap is handled in the gate). */
function isModelUnavailable(err: unknown): boolean {
  return (
    err instanceof ModelConfigError ||
    err instanceof ModelBusyError ||
    err instanceof TimeoutError ||
    err instanceof ConfigError
  );
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

const SAMPLE_ORDER: readonly SampleName[] = SAMPLE_NAMES;

function isSampleName(s: string): s is SampleName {
  return (SAMPLE_ORDER as readonly string[]).includes(s);
}

/** Where a bundled sample lives. POSSESSED_DIR is read per call, so a test can point it at a fresh build (R8.2). */
function sampleDir(name: SampleName): string {
  return name === 'crypt'
    ? CRYPT_DIR
    : (process.env['POSSESSED_DIR'] ?? path.join(ROOT, 'data', 'possessed'));
}

/** The samples whose repository has been built, in the order crypt, possessed (R5.1). */
function builtSamples(): SampleName[] {
  return SAMPLE_ORDER.filter((s) => fs.existsSync(path.join(sampleDir(s), '.git')));
}

/** "crypt" and "possessed" are the bundled sample repos. Local paths are refused unless ALLOW_LOCAL=1 (hosted demos must not read the server disk). */
function resolveRepo(repoUrl: string): string {
  if (repoUrl === 'crypt') {
    if (!fs.existsSync(path.join(sampleDir('crypt'), '.git'))) {
      throw new ValidationError(
        'The sample crypt has not been built; run scripts/make-crypt.sh',
      );
    }
    return sampleDir('crypt');
  }
  if (repoUrl === 'possessed') {
    const dir = sampleDir('possessed');
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

const NOT_POSSESSED_MESSAGE =
  'The possessed ghost only answers on the possessed sample, auth/throttle.js line 4.';

/** The possessed sample summoned with its default file and range (R13.4). */
function isPossessedDefault(entry: SessionEntry): boolean {
  const d = SAMPLE_RANGES.possessed;
  return (
    entry.sample === 'possessed' &&
    entry.file === d.file &&
    entry.startLine === d.startLine &&
    entry.endLine === d.endLine
  );
}

/** The ward report's file and lines, shared by /api/ask, /api/ward and the recorded path. */
function reportMeta(entry: {
  file?: string;
  startLine?: number;
  endLine?: number;
}): WardReportMeta {
  const meta: WardReportMeta = {};
  if (entry.file !== undefined) {
    meta.file = entry.file;
    if (entry.startLine !== undefined && entry.endLine !== undefined) {
      meta.lines = { start: entry.startLine, end: entry.endLine };
    }
  }
  return meta;
}

/** Live ward over the recorded claims; the same builder as the live path (R7.6). */
function recordedAnswer(
  entry: SessionEntry,
  sessionId: string,
  rec: AskRecording,
  via: RecordedVia,
): VerifiedAnswerResponse {
  const result = verify(entry.ledger.items, rec.answer);
  const report = renderWardReport(result, reportMeta(entry));
  console.info('[seance] served recording', { via, sample: rec.sample, kind: rec.kind });
  entry.expiresAt = Date.now() + SESSION_TTL_MS;
  return {
    ...toAnswerResponse(entry.ledger, result, rec.answer.voice, report, sessionId),
    recorded: true,
  };
}

/**
 * The summon's persona: the prompt's author rule, plus whether that name tries to give orders,
 * so the page can name the ghost without printing it (R2.2, R2.5). Display only: the prompt
 * and the ward do not read it.
 */
function personaOf(items: ReadonlyArray<EvidenceItem>): {
  author: string;
  suspicious: boolean;
} {
  const author = mostFrequentAuthor(items);
  return { author, suspicious: isSuspicious(author) };
}

/** Shared /api/exorcise response, for the live and the recorded plan (design.md §3.4). */
function toExorciseResponse(
  sessionId: string,
  scored: ScoredResult,
  plan: VerifiedRefactorPlan,
  recorded: boolean,
): ExorciseResponse {
  // With REDACT_REJECTED=1, rejected claim text and the model's words in dropped entries are hidden
  const redactRejected = <T extends { text: string }>(r: T): T =>
    REDACT ? { ...r, text: REDACTED_TEXT } : r;

  return ExorciseResponseSchema.parse({
    sessionId,
    score: scored.score,
    signalBreakdown: scored.signalBreakdown,
    markerLocations: scored.markerLocations,
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
    recorded,
  });
}

/** Live ward over the recorded plan claims, with the haunting score computed now (R7.4). */
function recordedExorcism(
  entry: SessionEntry,
  sessionId: string,
  rec: ExorciseRecording,
  via: RecordedVia,
  authorGoneThresholdDays: number,
): ExorciseResponse {
  const nowMs = Date.now();
  const scored = computeScore(entry.ledger, { authorGoneThresholdDays, nowMs }, nowMs);
  const plan = verifyPlanClaims(entry.ledger, rec.plan);
  console.info('[seance] served recording', { via, sample: rec.sample, kind: rec.kind });
  entry.expiresAt = nowMs + SESSION_TTL_MS;
  return toExorciseResponse(sessionId, scored, plan, true);
}

/**
 * The recording that applies to this request, or null on any doubt (design.md §3.4). Hono caches
 * the parsed body, so the handler's own c.req.json() sees the same result.
 */
async function recordingForRequest(
  c: Context<AppEnv>,
  kind: 'ask' | 'exorcise',
): Promise<Recording | null> {
  const body: unknown = await c.req.json().catch(() => null);
  if (body === null || typeof body !== 'object') return null;
  const { sessionId, question } = body as { sessionId?: unknown; question?: unknown };
  if (typeof sessionId !== 'string') return null;
  const entry = sessions.get(sessionId);
  if (!entry || Date.now() > entry.expiresAt) return null;
  const target = recordingTargetFor(entry, kind, kind === 'ask' ? question : '');
  return target ? loadRecording(target) : null;
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
 *
 * `onDaily` (first-seance design.md §3.4) is asked only when the limiter refuses with its daily
 * reason; when it returns true the request goes on instead of the 429. A refused check records
 * nothing, so letting the request through charges nothing.
 */
function limitBy(
  limiter: ModelLimiter,
  messages: { client: string; daily?: string },
  onDaily?: (c: Context<AppEnv>) => boolean,
): MiddlewareHandler<AppEnv> {
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
      if (result.reason === 'daily' && onDaily !== undefined && onDaily(c)) {
        await next();
        return;
      }
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

/**
 * Model rate limit on the LLM-calling routes only (model-rate-limit R1.1); same bodies as before.
 * At the daily cap, a request with an applicable recording is let through to be served it (R7.7).
 */
const modelRateLimit = limitBy(
  modelLimiter,
  {
    client: 'The spirits are tired. Let them rest a few minutes before you call again.',
    daily: 'The séance is closed for tonight. The spirits will answer again tomorrow.',
  },
  (c) => {
    if (c.get('recording') === undefined) return false;
    c.set('recordedVia', 'daily-cap');
    return true;
  },
);
const summonRateLimit = limitBy(summonLimiter, {
  client: 'Too many summonings from here. Wait a few minutes and try again.',
});
const wardRateLimit = limitBy(wardLimiter, {
  client: 'The ward needs a short rest. Wait a few minutes before sending more claims.',
});

/**
 * In front of /api/ask and /api/exorcise (design.md §3.4). With no model configured and a
 * recording that applies, the limiter is not consulted (R7.7). Otherwise today's model limiter runs.
 */
function modelGate(kind: 'ask' | 'exorcise'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const recording = await recordingForRequest(c, kind);
    c.set('recording', recording ?? undefined);
    if (recording && !modelConfigured()) {
      c.set('recordedVia', 'no-model');
      await next();
      return;
    }
    return modelRateLimit(c, next);
  };
}

export function createApp(deps: AppDeps = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

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

  app.use('/api/ask', modelGate('ask'));
  app.use('/api/exorcise', modelGate('exorcise'));
  app.use('/api/summon', summonRateLimit);
  app.use('/api/ward', wardRateLimit);
  app.use('/api/possess', wardRateLimit); // the ward limiter; never modelGate or the model limiter

  registerRoutes(app, deps);
  return app;
}

function registerRoutes(app: Hono<AppEnv>, deps: AppDeps): void {
  // ---------------------------------------------------------------------------
  // GET /api/health
  // ---------------------------------------------------------------------------

  app.get('/api/health', (c) =>
    c.json({
      status: 'ok',
      uptime: process.uptime(),
      model: modelConfigured(), // read per request
      samples: builtSamples(),
    }),
  );

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
        ...(isSampleName(valid.repoUrl) ? { sample: valid.repoUrl } : {}),
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
        lines: ledger.lines ?? [], // R2.1
        persona: personaOf(ledger.items), // R2.2, R2.5
        shallow: ledger.shallow ?? false, // R8.3
      });
    } catch (err: unknown) {
      return errorResponse(c, err);
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
    const recording = c.get('recording');
    let entry: SessionEntry | undefined;

    try {
      // Look up session (throw SessionNotFoundError if absent or expired); never serve a recording for one
      entry = sessions.get(sessionId);
      if (!entry || Date.now() > entry.expiresAt) {
        if (entry) sessions.delete(sessionId);
        entry = undefined;
        throw new SessionNotFoundError(`Session "${sessionId}" not found or has expired`);
      }

      // No model, or the daily cap: the gate let a recording through without a limiter charge (R7.7)
      const via = c.get('recordedVia');
      if (via !== undefined && recording?.kind === 'ask') {
        return c.json(recordedAnswer(entry, sessionId, recording, via));
      }

      const { ledger } = entry;

      // Build prompt, call LLM, verify
      const prompt = buildPrompt(ledger.items, question, sessionId);
      const ghostAnswer = await askGhost(prompt, sessionId, deps.anthropicClient);
      const verifierResult = verify(ledger.items, ghostAnswer);

      // Build the ward report (R1.1, R1.3)
      const report = renderWardReport(verifierResult, reportMeta(entry));

      // Reset session expiry (sliding window)
      entry.expiresAt = Date.now() + SESSION_TTL_MS;

      return c.json({
        ...toAnswerResponse(ledger, verifierResult, ghostAnswer.voice, report, sessionId),
        recorded: false,
      });
    } catch (err: unknown) {
      if (entry !== undefined && isModelUnavailable(err) && recording?.kind === 'ask') {
        console.error('[seance] model unavailable, serving a recording', {
          code: (err as SeanceError).code,
          message: (err as SeanceError).message,
        });
        return c.json(recordedAnswer(entry, sessionId, recording, 'model-failure'));
      }
      return errorResponse(c, err);
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
    const recording = c.get('recording');
    let session: SessionEntry | undefined;

    try {
      // Look up session (throw SessionNotFoundError if absent or expired); never serve a recording for one
      session = sessions.get(sessionId);
      if (!session || Date.now() > session.expiresAt) {
        if (session) sessions.delete(sessionId);
        session = undefined;
        throw new SessionNotFoundError(`Session "${sessionId}" not found or has expired`);
      }

      // No model, or the daily cap: the gate let a recording through without a limiter charge (R7.7)
      const via = c.get('recordedVia');
      if (via !== undefined && recording?.kind === 'exorcise') {
        return c.json(
          recordedExorcism(
            session,
            sessionId,
            recording,
            via,
            authorGoneThresholdDays ?? 365,
          ),
        );
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

      return c.json(toExorciseResponse(sessionId, scoredResult, plan, false));
    } catch (err: unknown) {
      if (
        session !== undefined &&
        isModelUnavailable(err) &&
        recording?.kind === 'exorcise'
      ) {
        console.error('[seance] model unavailable, serving a recording', {
          code: (err as SeanceError).code,
          message: (err as SeanceError).message,
        });
        return c.json(
          recordedExorcism(
            session,
            sessionId,
            recording,
            'model-failure',
            authorGoneThresholdDays ?? 365,
          ),
        );
      }
      return errorResponse(c, err);
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
    const wardReport = renderWardReport(r, reportMeta(entry));
    return c.json(toAnswerResponse(entry.ledger, r, parsed.data.voice, wardReport));
  });

  // ---------------------------------------------------------------------------
  // POST /api/possess : the scripted possessed ghost through the live ward (first-seance R13.4).
  // No model is called and nothing is logged; the claims come from src/ghost/possessed-ghost.ts.
  // ---------------------------------------------------------------------------

  app.post('/api/possess', async (c) => {
    const parsed = PossessRequestSchema.safeParse(await c.req.json().catch(() => null));
    const entry = parsed.success ? sessions.get(parsed.data.sessionId) : undefined;
    if (!entry || Date.now() > entry.expiresAt) {
      return c.json(
        { code: 'SESSION_NOT_FOUND', message: 'Session not found or expired' },
        404,
      );
    }
    const answer = isPossessedDefault(entry) ? possessedAnswer(entry.ledger) : null;
    if (answer === null) {
      return c.json({ code: 'NOT_POSSESSED', message: NOT_POSSESSED_MESSAGE }, 400);
    }
    const result = verify(entry.ledger.items, answer);
    const report = renderWardReport(result, reportMeta(entry));
    return c.json({
      ...toAnswerResponse(entry.ledger, result, answer.voice, report),
      scripted: true,
    });
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

export const app: Hono<AppEnv> = createApp();
export { sessions };

/** Test seam for CP8 (design.md §11): the recorded path and the live builder it must equal. */
export const __test = { recordedAnswer, toAnswerResponse, reportMeta };

// Start server when run directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 3000;
  serve({ fetch: app.fetch, port });
  console.log(`Séance listening on http://localhost:${port}`);
}

export default app;
