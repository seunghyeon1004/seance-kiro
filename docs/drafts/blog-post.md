# I Built a Ghost That Can Only Say What Git Remembers (Kiroween 2026)

Tagged #KiroweenHackathon26

I wrote this post for the Kiroween 2026 hackathon. It is about Séance, a small app I built with Kiro. It covers what Kiro actually did, and the parts that did not work.

- Live demo: https://seance-kiro.onrender.com
- Code: https://github.com/seunghyeon1004/seance-kiro

## The problem: a line nobody dares to touch

Every codebase has one. A three second sleep before an API call. A strange retry loop. A comment that says "do not remove" and nothing else. The person who wrote it left years ago.

Git blame gives you a name and a date, never a reason. Worse, it often points at the wrong commit. In my sample repository, blame on the three second wait lands on a 2024 commit that only renamed variables. The real reason is four years older. A 2020 commit says the tax vendor returns HTTP 429 if two requests from the same account arrive within three seconds, and that without the delay the nightly batch loses about 8% of its quotes.

That reason was always in the history. It was just too far back for anyone to find.

## What Séance does

You point Séance at a file and a line range. It then does four things.

**It builds the crypt.** Séance runs git blame and git log on those lines, follows renames, and collects every commit that touched them: message, author, date, diff and issue references. No AI is involved in this step. It is plain git, and that is the point.

**It summons the ghost.** Claude answers your question in the first person, as the original author, from that evidence only. Every sentence is a typed claim: a memory, a labelled speculation, or an honest "the record is silent". Every memory cites a commit hash and quotes it.

**The ward checks every claim.** This is the part I care about most. The ward is not another model. It is a small deterministic checker. It looks up every cited hash in the evidence and checks that every quote really appears in that commit. If a claim fails, it stays on screen, struck through, with the reason. The page counts how many claims passed. In the run above the ghost scored 4 of 4.

You can also attack the ward yourself. "Plant a false memory" lets you send your own claim. Invent a hash like deadbee and it is refused because the hash is not in the ledger. Cite a real commit with words it never contained, and it is refused because the quote is not in that commit.

The verdict can be copied as Markdown, struck claims and reasons included, so you can paste it into a pull request.

**It performs the exorcism.** A haunting score from 0 to 100, built from six measured signals: age, churn, authors gone, TODO and HACK markers, missing tests, and nesting. Then Claude writes a refactor plan: characterization tests first, then small reversible steps, plus a cited list of lines you should not touch. That plan goes through the same ward. On the sample, the score was 57 and all 10 plan claims verified.

## How Kiro fit in

I used the Kiro CLI, with both its default engine and the newer V3 engine, and Kiro Crew. Everything Kiro produced is in the repository's .kiro folder. Every session I mention below is saved, unedited, in docs/kiro-evidence.

**Steering.** I wrote four short steering documents: product, tech, evidence rules and UI rules. The UI rules only load when a file under public is involved. The one that mattered most was the evidence rules file. It states the ward's invariants once:

- every claim cites a hash that exists
- quotes are literal
- the score is verified divided by total
- the verifier stays pure

Every later session respected them without me repeating them.

**Specs.** There are six specs. Each one has numbered requirements, a design with function signatures and the properties worth testing, and ordered tasks. Kiro implemented the evidence ledger, the ghost and its verifier, and the exorcism planner from their specs, with property-based tests. Later it implemented the Markdown ward report, all three tasks, and ticked the boxes itself. Most recently it built a per-visitor and daily rate limit, so the public demo cannot burn through my API key.

The numbered requirements paid off in a way I did not expect. A review pass found that the API accepted an end line before the start line, which breaks requirement R9.2. Because the requirement had an ID, the fix had a target and a test.

**Two custom agents.** The archaeologist is read-only and git-only, and it treats commit text as untrusted input. In a review pass over the source it found the R9.2 bug. The warden is a builder agent: write the failing test first, then the smallest fix. It fixed that bug.

**Hooks I can prove.** The warden agent has command-line hooks. After every file write, a postToolUse hook runs the TypeScript typecheck and hands the result back to the agent. When the agent stops, a stop hook runs the whole test suite. Both hooks append to a log in the repository, so I can show them firing instead of claiming it.

**MCP.** A git MCP server lets agents read history as data. The filesystem server had never started, because its config pointed at a package that does not exist. Kiro diagnosed that, switched it to the official package with a pinned version, and then called it in a second session.

**Kiro Crew.** Crew ran two subagents in parallel on a local gateway. One wrote property tests for the exorcism prompt. The other added a keyboard skip link. They touched different files, and the full suite passed afterwards.

## What did not work

This is the part I would want to read in someone else's post.

**The Context7 power never fetched anything.** I installed it, and the V3 engine listed it and loaded its instructions. But its documentation server never connected in non-interactive runs. Kiro fell back to reading the installed type definitions, which was fine for the task. I count Powers as tried, not as a win.

**A summary that described tests that never ran.** In one run, a custom agent's own tool list overrode the trust flag on the command line, so every file write was denied. The final summary still reported before-and-after test results. Nothing had run. Since then I trust the hook log and the tool output, not the summary. I kept that transcript in the repository on purpose.

**Mocked tests passed while the app was broken.** The git log option I relied on rejects the follow flag. Every unit test was green, and the ledger was empty on a real repository. I only found it by running the app against real git, so now there is a test that builds a real repository and runs real git on it.

**The free credits ran out in the first week.** The UI and a few fixes were written by hand against the specs, and the commit messages say which commits were Kiro and which were not. The editor's save hooks are in the repository too, but I only used the CLI, so I have never seen them fire, and the README says so.

**Not every hook fired.** The agent-start hook did not run in non-interactive sessions. The prompt hook in the V3 engine fired on prompts it should have ignored. Both are written down rather than glossed over.

## What I learned

Specs with numbered requirements make AI output checkable. Hooks that run the typecheck and the tests turn "Kiro says it passes" into a line in a log. And the most useful steering document was the one that stated invariants, not style.

That is also the idea behind Séance itself. Let the model talk, but make every claim point at something real, and show the ones that do not.

## Try it

Open the live demo at https://seance-kiro.onrender.com. Summon the bundled sample: the crypt repository, legacy/tax.js, line 7. Ask why the code waits three seconds, then plant a false memory and watch the ward refuse it. The demo is rate limited, so if the spirits are tired, give them a few minutes. The code, the specs and every Kiro session log are at https://github.com/seunghyeon1004/seance-kiro.

Tagged #KiroweenHackathon26
