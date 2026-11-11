# Séance: Devpost write-up (draft)

**Category:** Costume Contest
**Live demo:** https://seance-kiro.onrender.com
**Code:** https://github.com/seunghyeon1004/seance-kiro
**Tagline:** Ask the one who wrote it. A ghost that can only say what git remembers.

> **Draft status (2026-11-11).** This write-up describes the entry as submitted on 2026-11-09. Since then the ward was hardened after Kiro's own security audit, and a guided first séance, recorded answers, a hostile sample repository, the haunting map and an MCP server were added through four more Kiro specs (ten specs, 1,420 tests). The section "Update: the 4,000-credit round" at the end summarises that; the text above it still needs the same pass before it is pasted into Devpost. The current state is in `README.md` and `.kiro/README.md`.

## Inspiration

Every codebase has a line nobody dares to touch. `git blame` gives you a name and a date, never a reason, and the person who knew the reason has usually left. We wanted to be able to ask them anyway, without letting an AI make things up in their name.

## What it does

- **The crypt.** Point Séance at a file and line range. It builds an evidence ledger from `git blame --porcelain` and `git log -L` (following renames): each commit's message, author, date, diff hunk and `#123` references, plus pull request text for public GitHub repos when a token is given. No AI is involved in this step.
- **The ghost.** Claude answers in the first person, from the ledger only. Each claim is typed `memory`, `speculation` or `silence`, and every claim carries `[sha7]` citations with exact quotes.
- **The ward.** A deterministic verifier checks every citation and quote against the ledger. A hash that is not there, or a quote that is not in the cited commit, is struck through on screen with the reason. The page shows the count, for example "4 of 4 claims verified".
- **Plant a false memory.** Send your own claim straight to the ward. Invent a hash or misquote a real commit, and watch it refuse.
- **Copy ward report.** Export the verdict as Markdown, struck claims and reasons included, to paste into a pull request.
- **The exorcism.** A haunting score from six measured signals: age, churn, authors gone, TODO and HACK markers, missing tests, and nesting. Then a refactor plan: characterization tests first, then small steps, plus a cited do-not-touch list for lines whose history shows a deliberate workaround. The plan goes through the same ward.

On the bundled sample, `git blame` on line 7 of `legacy/tax.js` points at a 2024 variable rename. The ledger finds the 2020 commit that explains the three second wait: the vendor returns 429 within 3 seconds.

## How we built it

TypeScript on Node 20 with Hono and zod, and the Anthropic SDK for the ghost and the planner. Git is called through execa, with no shell. The UI is plain HTML, CSS and JS with a candle, fog and a planchette; it respects `prefers-reduced-motion` and is keyboard usable, with a skip link. The server sends a strict Content-Security-Policy. As submitted there were 418 tests (1,420 after the 2026-11-11 round), including fast-check property tests for the ledger, the verifier, the score, the plan prompt and the ward report, plus an integration test that runs real git on a generated repository.

## How Kiro was used

Everything is in the repo: `.kiro/` (steering, specs, agents, hooks, MCP settings) and `docs/kiro-evidence/` (unedited session output for every claim below). We used the **Kiro CLI** (3.0 and 3.1, both its V2 and V3 engines) and **Kiro Crew**. We did not use the IDE or Kiro Web, so anything IDE-only is marked as unproven.

### Kiro CLI vs Crew (and V2 vs V3)

- **CLI, V2 engine (the default).** It was the workhorse: spec tasks, fixes and MCP. Non-interactive runs with `--trust-tools` were predictable.
- **CLI, V3 engine (`--v3`).** It is the only one that sees Kiro Powers (`/powers`, the `kiro_powers` tool), and it loads workspace prompt hooks. It uses different tool ids (`run_command`, `kiro_powers` instead of `execute_bash`), so our first V3 run was denied every tool until we found the ids.
- **Kiro Crew.** A local gateway that runs subagents in parallel. `kiro-cli crew -y` installed it, and it signs in through the Kiro CLI. We used it for two independent tasks at once; see below.

