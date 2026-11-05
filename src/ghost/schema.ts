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
// Citation — one piece of evidence backing a claim
// ---------------------------------------------------------------------------

export const CitationSchema = z.object({
  sha7: z
    .string()
    .length(7)
    .regex(/^[0-9a-f]{7}$/),
  quote: z.string().min(1).optional(),
});

export type Citation = z.infer<typeof CitationSchema>;

// ---------------------------------------------------------------------------
// Claim kinds — discriminated union on "kind"
// ---------------------------------------------------------------------------

/** Memory claim — asserted fact from the ledger; requires ≥1 citation */
export const MemoryClaimSchema = z.object({
  kind: z.literal('memory'),
  text: z.string().min(1),
  citations: z.array(CitationSchema).min(1),
});
export type MemoryClaim = z.infer<typeof MemoryClaimSchema>;

/** Speculation claim — inference beyond the ledger; requires ≥1 citation */
export const SpeculationClaimSchema = z.object({
  kind: z.literal('speculation'),
  text: z.string().min(1),
  citations: z.array(CitationSchema).min(1),
});
export type SpeculationClaim = z.infer<typeof SpeculationClaimSchema>;

/** Silence claim — no evidence; requires exactly 0 citations and a reason */
export const SilenceClaimSchema = z.object({
  kind: z.literal('silence'),
  text: z.string().min(1),
  citations: z.array(CitationSchema).length(0),
  silenceReason: z.string().min(1),
});
export type SilenceClaim = z.infer<typeof SilenceClaimSchema>;

export const ClaimSchema = z.discriminatedUnion('kind', [
  MemoryClaimSchema,
  SpeculationClaimSchema,
  SilenceClaimSchema,
]);

export type Claim = z.infer<typeof ClaimSchema>;

// ---------------------------------------------------------------------------
// GhostAnswer — structured output from the LLM ghost persona
// ---------------------------------------------------------------------------

export const GhostAnswerSchema = z.object({
  claims: z.array(ClaimSchema).min(1),
  voice: z.string().min(1),
  sessionId: z.string().min(1),
});

export type GhostAnswer = z.infer<typeof GhostAnswerSchema>;

// ---------------------------------------------------------------------------
// VerifierResult — output of the deterministic Verifier
// ---------------------------------------------------------------------------

export const VerifiedClaimSchema = z.object({
  claim: ClaimSchema,
  speculative: z.boolean(),
});
export type VerifiedClaim = z.infer<typeof VerifiedClaimSchema>;

export const RejectedClaimSchema = z.object({
  claim: ClaimSchema,
  reason: z.string(),
});
export type RejectedClaim = z.infer<typeof RejectedClaimSchema>;

export const VerifierResultSchema = z.object({
  verified: z.array(VerifiedClaimSchema),
  rejected: z.array(RejectedClaimSchema),
  score: z.number().min(0).max(1),
});

export type VerifierResult = z.infer<typeof VerifierResultSchema>;

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export const SummonResponseSchema = z.object({
  sessionId: z.string().uuid(),
  ledgerSize: z.number().int().nonnegative(),
  truncated: z.boolean(),
  buildDurationMs: z.number().nonnegative(),
});

export type SummonResponse = z.infer<typeof SummonResponseSchema>;

export const VerifiedAnswerResponseSchema = z.object({
  sessionId: z.string(),
  voice: z.string(),
  verified: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(['memory', 'speculation', 'silence']),
      citations: z.array(CitationSchema),
      speculative: z.boolean(),
    }),
  ),
  rejected: z.array(
    z.object({
      text: z.string(),
      kind: z.string(),
      reason: z.string(),
    }),
  ),
  score: z.number().min(0).max(1),
});

export type VerifiedAnswerResponse = z.infer<typeof VerifiedAnswerResponseSchema>;
