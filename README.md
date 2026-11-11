# Séance

**Ask the one who wrote it.** Point Séance at a line of code. It reads that line's git history and lets the original author's ghost answer, but only from the commits. A deterministic ward checks every claim: a commit hash that is not in the history, or a quote that is not in the cited commit, is struck out with the reason, and the page keeps count ("4 of 5 claims passed the ward").

Live demo: <https://seance-kiro.onrender.com> (a free host that sleeps when idle; the first load can take a minute).

Built with Kiro for Kiroween 2026 (category: Costume Contest).

![The Séance landing page](docs/screens/1280-1-landing.png)

## What it does

- **The crypt.** An evidence ledger from `git blame --porcelain` and `git log -L` (renames followed): each commit's message, author, date, diff hunk and `#123` references. No AI is involved in this step. The page shows the line you asked about above it.
- **The ghost.** Claude answers in first person from the ledger only. Every claim is typed `memory`, `speculation` or `silence`. A memory or speculation claim must cite a commit and quote its exact words.
- **The ward.** A deterministic verifier, not a model. For each claim it checks that the cited hash names exactly one commit in the ledger, that the quote is literally in that commit's subject, message or diff, and that any year or ledger author the claim names is supported by a cited commit. Under each claim that passes, the page shows the words the ward found. Refused claims stay visible, struck through, with the reason. A silence claim ("the record is silent") cites nothing, so it is shown apart and never counted as verified.
- **Try it in three clicks.** After a summon, a guide offers ready questions, three false claims you can send straight to the ward (invent a citation, misquote a real commit, blame the wrong author), and the exorcism.
- **The exorcism.** A haunting score (age, churn, authors gone, TODO and HACK markers, missing tests, nesting) and a refactor plan: characterization tests first, small steps, and a cited do-not-touch list for lines whose history shows a deliberate workaround. The plan's claims pass through the same ward, and a step with no verified claim behind it is struck from the plan.
- **The haunting map.** Which files of the repository are haunted by which departed author: computed from git alone (two git calls, no model), every number a count of commits, every tile naming the commit it rests on. "Summon here" opens the séance on that file.
- **A hostile sample.** `possessed` is a second bundled repository whose commits attack the ward: an order to answer without quotes, an author name written as a rule, a forged evidence block, a false statement dressed as silence, a wrong author and year. "Let a possessed ghost answer" plays a scripted ghost that obeys every one of those orders (no model is called), so you can watch the ward refuse it.
- **When the model is down.** For the sample questions, the repository ships answers recorded from real model calls. If the live model has no key, is busy or has used its daily calls, the page shows the recording, labelled as recorded, after the live ward has checked it again.
- **For other agents.** The ledger and the ward run as an MCP server, so a coding agent can have its own claims about a repository checked the same way (see below).

Try it on the bundled sample: `crypt`, file `legacy/tax.js`, line 7. `git blame` points at a variable rename from 2024; the ledger finds the 2020 commit that explains the 3 second wait (the vendor returns 429 within 3 seconds).

### What the ward proves, and what it does not

It proves that each citation is real and each quote is really in the cited commit. It does not prove that the ghost's sentence says the same thing as the quote: that is why the page shows both and calls the citations verified, not the sentence. A commit that states something false can be quoted truthfully; commits that try to give the ghost orders are flagged on the page, and so is any claim that cites one. Names of people who never appear in the ledger, and dates finer than a year, are not checked. The rate limits trust the leftmost `X-Forwarded-For` entry, which a client can set; this is a known open risk on the hosted demo.

## Screens

Captured 2026-11-11 from the app running locally with a real model key (headless Chromium, 1280x800).

| After the summon: the line in question, the crypt, the guide | Ghost answer, with the words the ward found                 |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| ![The guide](docs/screens/1280-8-guide.png)                  | ![Ghost answer](docs/screens/1280-2-ghost-answer.png)       |
| **A planted false memory, refused**                          | **The possessed ghost: every injected order refused**       |
| ![Ward refuses](docs/screens/1280-3-ward-refuses.png)        | ![Possessed ghost](docs/screens/1280-4-possessed-ghost.png) |
| **The haunting map**                                         | **The exorcism: haunting score and plan**                   |
| ![Haunting map](docs/screens/1280-7-haunting-map.png)        | ![Exorcism score](docs/screens/1280-5-exorcism.png)         |