### Spec-driven development

There are six specs in `.kiro/specs/`:

- `evidence-ledger`
- `ghost-verifier`
- `exorcism-plan`
- `spooky-ui`
- `ward-report`
- `model-rate-limit`

Each has EARS-style requirements with IDs (for example R9.2 "start <= end"), a design with module signatures and the invariants to property-test, and ordered tasks. Every task names its files and its tests. Commit messages reference the task they implement (`evidence-ledger T1-T5`, `ward-report T3`).

Kiro implemented the ledger, the ghost and verifier, and the exorcism planner from their specs. Later it implemented all three tasks of `ward-report`: the renderer, the property tests, the API field and the copy button. It ticked the boxes itself. Last, before the public deploy, the warden agent implemented `model-rate-limit`: 10 model calls per 10 minutes per IP plus a daily cap, returning an in-character 429. We added two things by hand: pruning of expired IPs, and a socket-address fallback.

The spec paid off at the end. A review pass by our archaeologist agent found a gap between the code and requirement R9.2: `/api/summon` accepted `endLine < startLine` and returned 200. Because the requirement had an ID, the fix had a clear target and a test.

Compared with vibe coding, the spec kept each session small: one task, named files, named tests. It also gave us something to check Kiro's summaries against.

One honest limit: mocked tests passed while the real thing was broken (`git log -L` rejects `--follow`). Only running real git exposed it, so we added a real-git integration test. The free credits also ran out mid-build. On 2026-11-06 Kiro's batch run of the `spooky-ui` spec stopped on the free plan's monthly limit, so the page and a few fixes were written by hand, and those commits do not claim Kiro. On 2026-11-09, with credits available again, Kiro went back to it in three steps. First, it audited `public/` against all 52 requirements (27 met, 20 partial, 5 missing; `docs/kiro-evidence/spooky-ui-audit.md`). Second, the warden agent fixed the gaps that change nothing on screen, and added `test/ui/spooky-ui.test.ts`. The fixes: `aria-busy` while loading; an opacity substitute for the flicker under reduced motion; a candle flicker whose half-period runs from 4 s down to a 333 ms floor (at most 1.5 cycles a second); a "séance has ended" path for expired sessions; an inline error for an empty repository field; atomic tally announcements; and claim bubbles as `article` elements. One Kiro change was reverted in review: moving `--confidence` to the root element, which `.candle`'s own value shadows. Third, Kiro ticked only the 4 task items it could verify at that point. The other 84 described a module layout (`public/js/*`, three CSS files) that the hand-written UI never had. It did not implement hiding rejected claims in production (R3.7, R7.7), because showing them struck through is the product's point. Severity labels, step badges and collapsible steps were left for later at first, so the demo captures would stay valid. Then, after a user decision to match the spec fully (the demo video is re-rendered), the warden agent added the visible parts it had left out: a severity label next to the haunting score (Restless, Troubled, Haunted, Possessed), Reversible ✓ / Irreversible ⚠ badges on refactor steps, steps and do-not-touch entries as keyboard-collapsible `details` (open by default), a running "N of M claims verified this séance" counter, a "Performing exorcism…" status, and a contrast check (`scripts/contrast.mjs`, `npm run contrast`, 11 token pairs, all at least 4.5:1). That session also ended on a throttle. By hand: prettier, and a CSS fix where the list number overlapped the disclosure triangle. Kiro then rewrote `tasks.md` to describe the real files (one `app.js`, flat CSS) instead of the module split. In review I reopened four ticks that were reasoned rather than tested, fixed one wrong id, and corrected its reason for R3.7/R7.7. That left 116 verified and 4 open. The last four were property tests for the planchette angle, the fog opacity and the claims counter, plus the fast-check setup. Kiro's credits were spent by then, so I wrote them by hand in `test/ui/pbt/ui.pbt.ts`. All 120 are now verified. The module split was not done: it would put a working UI at risk near the deadline.

