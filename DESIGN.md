# Séance: summon the ghost of whoever wrote this code (design)

Kiroween 2026 entry. Category: **Costume Contest** (haunting UI that is also the product). Fallback framing for Resurrection: "bring dead code back to life" (the Exorcism mode).
Rules checked (kiroween/RULES.md): new project built Oct 30 to Dec 4 2026; public GitHub repo with detectable OSS license (MIT) and the `.kiro/` directory committed (specs, hooks, steering; never in .gitignore); working app URL; demo video under 3 min on YouTube; write-up on how Kiro was used (IDE/CLI/Crew, custom agents, hooks, specs vs vibe coding, steering, MCP, PBT, powers). Judging, 20% each: Potential Impact, Technological Implementation (depth of Kiro use), Design, Innovation, Presentation. Optional bonus: blog post (#KiroweenHackathon26 social post, blog post mentioning the hackathon).

## 1. Problem and audience

Every codebase has haunted corners: a strange `sleep(3)`, a regex nobody dares touch, a workaround with no comment. The person who wrote it is gone and `git blame` shows a name and a date, not a reason. Developers burn hours doing "code archaeology" by hand: blame, log -L, read commit messages, hunt for the PR. Audience: anyone inheriting or maintaining legacy code, open-source maintainers, new hires, reviewers deciding whether a line is safe to delete.

## 2. Product

Point Séance at a repo (a bundled sample or a public GitHub URL; local paths only with `ALLOW_LOCAL=1`) and a file plus line range.

1. **Evidence (the "grave").** Deterministic, no AI: line-level history via `git blame --porcelain` and `git log -L`, rename-following, each commit's message, author, date, diff hunk, co-changed files, issue/PR references parsed from messages (PR/issue text is fetched only when an API client sends a GitHub token; the page does not, and it is not evidence the ghost may quote). Output is an **Evidence Ledger**: numbered items, each tied to a full commit SHA.
2. **Séance (talk to the ghost).** A persona of the original author answers in first person, in a period-appropriate voice, but under hard rules:
   - it may only state facts present in the ledger;
   - every claim carries `[sha7]` citations and, where possible, an exact quote from a commit message or diff;
   - when evidence is silent it must say "the record is silent" (it is allowed to offer clearly-labelled speculation, shown in a different style, never as memory).
3. **The Verifier (the "ward").** The part that makes it trustworthy: the model returns structured JSON claims. A deterministic checker verifies (a) every cited SHA names exactly one commit in the ledger, (b) every claim carries a quote, and the quote is a literal substring of one field of the cited commit (subject, message or diff), (c) a year or a ledger author named in the claim is supported by a cited commit. Claims that fail are struck through with the reason, silence claims are shown apart and never counted as verified, and the UI shows "N of M claims passed the ward" with the words the ward found under each claim. The ward proves the citation and the quote, not the paraphrase, and the page says so. (As first built, the quote was optional and (c) was not implemented; Kiro's security audit on 2026-11-11 found that, and the `ward-hardening` spec closed it.)
4. **Exorcism (bonus mode).** A "haunting score" for the file from measurable signals (age since last touch, churn, authors no longer active, TODO/FIXME/HACK count, no test referencing the file, nesting/size proxy). Then a **safe refactor plan**: characterization tests first, small reversible steps, and a "do not touch" list for lines whose history shows a deliberate fix/workaround (cited). Steps pass through the same Verifier.
5. **Samples.** Two bundled repos with purpose-written histories, so the app works instantly: `crypt` (a billing service with a mysterious three second wait) and `possessed` (a hostile repo whose commits try to give the ghost orders). Plus any public GitHub repo by URL (default branch, the most recent 100 commits).
6. **A guided first séance.** After a summon: one-click questions, one-click false claims for the ward to refuse, and a scripted "possessed ghost" that obeys the hostile commits so the refusal can be seen without depending on a model misbehaving. Recorded answers (from real model calls, re-checked by the live ward) keep the sample questions working when the model is unavailable.
7. **The haunting map.** Which files are haunted by which departed author, computed from git alone.
8. **An MCP server.** The ledger and the ward as tools for other coding agents; Kiro's own archaeologist agent uses it.

Spooky UI is functional, not skin: candle flicker intensity = evidence confidence, the ouija planchette points at the cited commits, verified claims glow, unverified ones are ash-grey, fog thickens with the haunting score.

## 3. Architecture

TypeScript, Node 20, one repo:

```
src/
  evidence/        git.ts (blame, log -L, show, clone), refs.ts (#123, suspicious messages), github.ts, ledger.ts,
                   haunting.ts (the map, pure) + haunting.read.ts (two git calls)
  ghost/           persona.ts (prompt: rules in `system`, escaped ledger in the user turn), schema.ts (zod),
                   verifier.ts (deterministic ward), llm.ts (Anthropic), report.ts (Markdown ward report),
                   recordings.ts (recorded answers), possessed-ghost.ts (the scripted obedient ghost)
  exorcism/        score.ts (signals), plan.ts (LLM plan + verifier, unverified steps dropped)
  mcp/             server.ts, app.ts, tools.ts ... (stdio MCP server: seance_summon, seance_verify, seance_haunting_map)
  ratelimit.ts     per-client and daily limiters, clone slots
  server.ts        Hono API: /api/summon, /api/ask, /api/ward, /api/possess, /api/exorcise, /api/health, static UI
public/            vanilla HTML/CSS/JS spooky UI (candles, fog, planchette, guide, map), no framework, no build step
scripts/           make-crypt.sh, make-possessed.sh, record-plan-fixture.ts, record-answers.ts, contrast.mjs
recordings/        answers recorded from real model calls for the sample questions
test/              vitest + fast-check (property-based) + real git + jsdom flows of the page (test/e2e/)
.kiro/             steering/, specs/, hooks/, agents/, settings/ (see section 5)
```

- LLM: Anthropic `claude-sonnet-5-5` with structured JSON output; fixture mode for tests. Server holds the key; hosted demo has a per-day cap.
- Remote repos: `git clone --filter=blob:none` into a temp dir with size/time limits, GitHub URLs only (SSRF-safe allowlist), no code execution from the repo.
- Evidence never leaves the ledger: the model sees only ledger text, escaped, as data in the user turn, while the rules travel in the `system` parameter (commit messages and author names can contain prompt injection). The design assumes the model can be fully compromised: what is labelled verified is decided by the deterministic ward alone, and `test/adversarial/` proves it with a scripted model that obeys every injected order.

## 4. Data contracts

`EvidenceItem { id: "E3", sha, shortSha, author, email, date, subject, body, hunk, files[], refs[], suspiciousMessage, pr?: {title, body} }`
`GhostAnswer { claims: [{ text, citations: [{sha7, quote}], kind: "memory" | "speculation" | "silence", silenceReason? }], voice, sessionId }` (the quote is mandatory, 8 to 500 characters)
Verifier result: `{ verified: [{claim, quotes: [{sha7, quote, field}]}], rejected: [{text, reason}], silent: [{claim}], score: verified / (verified + rejected + silent) }`.
Properties we test with PBT (fast-check): the verifier never accepts a citation absent from the ledger; a verified quote is always a substring of its cited text; line-range mapping through renames never yields a negative or out-of-order range; the haunting score is monotone in age and TODO count and always within 0..100. Added on 2026-11-11: a claim without a quote found in one field of the cited commit is never verified; the verifier only ever gets stricter (compared against two frozen earlier copies); a silence claim is never in `verified`; prompts keep exactly one evidence element per item whatever the commit text contains; the haunting map is the same under any input order and a living author's commit never raises a file's share.

## 5. How Kiro is used (so the .kiro directory is real, not decoration)

- **Steering** (`.kiro/steering/`): `product.md` (what Séance is, the no-invented-memory rule), `tech.md` (stack, commands, TS conventions), `evidence-rules.md` (inclusion rules for ledger items, citation format, verifier invariants), `ui-spooky.md` (design tokens, accessibility floor: contrast, reduced-motion respected, flicker under 3 Hz). Added on 2026-11-11: `testing.md` (applies to `test/**`) and `mcp-server.md` (applies to `src/mcp/**`).
- **Specs** (`.kiro/specs/<feature>/requirements.md|design.md|tasks.md`): one per feature, in EARS requirements. Planned: `evidence-ledger`, `ghost-verifier`, `exorcism-plan`, `spooky-ui`. Added later: `ward-report`, `model-rate-limit` (2026-11-09) and `ward-hardening`, `first-seance`, `haunting-map`, `seance-mcp` (2026-11-11, written by Kiro in V3 spec mode from its own audits). Kiro implements tasks from the specs; I record where spec-driven beat vibe coding in the write-up (verifier written from requirements, then PBT found edge cases).
- **Hooks**: as built, `.kiro/hooks/` holds two save hooks (ghost tests on save of `src/ghost/**`, a copy lint on save of `public/**`; written for the IDE and not seen firing in the CLI) and a `/review-evidence` prompt hook that checks a staged diff against the evidence rules. The hooks that do the daily work are the CLI agent hooks in `warden.json` (a typecheck after every file write, the full suite on stop) and `inquisitor.json`. The `.env` pre-commit hook and the API-docs hook planned here were not built.
- **PBT**: Kiro's property-based-testing workflow for the verifier and the score function.
- **Custom agents** (`.kiro/agents/`): `archaeologist`, a read-only agent for git history that now sends its own claims to the ward through the `seance` MCP server; `warden`, a test-first builder with hooks (typecheck after every write, the suite on stop); `inquisitor`, a read-only reviewer on a different model family that re-attacks the ward after a change.
- **MCP**: as built, a git MCP server, a filesystem MCP server, and Séance's own `seance` server (the ledger and the ward as tools). The GitHub MCP server planned here was not used.
- **Powers / Crew**: try one relevant Power if available and Kiro Crew for a parallel task (UI polish vs backend tests), report honestly what helped and what did not. IDE vs CLI vs Crew compared in the write-up. Only claim what I actually did: every hook/spec/agent in the write-up exists in the repo with commits that show it.
- Build log: commit messages reference the spec task being implemented (`spec: ghost-verifier T3`), giving judges a visible trail.

## 6. Plan (Nov 5 to Dec 4)

| When           | Milestone                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| Nov 5-7        | Kiro CLI set up (done, logged in), repo, steering docs, specs for all four features                              |
| Nov 8-12       | Evidence ledger + crypt sample repo + tests; verifier + PBT                                                      |
| Nov 13-18      | Ghost (LLM) + API; exorcism score and plan                                                                       |
| Nov 19-25      | Spooky UI, accessibility pass, hosted deploy (Render, Docker with git), license, README                          |
| Nov 26-30      | Demo video (under 3 min, YouTube public), write-up on Kiro use, blog post, social post with #KiroweenHackathon26 |
| Dec 1          | Request 4,000 free Kiro credits BEFORE Dec 1 12:00 PT (Resources tab)                                            |
| Dec 2-3        | Buffer, final checks (license visible, .kiro committed, app URL up, video public)                                |
| Dec 4 14:00 PT | Submit (deadline; in KST Dec 5 07:00)                                                                            |

## 7. Risks and decisions

- **Insufficient use of Kiro = disqualification.** Mitigation: every feature starts from a Kiro spec; keep the `.kiro` trail in git from day one; do real work in Kiro CLI sessions and keep notes.
- **Hallucinated history is the product's killer.** The Verifier plus the "record is silent" rule is the core; demo shows a rejected claim on screen.
- **Remote clone cost/abuse.** Size/time caps, GitHub-only, rate limit, cache; sample crypt always available offline.
- **Eligibility:** repo must be public with OSS license at submission (kept private until then, per instruction); disclose any pre-existing code (none planned; fixtures are written during the period).
- **Free credits:** the user must request the 4,000 Kiro credits on the Devpost Resources tab by Dec 1.
- **LLM key on a public demo:** per-day cap, and recorded answers for the sample questions when the model is unavailable.

## 8. What changed after the first submission (2026-11-11)

The entry was submitted on 2026-11-09, built on the free plan's 50 Kiro credits. When the hackathon's 4,000 bonus credits arrived, Kiro first audited the submission (security, accessibility, first run from a judge's seat) and the findings set the plan:

- The security audit showed the ward promised more than it checked. `ward-hardening` made the quote mandatory, added the year and author checks this document had always claimed, separated silence, escaped the prompt, and added the hostile `possessed` sample with tests that assume a fully compromised model.
- The first-run audit became `first-seance`: the guide, the line in question, recorded answers, wake-up retries, honest error and history states.
- Two features were added through full specs: `haunting-map` and `seance-mcp`.
- A second custom agent on a different model re-attacked the result, and both audits were repeated on the final page. Their findings were fixed as well.

Details, including where Kiro was wrong and what was done by hand, are in `.kiro/README.md`. Sections 1 to 7 above are the original plan, corrected where the code now differs; the plan table in section 6 is kept as written.
