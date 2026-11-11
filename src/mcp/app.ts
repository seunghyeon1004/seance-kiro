/**
 * app.ts — the Séance MCP server: three tools on the official SDK (seance-mcp design.md §4.5).
 *
 * Tools only, no resources and no prompts. Every handler returns its own result, so the SDK
 * never turns a raw error message (which could hold a path) into a tool result.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  HAUNTING_DESCRIPTION,
  HauntingInputShape,
  HauntingOutputShape,
  MAX_TOOL_INPUT_ELEMENTS,
  SUMMON_DESCRIPTION,
  SummonInputShape,
  SummonOutputShape,
  VERIFY_DESCRIPTION,
  VerifyInputShape,
  VerifyOutputShape,
  hauntingMapTool,
  summonTool,
  verifyTool,
  withDefaultDeps,
  type ToolDeps,
  type ToolOutcome,
} from './tools.js';

export const SERVER_NAME = 'seance';
export const SERVER_VERSION = '0.1.0'; // equals package.json "version"; a test checks it

/** Success: the JSON text and structuredContent. Failure: one sentence, isError (R7.1, R7.2). */
export function toCallToolResult<T extends Record<string, unknown>>(
  outcome: ToolOutcome<T>,
): CallToolResult {
  if (outcome.ok) {
    return {
      content: [{ type: 'text', text: JSON.stringify(outcome.value) }],
      structuredContent: outcome.value,
    };
  }
  return { content: [{ type: 'text', text: outcome.message }], isError: true };
}

export function createSeanceMcpServer(deps: Partial<ToolDeps> = {}): McpServer {
  const toolDeps = withDefaultDeps(deps);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS },
  );

  server.registerTool(
    'seance_summon',
    {
      title: 'Summon the evidence ledger',
      description: SUMMON_DESCRIPTION,
      inputSchema: SummonInputShape,
      outputSchema: SummonOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => toCallToolResult(await summonTool(args, toolDeps)),
  );

  server.registerTool(
    'seance_verify',
    {
      title: 'Check claim citations with the ward',
      description: VERIFY_DESCRIPTION,
      inputSchema: VerifyInputShape,
      outputSchema: VerifyOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => toCallToolResult(verifyTool(args, toolDeps)),
  );

  server.registerTool(
    'seance_haunting_map',
    {
      title: 'Read the haunting map',
      description: HAUNTING_DESCRIPTION,
      inputSchema: HauntingInputShape,
      outputSchema: HauntingOutputShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => toCallToolResult(await hauntingMapTool(args, toolDeps)),
  );

  return server;
}

/** Serve on stdio until stdin closes or SIGINT/SIGTERM arrives, then exit 0 (R1.7). */
export async function startStdioServer(): Promise<void> {
  const server = createSeanceMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void server
      .close()
      .catch((err: unknown) => {
        console.error(
          '[seance:mcp] close failed',
          err instanceof Error ? err.message : String(err),
        );
      })
      .finally(() => process.exit(0));
  };
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.error('[seance:mcp] ready (3 tools)');
}
