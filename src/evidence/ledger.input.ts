import { z } from 'zod';
import { ValidationError } from '../errors.js';

// ---------------------------------------------------------------------------
// GitHub URL allowlist pattern (R8.1)
// ---------------------------------------------------------------------------
const GITHUB_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;

// ---------------------------------------------------------------------------
// LedgerInputSchema (R9.1, R9.2, R9.3, R8.1)
// ---------------------------------------------------------------------------

/** Repository-relative file path — must not contain ".." or be absolute */
export const FileSchema = z
  .string()
  .min(1)
  .refine((f) => !f.includes('..'), {
    message: 'file path must not contain ".." path-traversal sequences',
  })
  .refine((f) => !f.startsWith('/'), {
    message: 'file path must be relative, not absolute',
  });

/** If `repoUrl` looks like a URL, it must match the GitHub allowlist (R8.1). */
export function checkRemoteUrl(
  val: { readonly repoUrl: string },
  ctx: z.RefinementCtx,
): void {
  if (val.repoUrl.startsWith('http://') || val.repoUrl.startsWith('https://')) {
    if (!GITHUB_URL_RE.test(val.repoUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['repoUrl'],
        message:
          'remote URLs must match https://github.com/<owner>/<repo>[.git] — other hosts are not allowed',
      });
    }
  }
}

export const LedgerInputSchema = z
  .object({
    /** Local filesystem path or https://github.com/... URL */
    repoUrl: z.string().min(1),
    file: FileSchema,
    /** 1-indexed start line (inclusive) */
    startLine: z.number().int().min(1),
    /** 1-indexed end line (inclusive); max width 500 lines */
    endLine: z.number().int().min(1),
    /** Optional GitHub personal-access token for PR/issue enrichment */
    githubToken: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    // end >= start
    if (val.endLine < val.startLine) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endLine'],
        message: `endLine (${val.endLine}) must be >= startLine (${val.startLine})`,
      });
    }

    // max 500-line range
    if (val.endLine - val.startLine > 499) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endLine'],
        message: `line range must not exceed 500 lines (got ${val.endLine - val.startLine + 1})`,
      });
    }

    checkRemoteUrl(val, ctx);
  });

export type LedgerInput = z.infer<typeof LedgerInputSchema>;

// ---------------------------------------------------------------------------
// Exported validator
// ---------------------------------------------------------------------------

/**
 * Validate raw input and return a typed LedgerInput.
 * Throws ValidationError on any failure (never reaches the git layer).
 */
export function validateLedgerInput(raw: unknown): LedgerInput {
  const result = LedgerInputSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join('; ');
    throw new ValidationError(messages);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// WholeFileInputSchema (haunting-map R6.3, design.md §6.1)
// ---------------------------------------------------------------------------

/** "Summon here": the whole file at HEAD, with the same file, repository and token rules. */
export const WholeFileInputSchema = z
  .object({
    repoUrl: z.string().min(1),
    file: FileSchema,
    wholeFile: z.literal(true),
    githubToken: z.string().optional(),
  })
  .superRefine(checkRemoteUrl);

export type WholeFileInput = z.infer<typeof WholeFileInputSchema>;

/** Throws ValidationError, like validateLedgerInput (R6.3). */
export function validateWholeFileInput(raw: unknown): WholeFileInput {
  const result = WholeFileInputSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join('; ');
    throw new ValidationError(messages);
  }
  return result.data;
}
