import { describe, it, expect } from 'vitest';
import { validateLedgerInput } from '../../src/evidence/ledger.input.js';
import { ValidationError } from '../../src/errors.js';

describe('validateLedgerInput', () => {
  const validLocal = {
    repoUrl: '/home/user/myrepo',
    file: 'src/utils.ts',
    startLine: 10,
    endLine: 20,
  };

  const validGitHub = {
    repoUrl: 'https://github.com/owner/repo',
    file: 'src/utils.ts',
    startLine: 1,
    endLine: 50,
  };

  it('accepts a valid local path input', () => {
    const result = validateLedgerInput(validLocal);
    expect(result.repoUrl).toBe('/home/user/myrepo');
    expect(result.startLine).toBe(10);
    expect(result.endLine).toBe(20);
  });

  it('accepts a valid GitHub URL input', () => {
    const result = validateLedgerInput(validGitHub);
    expect(result.repoUrl).toBe('https://github.com/owner/repo');
  });

  it('accepts a GitHub URL ending in .git', () => {
    const result = validateLedgerInput({ ...validGitHub, repoUrl: 'https://github.com/owner/repo.git' });
    expect(result.repoUrl).toBe('https://github.com/owner/repo.git');
  });

  it('accepts optional githubToken', () => {
    const result = validateLedgerInput({ ...validLocal, githubToken: 'ghp_abc123' });
    expect(result.githubToken).toBe('ghp_abc123');
  });

  // Bad line range ─────────────────────────────────────────────────────────

  it('rejects endLine < startLine', () => {
    expect(() => validateLedgerInput({ ...validLocal, startLine: 10, endLine: 5 })).toThrow(
      ValidationError,
    );
  });

  it('rejects endLine - startLine > 499 (501 lines)', () => {
    expect(() => validateLedgerInput({ ...validLocal, startLine: 1, endLine: 501 })).toThrow(
      ValidationError,
    );
  });

  it('accepts exactly 500 lines (startLine=1, endLine=500)', () => {
    const result = validateLedgerInput({ ...validLocal, startLine: 1, endLine: 500 });
    expect(result.endLine).toBe(500);
  });

  it('rejects startLine < 1', () => {
    expect(() => validateLedgerInput({ ...validLocal, startLine: 0 })).toThrow(ValidationError);
  });

  it('rejects non-integer startLine', () => {
    expect(() => validateLedgerInput({ ...validLocal, startLine: 1.5 })).toThrow(ValidationError);
  });

  // Path traversal ─────────────────────────────────────────────────────────

  it('rejects file path containing ".."', () => {
    expect(() => validateLedgerInput({ ...validLocal, file: '../../etc/passwd' })).toThrow(
      ValidationError,
    );
  });

  it('rejects absolute file path', () => {
    expect(() => validateLedgerInput({ ...validLocal, file: '/etc/passwd' })).toThrow(
      ValidationError,
    );
  });

  it('rejects file path with ".." in middle', () => {
    expect(() => validateLedgerInput({ ...validLocal, file: 'src/../../../secret' })).toThrow(
      ValidationError,
    );
  });

  // Non-GitHub URL ──────────────────────────────────────────────────────────

  it('rejects non-GitHub https URL', () => {
    expect(() =>
      validateLedgerInput({ ...validLocal, repoUrl: 'https://gitlab.com/owner/repo' }),
    ).toThrow(ValidationError);
  });

  it('rejects http:// GitHub URL (must be https)', () => {
    expect(() =>
      validateLedgerInput({ ...validLocal, repoUrl: 'http://github.com/owner/repo' }),
    ).toThrow(ValidationError);
  });

  it('rejects an arbitrary https URL', () => {
    expect(() =>
      validateLedgerInput({ ...validLocal, repoUrl: 'https://evil.com/payload' }),
    ).toThrow(ValidationError);
  });

  // Missing required fields ─────────────────────────────────────────────────

  it('rejects missing repoUrl', () => {
    const { repoUrl: _, ...rest } = validLocal;
    expect(() => validateLedgerInput(rest)).toThrow(ValidationError);
  });

  it('rejects missing file', () => {
    const { file: _, ...rest } = validLocal;
    expect(() => validateLedgerInput(rest)).toThrow(ValidationError);
  });

  it('rejects missing startLine', () => {
    const { startLine: _, ...rest } = validLocal;
    expect(() => validateLedgerInput(rest)).toThrow(ValidationError);
  });

  it('rejects missing endLine', () => {
    const { endLine: _, ...rest } = validLocal;
    expect(() => validateLedgerInput(rest)).toThrow(ValidationError);
  });

  it('rejects completely empty input', () => {
    expect(() => validateLedgerInput({})).toThrow(ValidationError);
  });
});
