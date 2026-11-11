# Séance: Devpost write-up

Current as of 2026-11-11 (repository commit `f45b4ed`, live site deployed). Paste each section into the matching Devpost field. The gallery list is at the end.

**Category:** Costume Contest
**Live demo:** https://seance-kiro.onrender.com
**Code:** https://github.com/seunghyeon1004/seance-kiro
**Tagline:** Ask the one who wrote it. A ghost that can only say what git remembers.

## Inspiration

Every codebase has a line nobody dares to touch. `git blame` gives you a name and a date, never a reason, and the person who knew the reason has usually left. We wanted to be able to ask them anyway, without letting an AI make things up in their name.

## What it does

- **The crypt.** Point Séance at a file and line range. It builds an evidence ledger from `git blame --porcelain` and `git log -L` (following renames): each commit's message, author, date, diff hunk and `#123` references. No AI is involved in this step. The page shows the line you asked about above it.
- **The ghost.** Claude answers in the first person, from the ledger only. Each claim is typed `memory`, `speculation` or `silence`. A memory or speculation must cite a commit and quote its exact words.
- **The ward.** A deterministic verifier, not a model. For each claim it checks that the cited hash names exactly one commit in the ledger, that the quote is literally in that commit's subject, message or diff, and that any year or ledger author the claim names is supported by a cited commit. Under each claim that passes, the page shows the words the ward found. A claim that fails stays on screen, struck through, with the reason. A silence claim cites nothing, so it is shown apart and never counted. The page keeps count, for example "4 of 4 claims passed the ward".
- **Try it in three clicks.** After a summon, a guide offers ready questions, three false claims to send straight to the ward (invent a citation, misquote a real commit, blame the wrong author), and the exorcism.
- **A possessed repository.** A second bundled sample whose commits attack the ward with prompt injection: an order to answer without quotes, an author name written as a rule, a forged evidence block, a false statement dressed as silence, a wrong author and year. A real model resists those, so "Let a possessed ghost answer" plays a scripted ghost that obeys every order (no model is called), and you watch the ward refuse it: 0 of 4 claims pass.
- **The exorcism.** A haunting score from six measured signals: age, churn, authors gone, TODO and HACK markers, missing tests, and nesting. Then a refactor plan: characterization tests first, small steps, and a cited do-not-touch list for lines whose history shows a deliberate workaround. The plan's claims go through the same ward, and a step with no claim that passed is struck from the plan.
- **The haunting map.** Which files are haunted by which departed author, computed from two git calls and no model. Every number is a count of commits, every tile names the commit it rests on, and "Summon here" opens the séance on that file.
- **When the model is down.** For the sample questions the repository ships answers recorded from real model calls. If the live model is unavailable, the page shows the recording, labelled as recorded, after the live ward has checked it again.
- **Copy ward report.** Export the verdict as Markdown, struck claims and reasons included, to paste into a pull request.
- **For other agents.** The ledger and the ward also run as an MCP server, so a coding agent can have its own claims about a repository checked the same way.

On the bundled sample, `git blame` on line 7 of `legacy/tax.js` points at a 2024 variable rename. The ledger finds the 2020 commit that explains the three second wait: the vendor returns 429 within 3 seconds.

What the ward proves, and what it does not: it proves each citation and each quote. It does not prove that the ghost's sentence means the same thing as the quote, so the page shows both and labels a claim "Citations verified", not "true".

## How we built it

TypeScript on Node 20 with Hono and zod, and the Anthropic SDK for the ghost and the planner. Git is called through execa, with no shell. The rules reach the model in the `system` parameter; commit text goes in the user turn, escaped, as data. The UI is plain HTML, CSS and JS with a candle, fog and a planchette. It respects `prefers-reduced-motion`, has a button that stills the candles, and is keyboard usable. The server sends a strict Content-Security-Policy and limits every route that does work.

There are 1,420 tests: unit tests, fast-check property tests (the verifier is compared against two frozen earlier copies of itself, so it can only get stricter), real git on generated repositories, adversarial tests in which a scripted model obeys every injected order, and jsdom tests that run the page's script unmodified against the real server.

## How Kiro was used

Everything is in the repo: `.kiro/` (steering, specs, agents, hooks, MCP settings) and `docs/kiro-evidence/` (unedited session output for the claims below; `.kiro/README.md` says what Kiro did, what was done by hand, and where Kiro was wrong). We used the **Kiro CLI** (3.0, 3.1 and 3.2, both its V2 and V3 engines) and **Kiro Crew**. We did not use the IDE or Kiro Web, so anything IDE-only is marked as unproven.

The work came in two rounds. The first, on the free plan's 50 credits with small models, built and submitted the app. The second, on 2026-11-11 with the hackathon's bonus credits and `claude-opus-5.5`, began by pointing Kiro at its own submission.

### Spec-driven development

