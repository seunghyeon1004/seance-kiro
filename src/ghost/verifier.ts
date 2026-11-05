/**
 * verifier.ts — deterministic ward that checks every claim against the ledger.
 *
 * Pure function; no I/O. Same ledger + same answer → same result every time.
 */

import type { EvidenceItem } from './schema.js';
import type {
  GhostAnswer,
  VerifiedClaim,
  RejectedClaim,
  VerifierResult,
} from './schema.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify every claim in `answer` against the evidence `ledger`.
 *
 * @param ledger - Read-only array of EvidenceItems (frozen by buildLedger).
 * @param answer - Parsed GhostAnswer from the LLM.
 * @returns Frozen VerifierResult with verified[], rejected[], and a score in [0, 1].
 */
export function verify(
  ledger: ReadonlyArray<EvidenceItem>,
  answer: GhostAnswer,
): VerifierResult {
  // Build a shortSha → EvidenceItem map once per call (do not mutate it)
  const shortShaMap = new Map<string, EvidenceItem>();
  for (const item of ledger) {
    shortShaMap.set(item.shortSha, item);
  }

  const verified: VerifiedClaim[] = [];
  const rejected: RejectedClaim[] = [];

  // Process claims in order, preserving insertion order in both buckets
  for (const claim of answer.claims) {
    if (claim.kind === 'silence') {
      const result = verifySilence(claim);
      if (result.ok) {
        verified.push({ claim, speculative: false });
      } else {
        rejected.push({ claim, reason: result.reason });
      }
    } else {
      // "memory" or "speculation"
      const result =
        claim.kind === 'speculation'
          ? verifySpeculation(claim, shortShaMap)
          : verifyMemory(claim, shortShaMap);

      if (result.ok) {
        verified.push({ claim, speculative: claim.kind === 'speculation' });
      } else {
        rejected.push({ claim, reason: result.reason });
      }
    }
  }

  const total = verified.length + rejected.length;
  const score = total === 0 ? 1 : verified.length / total;

  return Object.freeze({ verified, rejected, score });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

type CheckResult = { ok: true } | { ok: false; reason: string };

/**
 * Verify a memory claim: all citations must have (a) a SHA present in the ledger,
 * and (b) when a quote is provided it must be a case-sensitive substring of the
 * combined evidence text.
 */
function verifyMemory(
  claim: { citations: Array<{ sha7: string; quote?: string | undefined }> },
  shortShaMap: Map<string, EvidenceItem>,
): CheckResult {
  return verifyCitations(claim.citations, shortShaMap);
}

/**
 * Verify a speculation claim: same citation checks as memory; result is flagged
 * speculative=true at the caller level.
 */
function verifySpeculation(
  claim: { citations: Array<{ sha7: string; quote?: string | undefined }> },
  shortShaMap: Map<string, EvidenceItem>,
): CheckResult {
  return verifyCitations(claim.citations, shortShaMap);
}

/**
 * Verify a silence claim: pass when silenceReason is non-empty (already guaranteed
 * by the Zod schema, but we enforce it here for defence-in-depth).
 */
function verifySilence(claim: { silenceReason: string }): CheckResult {
  if (claim.silenceReason.length > 0) {
    return { ok: true };
  }
  return { ok: false, reason: 'silence claim missing silenceReason' };
}

/**
 * Shared citation verification for memory and speculation claims.
 * Collects all failure reasons; rejects if any reason is collected.
 */
function verifyCitations(
  citations: Array<{ sha7: string; quote?: string | undefined }>,
  shortShaMap: Map<string, EvidenceItem>,
): CheckResult {
  const reasons: string[] = [];

  for (const citation of citations) {
    const item = shortShaMap.get(citation.sha7);
    if (item === undefined) {
      reasons.push(`sha7 "${citation.sha7}" not found in ledger`);
      continue;
    }

    if (citation.quote !== undefined) {
      const evidenceText = `${item.subject} ${item.body} ${item.hunk}`;
      if (!evidenceText.includes(citation.quote)) {
        reasons.push(`quote not found in evidence ${citation.sha7}`);
      }
    }
  }

  if (reasons.length === 0) {
    return { ok: true };
  }
  return { ok: false, reason: reasons.join('; ') };
}
