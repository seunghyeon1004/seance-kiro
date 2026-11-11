/**
 * seance-mcp T1 — console output goes to stderr (R1.6, design.md §4.4).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Console } from 'node:console';
import { installStderrConsole } from '../../src/mcp/console.js';

const originals = {
  log: console.log,
  info: console.info,
  debug: console.debug,
  warn: console.warn,
  error: console.error,
};

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    err.push(String(chunk));
    return true;
  });
  // Vitest intercepts the global console; put back Node's own, as the server process has it
  const node = new Console({ stdout: process.stdout, stderr: process.stderr });
  console.log = node.log.bind(node);
  console.info = node.info.bind(node);
  console.debug = node.debug.bind(node);
  console.warn = node.warn.bind(node);
  console.error = node.error.bind(node);
});

afterEach(() => {
  vi.restoreAllMocks();
  console.log = originals.log;
  console.info = originals.info;
  console.debug = originals.debug;
  console.warn = originals.warn;
  console.error = originals.error;
});

describe('installStderrConsole', () => {
  it('routes console.log, info and debug to stderr, never stdout', () => {
    installStderrConsole();
    console.log('one');
    console.info('two');
    console.debug('three');
    expect(out).toEqual([]);
    expect(err.join('')).toContain('one');
    expect(err.join('')).toContain('two');
    expect(err.join('')).toContain('three');
  });

  it('keeps console.warn and console.error as they are', () => {
    const warn = console.warn;
    const error = console.error;
    installStderrConsole();
    expect(console.warn).toBe(warn);
    expect(console.error).toBe(error);
  });

  it('is idempotent: calling it twice writes each line once, to stderr', () => {
    installStderrConsole();
    installStderrConsole();
    console.log('once');
    expect(out).toEqual([]);
    expect(err.join('').split('once').length - 1).toBe(1);
  });
});