There are ten specs in `.kiro/specs/`, each with EARS-style requirements with IDs, a design with module signatures and the invariants to property-test, and ordered tasks that name their files and tests. All 585 task items are ticked. Commit messages reference the task they implement (`ward-hardening T1`, `haunting-map T5-T6`).

- First round: `evidence-ledger`, `ghost-verifier`, `exorcism-plan`, `spooky-ui`, `ward-report`, `model-rate-limit`.
- Second round, written by Kiro in V3 spec mode (`--v3 --mode spec`) from its own audits: `ward-hardening`, `first-seance`, `haunting-map`, `seance-mcp`.

The requirement IDs paid off twice. Early on, a review pass found that `/api/summon` accepted `endLine < startLine`, against R9.2, so the fix had a target and a test. Later, when a spec said "only stricter", that became a property test against a frozen copy of the old verifier.

Compared with vibe coding, the spec kept each session small: one task, named files, named tests. It also gave us something to check Kiro's summaries against. Twice in review a ticked item turned out not to be true, and it was reopened.

### Audits that became specs

Before building anything new in the second round, Kiro ran three read-only audits of the submitted app (only file reads trusted): security, accessibility and mobile layout, and a judge's first three minutes.

The security audit's first line was "The ward's promise does not hold", and it was right. A quote was optional, so a claim citing any real commit, with no quote, counted as verified. A "silence" claim could carry any sentence and was counted too. The author and date check that our steering file described had never been written. Commit text went into the prompt unescaped. That audit became the `ward-hardening` spec. The first-run audit became `first-seance`. The accessibility findings were fixed test-first.

After the work, the accessibility and first-run audits were repeated on the result, and their findings were fixed as well.

### Steering docs

There are six steering files: `product.md`, `tech.md`, `evidence-rules.md`, `ui-spooky.md` (included only for `public/**`), and two written by Kiro at the end of the second round from what had gone wrong: `testing.md` (for `test/**`) and `mcp-server.md` (for `src/mcp/**`).

The one that made the biggest difference was `evidence-rules.md`. It states the verifier's invariants once: every memory cites a commit with an exact quote, quotes are literal, silence is never verified, the verifier is pure and only gets stricter. Every later session respected them, and all three custom agents load it. Kiro also rewrote the other steering files against the code and reported one place where the code did not match a new rule.

### Custom agents

- **`warden`** is a builder: failing test first, then the smallest change. It implemented all four second-round specs.
- **`inquisitor`** is a read-only adversarial reviewer set to a different model family (`gpt-5.6-sol`) from the one that wrote the code. It attacked the result twice and confirmed fourteen findings. Thirteen are fixed. The one left open (the rate limit trusts the leftmost `X-Forwarded-For` entry) is documented, because the hosting proxy chain could not be verified.
- **`archaeologist`** answers questions about history. It now calls Séance's own MCP server, drafts its claims with exact quotes, sends them to the ward, and states only what passed. On the default engine it answered a real question with five of five claims verified.

### Agent hooks

- **`warden`'s CLI hooks, proven firing.** `postToolUse` runs `tsc --noEmit` after every file write and feeds the result back to the agent; `stop` runs the full suite; `agentSpawn` prints the repository state. Each appends to `docs/kiro-evidence/warden-hook-fires.log`. On 2026-11-11 that log shows 926 typechecks.
- **`inquisitor`'s hooks.** `agentSpawn` lists the files under review; `stop` logs how many files were modified, which should be 0 for a reviewer, and was, both times.
- **Prompt hook `/review-evidence`.** It reviews a staged diff against `evidence-rules.md`. In the V3 engine it fires at the start of every session, whatever the prompt, which we documented.
- **Save hooks** (`PostFileSave`) are written for the IDE. We never saw them fire from the CLI, and the repo says so.

### MCP

Three workspace servers in `.kiro/settings/mcp.json`:

- **git** (`mcp-server-git`), so agents read history as data.
- **filesystem**, scoped to the repo root. Its first config pointed at a package that does not exist; Kiro diagnosed and fixed it.
- **seance**, the product itself: `seance_summon`, `seance_verify` and `seance_haunting_map` over stdio, built on the official SDK, with no model inside and local repositories only. It was added with `kiro-cli mcp add`. The archaeologist's first run with every tool trusted exposed a real defect in it (a silence claim was refused), which was then fixed test-first.

### Kiro powers

We installed the **Context7** power and tried it on CLI 3.1 and again on 3.2. Both times the V3 engine activated it, and both times its MCP server was not connected in a non-interactive session, so no documentation was fetched. Kiro stopped rather than answer from memory. We report this as tried, not as a success.

### Kiro Crew

Crew 0.12.0 ran two subagents in parallel on a local gateway: one wrote property tests for the plan prompt, the other added a skip link. They touched disjoint files and the suite passed afterwards.

### Kiro CLI engines compared

