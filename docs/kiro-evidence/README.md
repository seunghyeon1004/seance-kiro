# Kiro evidence

`review-and-mcp-session.txt` is the unedited output of one Kiro CLI 3.0.0 session (2026-11-06) run in this repository with a real staged diff (`.kiro/README.md`):

1. The `/review-evidence` prompt hook (`.kiro/hooks/evidence-review.json`) fired: Kiro read `git diff --cached`, checked it against the invariants in `.kiro/steering/evidence-rules.md` and reported no violations.
2. A real call through the git MCP server (`.kiro/settings/mcp.json`): the tool `@git/git_log` listed the five latest commits.

Only the lines starting with `[INFO]` come from the CLI's own logger. No emails, tokens or absolute paths appear in the file (checked with grep).
