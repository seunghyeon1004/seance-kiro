# I built a ghost that can only say what git remembers (Kiroween 2026)

I'm writing this post as part of the Kiroween 2026 hackathon. It covers Séance and what building it with Kiro was actually like, including the parts that went wrong.

## The idea

Every codebase has a line nobody dares touch. `git blame` gives a name and a date, never a reason. In my sample repo, blame on a three second wait points at a 2024 variable rename. The real reason is in a 2020 commit: the tax vendor returns HTTP 429 if two calls land within three seconds.

Séance reads the history of a line. It builds an evidence ledger (commit messages, authors, dates, diffs, issue references) and lets the author's ghost answer in the first person.

One rule makes it trustworthy: every claim must cite a commit and, where possible, quote it. A deterministic ward checks the citations. A hash that is not in the ledger, or a quote that is not in the commit, is struck through and counted ("4 of 4 claims verified"). You can try to fool it: "Plant a false memory" sends your own claim to the ward, and an invented hash or a misquote is refused on screen. The verdict can be copied as Markdown for a pull request. An "exorcism" then scores how haunted the code is and writes a refactor plan, tests first.

## How Kiro fit

I used the Kiro CLI (both its V2 and V3 engines) and Kiro Crew, all on the free plan.

- **Steering.** I wrote four short documents: product, tech, evidence rules and UI rules. The UI one only loads for `public/**`. The evidence rules mattered most. They state the verifier's invariants once, and every later session respected them.
- **Specs.** There are five specs with numbered requirements, a design and ordered tasks. Kiro built the ledger, the ghost and verifier, and the exorcism planner from them. It also did all three tasks of the last spec (a Markdown "ward report" export) and ticked the boxes itself.
- **Two custom agents.** `archaeologist` is read-only and git-only. In a review pass it found a real gap between the code and a requirement: the API accepted an end line before the start line. `warden` is a builder agent. It fixed that gap test first.
- **Hooks I can prove.** The warden agent has CLI hooks. After every file write, `postToolUse` runs the typecheck; when the agent stops, `stop` runs the whole test suite. Both append to a log in the repo, and the log shows them firing.
- **MCP.** A git server lets agents read history as data. The filesystem server had never started, because it pointed at a package that does not exist. Kiro diagnosed and fixed that, then called it.
- **Kiro Crew.** Two subagents ran in parallel on a local gateway. One wrote property tests, the other added a keyboard skip link. They touched different files and both passed the suite.
- **Powers.** I installed the Context7 power. The V3 engine listed it and loaded its instructions, but its docs server never connected in non-interactive runs, so it did not fetch anything for me. That is in the repo as tried, not as a win.

## What did not go smoothly

- Mocked tests passed while the real thing was broken. `git log -L` rejects `--follow`, so the ledger was empty on a real repository. I only saw it when I ran the app against real git, so I added a test that runs real git on a generated repo.
- One Kiro run had every write denied, because a custom agent's own tool list overrides the command-line trust flag. Its final summary still reported before-and-after test results that never ran. Since then I trust the hook log and the tool output, not the summary.
- The free credits ran out mid-build in the first week. The UI and a few fixes were written by hand against the specs, and the commit messages say so.
- The IDE save hooks have never fired from the CLI, and the repo says that too.

Every Kiro session I mention is committed, unedited, under `docs/kiro-evidence/`.

## Try it

Run it on the bundled sample, ask why the code waits three seconds, then plant a false memory and watch the ward refuse it. Code and instructions are in the repository README.