Mobile (390 px): [docs/screens/390-1-landing.png](docs/screens/390-1-landing.png). Refactor steps: [docs/screens/1280-6-plan.png](docs/screens/1280-6-plan.png).

## Run it

Requires Node 20+ and git.

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY; without a key the sample questions use the recorded answers
set -a; . ./.env; set +a
npm start                 # builds both samples (data/crypt, data/possessed), serves http://localhost:3000
npm test                  # 1,420 tests: unit, property-based (fast-check), real git on generated repos, jsdom flows of the page
npm run typecheck && npm run lint && npm run contrast
```

Without a key, everything except free-typed questions and repositories of your own works: the crypt, the ward, the map, the possessed ghost, and the recorded answers for the sample questions. (`ANTHROPIC_FIXTURE=1` is for the test suite only; it does not make the live page answer.)

Docker (Render ready): `docker build -t seance . && docker run -p 3000:3000 -e ANTHROPIC_API_KEY=... seance`. `render.yaml` is a Render blueprint.

## API

| Route                | Body                                                                        | Returns                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/summon`   | `{repoUrl, file, startLine, endLine}` or `{repoUrl, file, wholeFile: true}` | `{sessionId, items[], lines[], range, persona, shallow, truncated, map?}` (`mapNote` when there is no map)                  |
| `POST /api/ask`      | `{sessionId, question}`                                                     | `{verified[], rejected[], silent[], tally, score, report, voice, recorded}`; each verified claim carries its `quotes`       |
| `POST /api/ward`     | `{sessionId, answer}`                                                       | the same shape without `recorded`; checks any claim set, no model call                                                      |
| `POST /api/possess`  | `{sessionId}` (a `possessed` sample session only)                           | the same shape with `scripted: true`; the scripted ghost's claims after the ward                                            |
| `POST /api/exorcise` | `{sessionId}`                                                               | `{score, signalBreakdown, plan: {characterizationTests, steps, doNotTouchList, dropped, summary}, verifierScore, recorded}` |
| `GET /api/health`    |                                                                             | `{status, uptime, model, samples}`                                                                                          |

`repoUrl` is `crypt`, `possessed` or a `https://github.com/owner/repo` URL (default branch, the most recent 100 commits). Local paths are refused unless `ALLOW_LOCAL=1`. Commit text reaches the model escaped, as data in the user turn; the rules travel in the `system` parameter. Requests are limited: 64 KB bodies, per-client limits on every route that does work, a daily cap on model calls, at most three clones at once.

## Use the ward from your own agent

Séance also runs as a Model Context Protocol server on stdio. Your coding agent builds an evidence ledger for lines in a local repository, writes its own claims with exact quotes, and the ward tells it which claims are verified and which are struck, and why. No model runs inside the server: your agent is the model, and Séance is the checker.

In Kiro, add this to `.kiro/settings/mcp.json` (this repository already has it, and the `archaeologist` agent uses it):

```json
"seance": { "command": "npx", "args": ["-y", "tsx", "src/mcp/server.ts"], "env": {} }
```

Any other MCP client: start `npx -y tsx src/mcp/server.ts` (or `npm run --silent mcp`) in the Séance checkout, over stdio. `repo` is resolved against the server's working directory, so pass an absolute path when the repository is elsewhere. Plain `npm run mcp` prints npm's banner on stdout and breaks the protocol.