### Steering docs

There are four steering files:

- `product.md`
- `tech.md` (strict TypeScript, no shell in git calls, test layout)
- `evidence-rules.md`
- `ui-spooky.md`

`ui-spooky.md` is only included for `public/**` (`inclusion: fileMatch`).

The one that made the biggest difference was `evidence-rules.md`. It states the verifier's invariants once:

- every claim cites a sha in the ledger
- quotes are literal substrings
- the score is verified / total
- the verifier stays pure

Every later session respected them, and our two custom agents load it as a resource. The fileMatch strategy kept UI copy rules out of backend sessions.

### Custom agents

- **`archaeologist`** (`.kiro/agents/archaeologist.json`) is a read-only agent. Its shell is limited to `git log`, `git blame`, `git show` and `git diff`, it cites a sha for every claim, and it treats commit text as untrusted. We used it in the V3 engine for a review pass over `src/`, and it found the R9.2 defect above.
  - Caveat: in non-interactive V3 its git calls were denied, so it could not cite a commit for its finding. We confirmed the defect by hand: the request returned 200.
- **`warden`** (`.kiro/agents/warden.json`) is a builder agent: failing test first, then the smallest fix. It fixed the defect and added the test (commit `1d4ada1`).
  - Lesson learned: with `--agent`, the agent's own `allowedTools` wins over `--trust-tools`. In the first run every write was denied, and Kiro's summary still reported test results that never ran. We kept that transcript, and we now check tool output, not summaries.

### Agent hooks

- **CLI agent hooks in `warden.json`, proven firing.** These automate our "never leave it red" rule. `docs/kiro-evidence/warden-hook-fires.log` shows two `postToolUse fs_write` firings (typecheck exit 0) and one `stop` firing (287 tests passed).
  - `postToolUse` with matcher `fs_write` runs `tsc --noEmit` after every file write and feeds the result back to the agent.
  - `stop` runs the full vitest suite.
  - `agentSpawn` did not fire in non-interactive runs, so we do not claim it.
- **Prompt hook `/review-evidence`** (`.kiro/hooks/evidence-review.json`, `UserPromptSubmit`). It reviews the staged diff against `evidence-rules.md` and refuses changes that weaken the verifier without a spec task ID. It fired in a CLI 3.0 session on a real staged diff.
  - In CLI 3.1 V3 it also fired on prompts that did not match its matcher, which we documented.
- **Save hooks** (`ghost-tests.json`, `sloplint.json`, `PostFileSave`). They are written for the IDE. We never saw them fire from the CLI, and the repo says so.

### MCP

There are two workspace servers in `.kiro/settings/mcp.json`:

- **git** (`mcp-server-git`). Agents read history through it (`@git/git_log`) instead of free-form shell, which matters for an app whose whole point is that git is the source of truth.
- **filesystem**, scoped to the repo root. It originally pointed at `uvx mcp-server-filesystem@latest`, a package that does not exist, so it never started. Kiro diagnosed this, switched it to `@modelcontextprotocol/server-filesystem` pinned at 2.0.1, and a second session called `@filesystem/list_directory` and `@filesystem/read_text_file` (commit `b5e677f`).

### Kiro powers

We installed the **Context7** power (`kiro-cli powers install context7`) to check the Hono `secureHeaders` options against current docs. The V3 engine listed it and activated its POWER.md. In non-interactive CLI 3.1, however, its MCP server never connected (`MCP server 'power-context7-context7' is not connected`), so no Context7 docs were fetched. Kiro checked the option format against the installed Hono type definitions instead, and the CSP change shipped with a test. We report this as tried, partly working, not as a success.

### Kiro Crew

We installed Crew 0.12.0 through `kiro-cli crew -y` and ran a local gateway. `kirocrew spawn run` started two subagents at once:

