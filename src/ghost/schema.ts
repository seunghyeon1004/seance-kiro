import { z } from 'zod';

// ---------------------------------------------------------------------------
// EvidenceItem — source of truth for the entire application
// ---------------------------------------------------------------------------

export const EvidenceItemSchema = z.object({
  id: z.string().regex(/^E\d+$/),
  sha: z
    .string()
    .length(40)
    .regex(/^[0-9a-f]+$/),
  shortSha: z
    .string()
    .length(7)
    .regex(/^[0-9a-f]+$/),
  author: z.string().min(1).max(256),
  email: z.string().email().max(256),
  date: z.string().datetime(), // ISO 8601
  subject: z.string().max(512),
  body: z.string().max(4096),
  hunk: z.string(),
  files: z.array(z.string()),
  refs: z.array(z.string()), // e.g. ["#42", "#99"]
  pr: z
    .object({
      title: z.string(),
      body: z.string(),
    })
    .optional(),
  suspiciousMessage: z.boolean().default(false),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

// ---------------------------------------------------------------------------
// LedgerResult — the immutable output of buildLedger
// ---------------------------------------------------------------------------

export const LedgerResultSchema = z.object({
  items: z.array(EvidenceItemSchema).readonly(),
  truncated: z.boolean(),
  buildDurationMs: z.number().nonnegative(),
});

export type LedgerResult = z.infer<typeof LedgerResultSchema>;

// ---------------------------------------------------------------------------
// GhostAnswer — structured output from the LLM ghost persona
// ---------------------------------------------------------------------------

export const CitationSchema = z.object({
  sha7: z
    .string()
    .length(7)
    .regex(/^[0-9a-f]+$/),
  quote: z.string().optional(),
});

export type Citation = z.infer<typeof CitationSchema>;

export const ClaimSchema = z.object({
  text: z.string(),
  citations: z.array(CitationSchema),
  kind: z.enum(['memory', 'speculation', 'silence']),
});

export type Claim = z.infer<typeof ClaimSchema>;

export const GhostAnswerSchema = z.object({
  claims: z.array(ClaimSchema),
  voice: z.string(),
});

export type GhostAnswer = z.infer<typeof GhostAnswerSchema>;