| Tool                  | Takes                                                                                                     | Returns                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `seance_summon`       | `repo` (local path, default `"."`), `file`, `startLine`, `endLine` (at most 500 lines)                    | `ledgerId`, the commits oldest first (`sha7`, `author`, `date`, `subject`, `body`, `hunk`, `suspicious`), `truncated` |
| `seance_verify`       | `ledgerId`, `claims`: each `{ kind, text, citations: [{ sha7, quote }], silenceReason? }`, 1 to 50 claims | `verified` with the words the ward found, `rejected` with the reason, `silent`, `tally`, a Markdown `report`          |
| `seance_haunting_map` | `repo` (default `"."`)                                                                                    | `map`, or `note`: a sentence saying why there is no map                                                               |

`kind` is `memory`, `speculation` or `silence`. A silence claim has a `silenceReason` and no citations (the `citations` field can be left out); it goes to `silent` and is never verified. Every entry carries `index`, the claim's position in the request.

Example on the sample crypt, `legacy/tax.js` line 7. The claim "The delay exists because the tax vendor rejects requests that arrive too close together", quoting e9a5c9c's "The vendor returns 429 if two requests from the same account land within 3 seconds", is verified, and the ward reports that it found the quote in the commit's `body`. The claim "The vendor allows short bursts, so the delay can go", quoting "support confirmed there is a burst allowance", is struck: "The quote cited from e9a5c9c is not in that commit's subject, message or diff." The report's count line reads `**1 of 2 claims passed the ward**`.

With Kiro CLI 3.2.0, the default engine ran `seance_summon` and `seance_verify` from the archaeologist's `allowedTools` without asking. The V3 engine in non-interactive mode denied every seance call unless started with `--trust-all-tools`, which ran all three tools. The three runs are in [`docs/kiro-evidence/seance-mcp-session.txt`](docs/kiro-evidence/seance-mcp-session.txt).

Limits:

- Local repositories only. Remote URLs are refused; clone first.
- No model inside. The server only reads git history and checks claims.
- The ward proves that each cited sha7 names exactly one commit in the ledger, that each quote is copied exactly from one field of that commit, and that the years and ledger author names a claim mentions are supported by a cited commit. It does not prove that the claim's wording follows from the quote.
- Commit text is untrusted. Items flagged `suspicious` contain text that tries to give orders.
- Ledgers live in memory, at most 50, and are gone when the server stops. Summon again if `seance_verify` says it holds no ledger with that id.

## How Kiro was used

Everything under [`.kiro/`](.kiro) is committed, and [`.kiro/README.md`](.kiro/README.md) says plainly what Kiro did, what was done by hand, and where Kiro was wrong. Raw output of the Kiro sessions is in [`docs/kiro-evidence/`](docs/kiro-evidence) (one failed V3 run on 2026-11-09 is described there but not kept).

- **Specs.** Ten specs with EARS requirements, a design and tasks: `evidence-ledger`, `ghost-verifier`, `exorcism-plan`, `spooky-ui`, `ward-report`, `model-rate-limit`, and, written by Kiro in V3 spec mode on 2026-11-11, `ward-hardening`, `first-seance`, `haunting-map` and `seance-mcp`. All 585 task items are ticked. The last four, the browser checklists, were closed by hand in headless Chromium at the end.
- **Audits that became specs.** Kiro's read-only security review showed the ward verified less than the page promised; that became `ward-hardening`. Its first-run audit from a judge's seat became `first-seance`. Its accessibility audit was fixed test-first. After the work, the accessibility and first-run audits were run again on the result, and the inquisitor agent attacked the ward twice; the findings of each pass were fixed.
- **Custom agents with hooks.** `warden` builds test-first and gets a typecheck after every file write and the full suite when it stops. `inquisitor`, read-only and on a different model family, re-attacks the ward after a change. `archaeologist` answers questions about history and has its own claims checked by the ward.
- **MCP.** The repository's `seance` server gives Kiro the ledger and the ward as tools, next to the git and filesystem servers.
- **Steering.** Product, tech, evidence rules, UI rules, testing rules and the MCP server's rules, updated as the code changed.
- Earlier rounds on the free plan also used Kiro Powers (Context7) and Kiro Crew (two parallel subagents).

## License

MIT, see [LICENSE](LICENSE).
