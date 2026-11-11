// ---------------------------------------------------------------------------
// Error taxonomy for Séance
// ---------------------------------------------------------------------------

export class SeanceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = this.constructor.name;
    // Maintains proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** Input failed Zod validation, path-traversal check, or range check. */
export class ValidationError extends SeanceError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message);
  }
}

/** A git subprocess exited non-zero or timed out. */
export class GitError extends SeanceError {
  constructor(message: string) {
    super('GIT_ERROR', message);
  }
}

/** Remote clone exceeded size or time cap. */
export class CloneError extends SeanceError {
  constructor(message: string) {
    super('CLONE_ERROR', message);
  }
}

/** URL resolved to a host other than api.github.com. */
export class SsrfError extends SeanceError {
  constructor(message: string) {
    super('SSRF_ERROR', message);
  }
}

/** Internal: git output failed the Zod parse (item is skipped, not fatal). */
export class ParseError extends SeanceError {
  constructor(message: string) {
    super('PARSE_ERROR', message);
  }
}

/** Missing or empty ANTHROPIC_API_KEY (or other required configuration). */
export class ConfigError extends SeanceError {
  constructor(message: string) {
    super('CONFIG_ERROR', message);
  }
}

/** LLM call exceeded LLM_TIMEOUT_MS or LLM_PLAN_TIMEOUT_MS (first-seance design.md §4.1). */
export class TimeoutError extends SeanceError {
  constructor(message: string) {
    super('TIMEOUT', message);
  }
}

/** `git log -L` failed or timed out (R8.1). Not a GitError, so the server maps it first. */
export class HistoryError extends SeanceError {
  constructor(message: string) {
    super('HISTORY_ERROR', message);
  }
}

/** Anthropic 401, 403 or 404: wrong key or model name. */
export class ModelConfigError extends SeanceError {
  constructor(message: string) {
    super('MODEL_CONFIG', message);
  }
}

/** Anthropic 429, 529, 5xx, or a connection error. */
export class ModelBusyError extends SeanceError {
  constructor(message: string) {
    super('MODEL_BUSY', message);
  }
}

/** Unknown or expired sessionId. */
export class SessionNotFoundError extends SeanceError {
  constructor(message: string) {
    super('SESSION_NOT_FOUND', message);
  }
}
