# Kiro evidence

Every file here is CLI output from a real run in this repository. The only edits: the home directory prefix is replaced with `~`, scratch paths with `<scratch>`, and in the Crew file the gateway's dashboard auth token lines are removed. No emails, tokens or absolute home paths remain (checked with grep; `test@example.com` is a fixture value inside generated test code).

| File | Date, tool | What it shows |
| ---- | ---------- | ------------- |
| `review-and-mcp-session.txt` | 2026-11-06, Kiro CLI 3.0.0 | The `/review-evidence` prompt hook (`.kiro/hooks/evidence-review.json`) reviewing a real staged diff against `.kiro/steering/evidence-rules.md`, and a call through the git MCP server (`@git/git_log`). Only lines starting with `[INFO]` come from the CLI's own logger. |
| `powers-context7-session.txt` | 2026-11-09, Kiro CLI 3.1.0 | `kiro-cli powers install context7`, the V3 `/powers` listing, a V2 run that did not see the power but wrote the `secureHeaders` change and test, and a V3 run where `kiro_powers` activated the power but its MCP server was not connected. Commit `a4fb03c`. |
| `crew-parallel-session.txt` | 2026-11-09, Kiro Crew 0.12.0 | Crew install through `kiro-cli crew -y`, a local gateway, two `kirocrew spawn run` subagents in parallel (skip link; plan prompt property tests). Commit `5dcd8f2`. |
| `ward-report-spec-session.txt` | 2026-11-09, Kiro CLI 3.1.0 | Kiro implementing T1 and T2 of `.kiro/specs/ward-report` and running vitest and tsc. One unused variable was then removed by hand for eslint. Commit `264a8da`. |
| `ward-report-t3-session.txt` | 2026-11-09, Kiro CLI 3.1.0 | Kiro implementing ward-report T3 (report field on the API, Copy ward report button) and running npm test, tsc and lint. Commit `9c547f3`. |
| `archaeologist-review-session.txt` | 2026-11-09, Kiro CLI 3.1.0 V3 | The archaeologist custom agent reviewing `src/` against the specs. It found that `/api/summon` accepted `endLine < startLine` (R9.2). Its git calls were denied, so it cites no commits. |
| `warden-hooks-session.txt`, `warden-hook-fires.log` | 2026-11-09, Kiro CLI 3.1.0 V2 | The warden custom agent fixing that defect, test first. Run 1 was denied (agent `allowedTools` too narrow) and its summary invented results. Run 2 succeeded, and its `postToolUse` and `stop` hooks wrote the log. Commit `1d4ada1`. |
| `mcp-filesystem-fix-session.txt` | 2026-11-09, Kiro CLI 3.1.0 | Kiro diagnosing the broken filesystem MCP server (`uvx` cannot resolve the package), pinning the npm package, then calling `@filesystem/list_directory` and `@filesystem/read_text_file`. Commit `b5e677f`. |
| `rate-limit-session.txt` | 2026-11-09, Kiro CLI 3.1.0 V2 | The warden agent implementing `model-rate-limit` T1 and T2. Pruning and the socket-address fallback were added by hand. Commit `d64c7a9`. |
| `spooky-ui-audit.md`, `spooky-ui-completion-session.txt` | 2026-11-09, Kiro CLI 3.1.0 V2 | Kiro's audit of the hand-written UI against all 52 `spooky-ui` requirements. Then the warden agent's fixes and UI tests (ended by a service throttle; two retries failed the same way), the hand revert of P13, and Kiro ticking only the 4 task items it verified. Commits `66684ce`, `1c0044d`. |
| `spooky-ui-round2-session.txt` | 2026-11-09, Kiro CLI 3.1.0 V2 | The warden agent adding the visible spooky-ui requirements (severity label, badges, collapsible steps, session counter, exorcism status, contrast check). The session ended on a throttle. Then Kiro (haiku) rewrote `tasks.md` to the real files, and the ticks were reviewed by hand. Commits `3c19ed7`, `86c2c89`. |
| `exorcism-tasks-verify-session.txt` | 2026-11-09, Kiro CLI 3.1.0 V2 (qwen3-coder-next) | Kiro checking every exorcism-plan task against the code and ticking 41. Its open items were in a broken format and were fixed by hand; the T8 checks were verified by hand. Commit `70ae764`. |
| `exorcism-t6-t7-session.txt` | 2026-11-09, Kiro CLI 3.1.0 V2 (warden, haiku) | Kiro writing the `/api/exorcise` API tests and the plan fixture loader and fixture. In review I restored the model-output schema, which Kiro had loosened while fixing a real bug, and rewrote its fixture test, which had mocked the loader. |

## Credits

Free plan, 50 credits a month, read with `/usage` (the meter settles a few minutes late). First round on 2026-11-09: 3.37 to 7.92. Second round (T3, archaeologist review, warden fix, MCP fix): 7.92 to 16.78. Rate limit: 16.78 to 21.75. spooky-ui audit and completion: 21.75 to 31.61. spooky-ui visible requirements and tasks rewrite: 31.61 to 41.52. exorcism-plan verification, T6 and T7: 41.62 to 48.58. One V3 run is not in the files above: its tool permissions were denied because V3 uses different tool ids (`run_command`, `kiro_powers`) than V2 (`execute_bash`); the rerun with the right ids is in `powers-context7-session.txt`.

## Not proven

- Context7 documentation was never actually fetched through the power (MCP server not connected).
- The IDE save hooks (`PostFileSave`) have not been seen firing. The CLI agent hooks in `warden.json` have (`postToolUse`, `stop`). `agentSpawn` has not.
- Kiro Crew ran with `--approval yolo` in an isolated home; its dashboard was not opened.
