# I built a ghost that can only say what git remembers (Kiroween 2026)

This post is written as part of the Kiroween 2026 hackathon. It is about Séance and about what building it with Kiro was actually like, including the parts that went wrong.

## The idea

Every codebase has a line nobody dares touch. `git blame` gives a name and a date, never a reason. In my sample repo, blame on a three second wait points at a 2024 variable rename. The real reason is in a 2020 commit: the tax vendor returns HTTP 429 if two calls land within three seconds.

Séance reads the history of a line, builds an evidence ledger (commit messages, authors, dates, diffs, issue references) and lets the author's ghost answer in first person. The rule that makes it trustworthy: every claim must cite a commit and, where possible, quote it. A deterministic ward checks the citations. A hash that is not in the ledger, or a quote that is not in the commit, is struck through and counted: "4 of 5 claims verified".

## How Kiro fit

- **Steering.** Four short documents (product, tech, evidence rules, UI rules). The evidence rules are the most useful: they state the verifier's invariants once, and every later session respected them.
- **Specs.** Four specs with EARS requirements, a design and tasks. Kiro implemented the ledger, the ghost and verifier, and the exorcism planner from them, with property-based tests for the invariants.
- **Custom agent, hooks, MCP.** An `archaeologist` agent restricted to read-only git commands, a prompt hook that reviews a staged diff against the evidence rules, and a git MCP server. I ran the review hook and an MCP call in one session; the output is committed under `docs/kiro-evidence/`.

## What did not go smoothly

- Kiro's mocked tests passed while the real thing was broken: `git log -L` rejects `--follow`, so the ledger was empty on a real repository. I only saw it when I ran the app against git and the real model, so I added a test that runs real git on a generated repo.
- The free tier ran out mid-build. Part of the UI and some fixes were written by hand against the specs, and the commit messages say so.
- Save hooks are written for the IDE trigger; I have not seen them fire from the CLI, and the repo says that.

## Try it

Run it on the bundled sample, then use "Plant a false memory" to send an invented claim through the ward and watch it refuse. Code and instructions are in the repository README.