- One wrote `test/exorcism/pbt/plan.pbt.ts`, six properties on the plan prompt.
- The other added the skip link and its focus style.

The second queued briefly because the machine was low on memory, then both finished. They touched disjoint files, and the result passed the full suite (commit `5dcd8f2`).

### Credits

This all ran on the free plan. The 2026-11-09 work (Powers, Crew, the ward-report and model-rate-limit specs, both custom agents, the MCP fix, the spooky-ui audit and completion, the exorcism-plan task check, its API tests and plan fixtures) went from 3.37 to 48.58 of 50 credits on `/usage`.

## Challenges

- Keeping the ghost honest. The model is asked for structured claims, and anything that fails the schema or the ward is shown, not hidden.
- Real git differs from mocked git (see the `--follow` story).
- Kiro's summaries are not evidence. Once, the summary reported tests that never ran, so every claim in this write-up points at a log file.

## What we learned

Specs with requirement IDs make AI output checkable. Hooks that run the typecheck and tests turn "Kiro says it passes" into a log line. And the most useful steering file was the one that stated invariants, not style.

## What's next

- Blame across forks.
- Following moved code into other files.
- A GitHub App that posts the ward report on pull requests that touch "haunted" lines.

## Built with

TypeScript, Node.js, Hono, zod, Anthropic Claude, execa, fast-check, vitest, Kiro CLI, Kiro Crew, MCP (git, filesystem)

## Update: the 4,000-credit round (2026-11-11)

When the hackathon's bonus credits arrived we pointed Kiro at its own submission first. Three read-only audits (security, accessibility, a judge's first run) set the plan, and the security one was humbling: the ward verified less than the page promised. A quote was optional, a "silence" claim could carry any sentence, and the author and date check our steering file described had never been written.

What followed, all through Kiro CLI 3.2.0 on `claude-opus-5.5`, mostly in the V3 engine:

- **Four specs written by Kiro in V3 spec mode** from those audits, then implemented test-first by our `warden` agent, whose hooks typecheck after every file write and run the suite when it stops: `ward-hardening`, `first-seance`, `haunting-map`, `seance-mcp`.
- **The ward now does what it says.** A quote is mandatory and must be found in one field of the cited commit; years and ledger authors named in a claim must be supported; silence is shown apart and never counted. A hostile sample repository, `possessed`, attacks the ward with prompt injection, and the tests assume the worst: a scripted model that obeys every injected order still gets nothing verified. The page lets you watch that with one click.
- **A judge's first three minutes.** One-click questions, one-click false claims, the line in question on screen, a retry while the free host wakes, and recorded answers (from real model calls, re-checked by the live ward) when the model is unavailable.
- **The haunting map.** Which files are haunted by which departed author, from two git calls and no model.
- **Séance as an MCP server.** Our `archaeologist` Kiro agent now sends its own claims to the ward before stating them. A real run with all tools trusted found a bug in our server.
- **A second opinion.** A new read-only agent, `inquisitor`, on a different model family, re-attacked the result twice. The first pass confirmed eight findings (seven fixed; `X-Forwarded-For` is a documented open risk), the second six more, all fixed. The accessibility and first-run audits were then repeated on the finished page.

What Kiro got right that we did not: it stopped and asked instead of skipping tests; it broke the verifier on purpose to prove the adversarial tests could fail; it found that a parser fix we suggested was still ambiguous and wrote a sound one. What went wrong: one session was cut off by a throttle; the V3 engine denies shell and MCP calls in non-interactive runs unless everything is trusted; Kiro cannot edit its own settings directory; and the new page was only looked at in a browser once, at the very end (headless Chromium, by hand), which the docs say plainly.

Numbers: ten specs, 585 of 585 task items ticked, 1,420 tests, about 2,500 of the 4,000 bonus credits (the meter is shared with another session on the account).
