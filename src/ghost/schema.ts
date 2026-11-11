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
// Ward constants (ward-hardening design.md §3)
// ---------------------------------------------------------------------------

export const QUOTE_MIN_CHARS = 8; // after trim()
export const QUOTE_MAX_CHARS = 500; // untrimmed length
export const SILENCE_MAX_CHARS = 300; // text and silenceReason
export const MAX_CLAIMS = 50; // per answer, and per plan step or entry
export const MAX_CITATIONS = 10; // per claim
export const HUNK_UI_CHARS = 4000; // hunk as sent to the browser, the prompt and the verifier

// ---------------------------------------------------------------------------
// Citation — one piece of evidence backing a claim
// ---------------------------------------------------------------------------

const Sha7Schema = z
  .string()
  .length(7)
  .regex(/^[0-9a-f]{7}$/);

export const QuoteSchema = z
  .string()
  .max(QUOTE_MAX_CHARS)
  .refine((q) => q.trim().length >= QUOTE_MIN_CHARS, {
    message: `quote must have at least ${QUOTE_MIN_CHARS} characters after trimming`,
  });

/** Strict citation: the quote is mandatory (R1.1). */
export const CitationSchema = z.object({ sha7: Sha7Schema, quote: QuoteSchema });

export type Citation = z.infer<typeof CitationSchema>;

// ---------------------------------------------------------------------------
// Claim kinds — discriminated union on "kind"
// ---------------------------------------------------------------------------

/** Memory claim — asserted fact from the ledger; requires 1–10 quoted citations */
export const MemoryClaimSchema = z.object({
  kind: z.literal('memory'),
  text: z.string().min(1),
  citations: z.array(CitationSchema).min(1).max(MAX_CITATIONS),
});
export type MemoryClaim = z.infer<typeof MemoryClaimSchema>;

/** Speculation claim — inference beyond the ledger; requires 1–10 quoted citations */
export const SpeculationClaimSchema = z.object({
  kind: z.literal('speculation'),
  text: z.string().min(1),
  citations: z.array(CitationSchema).min(1).max(MAX_CITATIONS),
});
export type SpeculationClaim = z.infer<typeof SpeculationClaimSchema>;

/** Silence claim — no evidence; exactly 0 citations, bounded text and a reason */
export const SilenceClaimSchema = z.object({
  kind: z.literal('silence'),
  text: z.string().min(1).max(SILENCE_MAX_CHARS),
  citations: z.array(CitationSchema).length(0),
  silenceReason: z.string().min(1).max(SILENCE_MAX_CHARS),
});
export type SilenceClaim = z.infer<typeof SilenceClaimSchema>;

export const ClaimSchema = z.discriminatedUnion('kind', [
  MemoryClaimSchema,
  SpeculationClaimSchema,
  SilenceClaimSchema,
]);

export type Claim = z.infer<typeof ClaimSchema>;
export type CheckedClaim = MemoryClaim | SpeculationClaim;

/**
 * Lenient shape, used only inside the verifier so that a missing or bad quote
 * produces a precise reason instead of a generic format error. Never used to accept a claim.
 */
export const ClaimShapeSchema = z.object({
  kind: z.enum(['memory', 'speculation', 'silence']),
  text: z.string().min(1),
  citations: z.array(
    z.object({ sha7: z.string().min(1).max(40), quote: z.string().optional() }),
  ),
  silenceReason: z.string().optional(),
});

// ---------------------------------------------------------------------------
// GhostAnswer — structured output from the LLM ghost persona
// ---------------------------------------------------------------------------

/** Strict, typed answer (tests and internal callers). */
export const GhostAnswerSchema = z.object({
  claims: z.array(ClaimSchema).min(1).max(MAX_CLAIMS),
  voice: z.string().min(1),
  sessionId: z.string().min(1),
});

export type GhostAnswer = z.infer<typeof GhostAnswerSchema>;

/** What the model and /api/ward send: the envelope is strict, and each claim is checked by the verifier (R1.8). */
export const GhostAnswerWireSchema = z.object({
  claims: z.array(z.unknown()).min(1).max(MAX_CLAIMS),
  voice: z.string().min(1),
  sessionId: z.string().min(1),
});

export type GhostAnswerWire = z.infer<typeof GhostAnswerWireSchema>;

// ---------------------------------------------------------------------------
// VerifierResult — output of the deterministic Verifier
// ---------------------------------------------------------------------------

export const QuoteFieldSchema = z.enum(['subject', 'body', 'hunk']);
export type QuoteField = z.infer<typeof QuoteFieldSchema>;

export const VerifiedQuoteSchema = z.object({
  sha7: Sha7Schema,
  quote: z.string(),
  field: QuoteFieldSchema,
});
export type VerifiedQuote = z.infer<typeof VerifiedQuoteSchema>;

export interface VerifiedClaim {
  /** Position in the input claims array */
  index: number;
  /** Memory or speculation only */
  claim: CheckedClaim;
  speculative: boolean;
  /** One per citation, same order */
  quotes: VerifiedQuote[];
}

export interface SilentClaim {
  index: number;
  claim: SilenceClaim;
}

