/**
 * server.ts — entry of the Séance MCP server on stdio (seance-mcp R1, design.md §4.6).
 *
 * Start with `npx -y tsx src/mcp/server.ts` or `npm run --silent mcp`. Console output is
 * routed to stderr first; every other module is imported dynamically afterwards, because
 * static imports would run (git.ts runs `which git` at load) before the reroute (R1.6).
 */

import { installStderrConsole } from './console.js';

installStderrConsole();
try {
  const { startStdioServer } = await import('./app.js');
  await startStdioServer();
} catch (err) {
  console.error(
    '[seance:mcp] could not start',
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
}
