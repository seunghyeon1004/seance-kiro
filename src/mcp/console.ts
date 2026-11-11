/**
 * console.ts — keep stdout for protocol messages (seance-mcp R1.6, design.md §4.4).
 *
 * Imports nothing, so the entry can run it before any other module is evaluated.
 */

/** Route console.log, console.info and console.debug to stderr (R1.6). Idempotent. */
export function installStderrConsole(): void {
  const toStderr = (...args: unknown[]): void => {
    console.error(...args);
  };
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
}
