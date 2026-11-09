# Kiro evidence

Every file here is CLI output from a real run in this repository. The only edits: the home directory prefix is replaced with `~`, scratch paths with `<scratch>`, and in the Crew file the gateway's dashboard auth token lines are removed. No emails, tokens or absolute home paths remain (checked with grep; `test@example.com` is a fixture value inside generated test code).

| File | Date, tool | What it shows |
| ---- | ---------- | ------------- |
| `review-and-mcp-session.txt` | 2026-11-06, Kiro CLI 3.0.0 | The `/review-evidence` prompt hook (`.kiro/hooks/evidence-review.json`) reviewing a real staged diff against `.kiro/steering/evidence-rules.md`, and a call through the git MCP server (`@git/git_log`). Only lines starting with `[INFO]` come from the CLI's own logger. |
| `powers-context7-session.txt` | 2026-11-09, Kiro CLI 3.1.0 | `kiro-cli powers install context7`, the V3 `/powers` listing, a V2 run that did not see the power but wrote the `secureHeaders` change and test, and a V3 run where `kiro_powers` activated the power but its MCP server was not connected. Commit `a4fb03c`. |
| `crew-parallel-session.txt` | 2026-11-09, Kiro Crew 0.12.0 | Crew install through `kiro-cli crew -y`, a local gateway, two `kirocrew spawn run` subagents in parallel (skip link; plan prompt property tests). Commit `5dcd8f2`. |
| `ward-report-spec-session.txt` | 2026-11-09, Kiro CLI 3.1.0 | Kiro implementing T1 and T2 of `.kiro/specs/ward-report` and running vitest and tsc. One unused variable was then removed by hand for eslint. Commit `264a8da`. |

## Credits

Free plan, 50 credits a month. The 2026-11-09 runs used about 4.6 credits in total (3.37 used before, 7.92 after, read with `/usage`; the meter settles a few minutes late). One V3 run is not in the files above: its tool permissions were denied because V3 uses different tool ids (`run_command`, `kiro_powers`) than V2 (`execute_bash`); the rerun with the right ids is in `powers-context7-session.txt`.

## Not proven

- Context7 documentation was never actually fetched through the power (MCP server not connected).
- The save hooks have not been seen firing.
- Kiro Crew ran with `--approval yolo` in an isolated home; its dashboard was not opened.
