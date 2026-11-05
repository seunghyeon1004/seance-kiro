/**
 * server.ts — Hono application for Séance.
 *
 * Routes:
 *   POST /api/summon
 *   POST /api/ask
 *   GET  /api/health
 *   Static public/ directory
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { buildLedger } from './evidence/ledger.js';
import { buildPrompt } from './ghost/persona.js';
import { askGhost } from './ghost/llm.js';
import { verify } from './ghost/verifier.js';
import type { LedgerResult } from './ghost/schema.js';
import {
  ValidationError,
  GitError,
  CloneError,
  SessionNotFoundError,
  TimeoutError,
  ConfigError,
  ParseError,
} from './errors.js';

// ---------------------------------------------------------------------------
// Session map
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = process.env['SESSION_TTL_MS']
  ? parseInt(process.env['SESSION_TTL_MS'], 10)
  : 30 * 60 * 1000; // 30 minutes

type SessionEntry = {
  ledger: LedgerResult;
  expiresAt: number;
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
// Request schemas
// ---------------------------------------------------------------------------

const GITHUB_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;

const SummonRequestSchema = z.object({
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
    return { status: 422, code: (err as { code: string }).code, message: err.message };
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
  return { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
}

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

const app = new Hono();

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
    const ledger = await buildLedger({
      repoUrl: input.repoUrl,
      file: input.file,
      startLine: input.startLine,
      endLine: input.endLine,
      githubToken: input.githubToken,
    });

    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      ledger,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });

    return c.json({
      sessionId,
      ledgerSize: ledger.items.length,
      truncated: ledger.truncated,
      buildDurationMs: ledger.buildDurationMs,
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
    const ghostAnswer = await askGhost(prompt, sessionId);
    const verifierResult = verify(ledger.items, ghostAnswer);

    // Reset session expiry (sliding window)
    entry.expiresAt = Date.now() + SESSION_TTL_MS;

    const isProduction = process.env['NODE_ENV'] === 'production';

    return c.json({
      sessionId,
      voice: ghostAnswer.voice,
      verified: verifierResult.verified.map((v) => ({
        text: v.claim.text,
        kind: v.claim.kind,
        citations: v.claim.citations,
        speculative: v.speculative,
      })),
      rejected: verifierResult.rejected.map((r) => ({
        text: isProduction ? '[claim redacted — failed verification]' : r.claim.text,
        kind: r.claim.kind,
        reason: r.reason,
      })),
      score: verifierResult.score,
    });
  } catch (err: unknown) {
    const { status, code, message } = toHttpError(err);
    return c.json({ code, message }, status as 400 | 404 | 503 | 500);
  }
});

// ---------------------------------------------------------------------------
// Export for testing + optional server start
// ---------------------------------------------------------------------------

export { app, sessions };

// Start server when run directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 3000;
  console.log(`Séance listening on http://localhost:${port}`);
}

export default app;
