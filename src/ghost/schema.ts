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
  report: z.string(),
});

export type VerifiedAnswerResponse = z.infer<typeof VerifiedAnswerResponseSchema>;

// ── Exorcism score types ─────────────────────────────────────────────────────

export const SignalNameSchema = z.enum([
  'age',
  'churn',
  'gone',
  'marker',
  'test',
  'nesting',
]);
export type SignalName = z.infer<typeof SignalNameSchema>;

export const SignalBreakdownSchema = z.object({
  signal: SignalNameSchema,
  rawValue: z.number().min(0).max(1),
  weightedContribution: z.number().min(0).max(25),
});
export type SignalBreakdown = z.infer<typeof SignalBreakdownSchema>;

export const MarkerLocationSchema = z.object({
  sha7: z
    .string()
    .length(7)
    .regex(/^[0-9a-f]{7}$/),
  lineText: z.string().max(256),
});
export type MarkerLocation = z.infer<typeof MarkerLocationSchema>;

export const ScoreInputSchema = z.object({
  authorGoneThresholdDays: z.number().int().positive().default(365),
  nowMs: z.number().int().positive(),
});
export type ScoreInput = z.infer<typeof ScoreInputSchema>;

export const ScoredResultSchema = z.object({
  score: z.number().int().min(0).max(100),
  signalBreakdown: z.array(SignalBreakdownSchema).length(6),
  markerLocations: z.array(MarkerLocationSchema),
});
export type ScoredResult = z.infer<typeof ScoredResultSchema>;

// ── Exorcism plan types ──────────────────────────────────────────────────────

export const RefactorStepSchema = z.object({
  description: z.string().min(1).max(512),
  rationale: z.string().min(1).max(256),
  claims: z.array(ClaimSchema).min(1),
  rejectedClaims: z.array(ClaimSchema).default([]),
  reversible: z.boolean(),
});
export type RefactorStep = z.infer<typeof RefactorStepSchema>;

export const DoNotTouchEntrySchema = z.object({
  lineRange: z
    .object({
      start: z.number().int().positive(),
      end: z.number().int().positive(),
    })
    .refine((r) => r.end >= r.start, { message: 'end must be >= start' }),
  reason: z.string().min(1).max(512),
  claims: z.array(ClaimSchema).min(1),
  rejectedClaims: z.array(ClaimSchema).default([]),
});
export type DoNotTouchEntry = z.infer<typeof DoNotTouchEntrySchema>;

export const RefactorPlanSchema = z.object({
  characterizationTests: z.array(z.string().min(1).max(512)).min(1),
  steps: z.array(RefactorStepSchema).min(1),
  doNotTouchList: z.array(DoNotTouchEntrySchema),
  summary: z.string().min(1).max(1024),
});
export type RefactorPlan = z.infer<typeof RefactorPlanSchema>;

// After Verifier runs, rejectedClaims are populated
export const VerifiedRefactorPlanSchema = RefactorPlanSchema.extend({
  verifierScore: z.number().min(0).max(1),
});
export type VerifiedRefactorPlan = z.infer<typeof VerifiedRefactorPlanSchema>;

// ── API response ─────────────────────────────────────────────────────────────

export const ExorciseRequestSchema = z.object({
  sessionId: z.string().min(1),
  authorGoneThresholdDays: z.number().int().positive().optional(),
});
export type ExorciseRequest = z.infer<typeof ExorciseRequestSchema>;

export const ExorciseResponseSchema = z.object({
  sessionId: z.string().uuid(),
  score: z.number().int().min(0).max(100),
  signalBreakdown: z.array(SignalBreakdownSchema).length(6),
  markerLocations: z.array(MarkerLocationSchema),
  plan: z.object({
    characterizationTests: z.array(z.string()),
    steps: z.array(RefactorStepSchema),
    doNotTouchList: z.array(DoNotTouchEntrySchema),
    summary: z.string(),
  }),
  verifierScore: z.number().min(0).max(1),
});
export type ExorciseResponse = z.infer<typeof ExorciseResponseSchema>;
