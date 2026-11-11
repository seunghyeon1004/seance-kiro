---
inclusion: fileMatch
fileMatchPattern: 'src/mcp/**'
---

# Séance — MCP Server Steering

Applies to `src/mcp/`. The server exposes Séance's ledger and ward to other agents over stdio. Start it with `npm run --silent mcp` or `npx -y tsx src/mcp/server.ts`.

## Stdout is the protocol

- Stdout carries MCP protocol messages only. All logs go to stderr with `console.error` and a `[seance:mcp]` prefix.
- `src/mcp/server.ts` calls `installStderrConsole()` before anything else and loads every other module with a dynamic `import()` afterwards, because static imports would run code before the reroute (`git.ts` runs `which git` at load). Keep it that way; never add a static import above it.
- `console.ts` imports nothing. Never write to `process.stdout` directly.

## No model, no network

- The server never calls a model and never makes a network request: no `src/ghost/llm.ts`, no `src/evidence/github.ts`, no Anthropic SDK, no `fetch`, no clone. `test/mcp/imports.test.ts` walks the import graph from `server.ts`; keep it passing.

## Local repositories only

- `resolveLocalRepo` (`repo.ts`) refuses `scheme://…` and `user@host:path` before touching the filesystem, then requires an existing directory inside a git work tree, symbolic links resolved.
- Errors are the fixed sentences in `messages.ts`. No sentence contains a path, a command line or git stderr; those go only to stderr. Every handler returns its own result, so the SDK never turns a raw error into a tool result.

## Tools are stable API

- The tool names `seance_summon`, `seance_verify` and `seance_haunting_map`, their argument names and their output shapes are a public API. Never rename or remove one; add a new optional field or a new tool instead.
- Tools only: no resources, no prompts. `SERVER_VERSION` equals `package.json` `version`.

## The ward decides

- Tool input is validated with Zod (`SummonInputShape`, `VerifyInputShape`, `HauntingInputShape` in `tools.ts`), and output has its own schemas.
- `seance_verify` runs the claims through the same `verify()` and `renderWardReport()` as the web app. The input schema is lenient on purpose (an optional quote, citations defaulting to `[]`) so the ward strikes a bad claim with its own reason.
- The server adds no acceptance of its own: never mark a claim verified, drop a reason, or relax a check outside `src/ghost/verifier.ts`.

## Ledgers in memory only

- `LedgerStore` keeps at most 50 frozen ledgers under random UUIDs, evicting the oldest. Nothing is written to disk, and the repository root is not stored.

## Dependencies

- `@modelcontextprotocol/sdk` is pinned to an exact version in `package.json`. Change it only with a spec decision and the `test/mcp/` suite passing.