export interface RejectedClaim {
  index: number;
  /** null when the claim did not match ClaimShapeSchema/ClaimSchema */
  claim: Claim | null;
  /** claim.kind, or the raw kind if it is a string of at most 32 chars, else "unknown" */
  kind: string;
  /** claim.text, or the raw text if it is a string, else "" */
  text: string;
  /** sha7 strings the claim tried to cite (used for citesSuspicious) */
  citedSha7s: string[];
  reason: string;
}

export interface VerifierResult {
  verified: VerifiedClaim[];
  rejected: RejectedClaim[];
  silent: SilentClaim[];
  /** verified / (verified + rejected + silent), 1 when empty (R4.4) */
  score: number;
}

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

export const ClaimResponseSchema = z.object({
  text: z.string(),
  kind: z.enum(['memory', 'speculation']),
  citations: z.array(CitationSchema),
  speculative: z.boolean(),
  quotes: z.array(VerifiedQuoteSchema).min(1),
  citesSuspicious: z.boolean(),
});
export type ClaimResponse = z.infer<typeof ClaimResponseSchema>;

export const RejectedResponseSchema = z.object({
  text: z.string(),
  kind: z.string(),
  reason: z.string(),
  citesSuspicious: z.boolean(),
});
export type RejectedResponse = z.infer<typeof RejectedResponseSchema>;

export const SilentResponseSchema = z.object({
  text: z.string(),
  silenceReason: z.string(),
});

export const TallySchema = z.object({
  verified: z.number().int().nonnegative(),
  checked: z.number().int().nonnegative(), // verified + rejected
  silent: z.number().int().nonnegative(),
});

export const VerifiedAnswerResponseSchema = z.object({
  sessionId: z.string().optional(), // present on /api/ask, absent on /api/ward
  voice: z.string(),
  verified: z.array(ClaimResponseSchema),
  rejected: z.array(RejectedResponseSchema),
  silent: z.array(SilentResponseSchema),
  tally: TallySchema,
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

// ── Plan (model output) ──────────────────────────────────────────────────────
// The refactor_plan tool input exactly as the model returns it (R7.7: no GhostAnswer
// envelope). The envelope is strict; each claim is checked on its own by the verifier
// (R7.3), so one malformed claim is struck instead of failing the whole plan.

export const RefactorStepSchema = z.object({
  description: z.string().min(1).max(512),
  rationale: z.string().min(1).max(256),
  claims: z.array(z.unknown()).min(1).max(MAX_CLAIMS),
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
  claims: z.array(z.unknown()).min(1).max(MAX_CLAIMS),
});
export type DoNotTouchEntry = z.infer<typeof DoNotTouchEntrySchema>;

export const RefactorPlanSchema = z.object({
  characterizationTests: z.array(z.string().min(1).max(512)).min(1),
  steps: z.array(RefactorStepSchema).min(1),
  doNotTouchList: z.array(DoNotTouchEntrySchema),
  summary: z.string().min(1).max(1024),
});
export type RefactorPlan = z.infer<typeof RefactorPlanSchema>;

// ── Plan (after the ward) ────────────────────────────────────────────────────

export const PlanStepResponseSchema = z.object({
  description: z.string(),
  rationale: z.string(),
  reversible: z.boolean(),
  claims: z.array(ClaimResponseSchema).min(1),
  rejectedClaims: z.array(RejectedResponseSchema),
});
export type PlanStepResponse = z.infer<typeof PlanStepResponseSchema>;

export const PlanDoNotTouchResponseSchema = z.object({
  lineRange: z.object({
    start: z.number().int().positive(),
    end: z.number().int().positive(),
  }),
  reason: z.string(),
  claims: z.array(ClaimResponseSchema).min(1),
  rejectedClaims: z.array(RejectedResponseSchema),
});
export type PlanDoNotTouchResponse = z.infer<typeof PlanDoNotTouchResponseSchema>;

export const PlanDroppedResponseSchema = z.object({
  kind: z.enum(['step', 'doNotTouch']),
  /** Step description, or "Line N" / "Lines A–B" */
  title: z.string(),
  /** Step rationale, or entry reason */
  modelText: z.string(),
  /** R7.1 / R7.2 fixed sentence */
  dropReason: z.string(),
  rejectedClaims: z.array(RejectedResponseSchema),
});
export type PlanDroppedResponse = z.infer<typeof PlanDroppedResponseSchema>;

export const PlanResponseSchema = z.object({
  characterizationTests: z.array(z.string()),
  /** May be empty when the ward kept no step */
  steps: z.array(PlanStepResponseSchema),
  doNotTouchList: z.array(PlanDoNotTouchResponseSchema),
  dropped: z.array(PlanDroppedResponseSchema),
  summary: z.string(),
});
export type PlanResponse = z.infer<typeof PlanResponseSchema>;

/** What buildPlan returns: the response plan plus the ward's plan score (R7.6). */
export interface VerifiedRefactorPlan extends PlanResponse {
  verifierScore: number;
}

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
  plan: PlanResponseSchema,
  verifierScore: z.number().min(0).max(1),
});
export type ExorciseResponse = z.infer<typeof ExorciseResponseSchema>;
