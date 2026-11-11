/**
 * server.ts — entry of the Séance MCP server on stdio (seance-mcp R1, design.md §4.6).
 *
 * Start with `npx -y tsx src/mcp/server.ts` or `npm run --silent mcp`. Console output is
 * routed to stderr first; every other module is imported dynamically afterwards, because
 * static imports would run (git.ts runs `which git` at load) before the reroute (R1.6).
 *
 * seance-mcp R13.1, R13.2 (inquisitor second pass, 2026-11-11): before any other module loads,
 * every git subprocess of this process is told never to fetch a missing object from a promisor
 * remote and never to prompt, so a local partial clone cannot make the server reach the network.
 * Only this entry sets them; the web server keeps lazy fetch for its own blob-less clones.
 */

import { installStderrConsole } from './console.js';

process.env['GIT_NO_LAZY_FETCH'] = '1';
process.env['GIT_TERMINAL_PROMPT'] = '0';
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
