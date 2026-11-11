/**
 * messages.ts — the fixed sentences of the MCP tools (seance-mcp design.md §3.4).
 *
 * Imports nothing, so repo.ts and tools.ts can both use it. No sentence contains a path.
 * HISTORY_ERROR and GIT_ERROR repeat the web app's sentences.
 */

export const MESSAGES = {
  REPO_REMOTE:
    'seance_summon and seance_haunting_map read local repositories only. Clone the repository and pass its local path.',
  REPO_NOT_DIRECTORY: 'The repo path is not a directory that exists.',
  REPO_NOT_GIT:
    'The repo path is not inside a git work tree. Pass the path of a checked-out repository.',
  LEDGER_UNKNOWN:
    'This server holds no ledger with that id. Call seance_summon again: the server keeps the 50 most recent ledgers and forgets them when it stops.',
  HISTORY_ERROR:
    'Git could not read the history of these lines in time. Try a smaller range, or try again.',
  GIT_ERROR:
    'Git could not read that file and line range. Check the file path and the line numbers.',
  INTERNAL:
    'Séance hit an unexpected error. The details are in the server log on stderr.',
} as const;

export type MessageKey = keyof typeof MESSAGES;