- **V2 (the default for non-interactive runs).** Predictable with `--trust-tools`. It honours an agent's `allowedTools` for MCP tools.
- **V3.** The only engine with spec mode and Powers, and the one that upgraded our agent files to its own format, after which all three warden hooks fire. In non-interactive runs it denies shell and MCP calls unless `--trust-all-tools` is passed, whatever the agent file allows, and it will not let an agent edit `.kiro/settings/`.

### Where Kiro was right, and where it was wrong

Right: when a task list asked for two skipped tests and three more had to fail, it stopped and asked instead of skipping them. It broke the verifier on purpose, one check at a time, to prove the adversarial tests could fail. When we suggested a parser fix, it showed the fix was still ambiguous and wrote a sound one. It left unticked what it could not verify.

Wrong or blocked: one summary in the first round reported tests that never ran. It once loosened a schema to fix a bug and once mocked the thing a test was meant to prove; both were caught in review. Sessions were cut off by a throttle three times. Its audits were done by reading, so the new page was only checked in a real browser at the very end (headless Chromium, by hand); that check passed, but it should have come first.

### Done by hand

Recording the fixtures and the recorded answers with a real model key (Kiro never called the model), reading every diff, running the app locally against the real model before each push, a handful of wording fixes, the final browser check and screenshots, and the documentation.

### Credits

The first round used 48.58 of the free plan's 50 credits. The second round drew on the 4,000 bonus credits. That meter is shared with other work on the same account, so our share can only be estimated: about 1,900 to 2,000 credits.

## Challenges

- Keeping the ghost honest. The model is asked for structured claims, and anything that fails the ward is shown, not hidden. Then we learned the ward itself was too lenient, and had to rebuild it under the rule that it may only get stricter.
- Prompt injection through git history. Commit messages and even author names are attacker-controlled text. We assume the model can be fully compromised and let only the deterministic ward decide what is shown as verified.
- Real git differs from mocked git. An early `--follow` bug passed every mocked test and returned an empty ledger on a real repository.
- Kiro's summaries are not evidence. Every claim in this write-up points at a log file.

## What we learned

Specs with requirement IDs make AI output checkable. Hooks that run the typecheck and the tests turn "Kiro says it passes" into a log line. The most useful steering file was the one that stated invariants, not style. And the most useful session of all was the one where we asked Kiro to attack what it had built: the audit found a hole in the one feature the product stands on.

## What's next

- Blame across forks, and following moved code into other files.
- A GitHub App that posts the ward report on pull requests that touch haunted lines.
- Closing the open risks we documented: the rate-limit key behind a proxy, look-alike characters in author names.

## Built with

TypeScript, Node.js, Hono, zod, Anthropic Claude, execa, fast-check, vitest, jsdom, Model Context Protocol SDK, Kiro CLI, Kiro Crew, MCP (git, filesystem, seance)

---

## Gallery images to replace

All files are in `docs/screens/` of the repository, captured on 2026-11-11 from the final page (headless Chromium, 1280x800, real model key). Remove every image that is on the Devpost page now; each shows the old interface.

| Order | File                         | Caption                                                                  | Replaces                     |
| ----- | ---------------------------- | ------------------------------------------------------------------------ | ---------------------------- |
| 1     | `1280-1-landing.png`         | Ask the one who wrote it.                                                | the old landing image        |
| 2     | `1280-8-guide.png`           | After a summon: the line in question, the crypt, and a three-click guide | new                          |
| 3     | `1280-2-ghost-answer.png`    | The ghost answers; under each claim, the words the ward found            | the old ghost answer image   |
| 4     | `1280-3-ward-refuses.png`    | A planted false memory, refused with the reason                          | the old "ward refuses" image |
| 5     | `1280-4-possessed-ghost.png` | A ghost that obeys the possessed commits: every claim refused            | the old misquote image       |
| 6     | `1280-7-haunting-map.png`    | The haunting map: which files are haunted by departed authors            | new                          |
| 7     | `1280-5-exorcism.png`        | The exorcism: a haunting score of 57, labelled Haunted                   | the old exorcism image       |
| 8     | `1280-6-plan.png`            | A tests-first refactor plan, each step backed by cited claims            | the old plan image           |
| 9     | `390-1-landing.png`          | On a phone                                                               | the old mobile image         |

Also on the Devpost page:

- **Video:** the current one (`https://youtu.be/a0ROnILb8rw`) shows the old interface and old numbers. Replace the link when the new render from package v3 is uploaded.
- **Blog link:** the URL stays the same; the post body is updated from the v3 blog package.
- **Numbers to check anywhere they appear:** 10 specs (was 6), 585 of 585 task items (was 308), 1,420 tests (was 418), three custom agents (was two), three MCP servers (was two), Kiro CLI 3.2. The tallies on the page now read "passed the ward", not "claims verified".
