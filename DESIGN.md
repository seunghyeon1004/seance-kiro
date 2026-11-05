# Séance: summon the ghost of whoever wrote this code (design)

Kiroween 2026 entry. Category: **Costume Contest** (haunting UI that is also the product). Fallback framing for Resurrection: "bring dead code back to life" (the Exorcism mode).
Rules checked (kiroween/RULES.md): new project built Oct 30 to Dec 4 2026; public GitHub repo with detectable OSS license (MIT) and the `.kiro/` directory committed (specs, hooks, steering; never in .gitignore); working app URL; demo video under 3 min on YouTube; write-up on how Kiro was used (IDE/CLI/Crew, custom agents, hooks, specs vs vibe coding, steering, MCP, PBT, powers). Judging, 20% each: Potential Impact, Technological Implementation (depth of Kiro use), Design, Innovation, Presentation. Optional bonus: blog post (#KiroweenHackathon26 social post, blog post mentioning the hackathon).

## 1. Problem and audience

Every codebase has haunted corners: a strange `sleep(3)`, a regex nobody dares touch, a workaround with no comment. The person who wrote it is gone and `git blame` shows a name and a date, not a reason. Developers burn hours doing "code archaeology" by hand: blame, log -L, read commit messages, hunt for the PR. Audience: anyone inheriting or maintaining legacy code, open-source maintainers, new hires, reviewers deciding whether a line is safe to delete.

## 2. Product

Point Séance at a repo (local path or public GitHub URL) and a file plus line range.

1. **Evidence (the "grave").** Deterministic, no AI: line-level history via `git blame --porcelain` and `git log -L`, rename-following, each commit's message, author, date, diff hunk, co-changed files, issue/PR references parsed from messages, and (public GitHub) PR/issue text. Output is an **Evidence Ledger**: numbered items, each tied to a full commit SHA.
2. **Séance (talk to the ghost).** A persona of the original author answers in first person, in a period-appropriate voice, but under hard rules:
   - it may only state facts present in the ledger;
   - every claim carries `[sha7]` citations and, where possible, an exact quote from a commit message or diff;
   - when evidence is silent it must say "the record is silent" (it is allowed to offer clearly-labelled speculation, shown in a different style, never as memory).
3. **The Verifier (the "ward").** The part that makes it trustworthy: the model returns structured JSON claims. A deterministic checker verifies (a) every cited SHA exists in the ledger, (b) every quoted string is a literal substring of the cited evidence, (c) dates/authors named match. Claims that fail are struck through or removed, and the UI shows "N of M claims verified". No invented memories can reach the user unmarked.
4. **Exorcism (bonus mode).** A "haunting score" for the file from measurable signals (age since last touch, churn, authors no longer active, TODO/FIXME/HACK count, no test referencing the file, nesting/size proxy). Then a **safe refactor plan**: characterization tests first, small reversible steps, and a "do not touch" list for lines whose history shows a deliberate fix/workaround (cited). Steps pass through the same Verifier.
5. **Crypt sample.** A bundled demo repo with a purpose-written history so the app works instantly, plus any public GitHub repo by URL.

Spooky UI is functional, not skin: candle flicker intensity = evidence confidence, the ouija planchette points at the cited commits, verified claims glow, unverified ones are ash-grey, fog thickens with the haunting score.

## 3. Architecture

TypeScript, Node 20, one repo:

```
src/
  evidence/        git.ts (blame, log -L, show), refs.ts (#123, Fixes), github.ts (PR/issue, optional token), ledger.ts
  ghost/           persona.ts (prompt), schema.ts (zod claims), verifier.ts (deterministic ward), llm.ts (Anthropic)
  exorcism/        score.ts (signals), plan.ts (LLM plan + verifier)
  server.ts        Hono API: /api/summon, /api/ask, /api/exorcise, /api/health, static UI
public/            vanilla HTML/CSS/JS spooky UI (candles, fog, planchette), no framework
test/              vitest + fast-check (property-based tests)
.kiro/             steering/, specs/, hooks/ (see section 5)
```

- LLM: Anthropic `claude-sonnet-5-5` with structured JSON output; fixture mode for tests. Server holds the key; hosted demo has a per-day cap.
- Remote repos: `git clone --filter=blob:none` into a temp dir with size/time limits, GitHub URLs only (SSRF-safe allowlist), no code execution from the repo.
- Evidence never leaves the ledger: the model sees only ledger text wrapped as untrusted data (commit messages can contain prompt injection; same hardening idea as my other projects, no references to them).

## 4. Data contracts

`EvidenceItem { id: "E3", sha, shortSha, author, date, subject, body, hunk, files[], refs[], pr?: {title, body} }`
`GhostAnswer { claims: [{ text, citations: [{sha7, quote?}], kind: "memory" | "speculation" | "silence" }], voice: string }`
Verifier result: `{ verified: Claim[], rejected: {claim, reason}[], score: verified/total }`.
Properties we test with PBT (fast-check): the verifier never accepts a citation absent from the ledger; a verified quote is always a substring of its cited text; line-range mapping through renames never yields a negative or out-of-order range; the haunting score is monotone in age and TODO count and always within 0..100.

## 5. How Kiro is used (so the .kiro directory is real, not decoration)

- **Steering** (`.kiro/steering/`): `product.md` (what Séance is, the no-invented-memory rule), `tech.md` (stack, commands, TS conventions), `evidence-rules.md` (inclusion rules for ledger items, citation format, verifier invariants), `ui-spooky.md` (design tokens, accessibility floor: contrast, reduced-motion respected, flicker under 3 Hz).
- **Specs** (`.kiro/specs/<feature>/requirements.md|design.md|tasks.md`): one per feature, in EARS requirements: `evidence-ledger`, `ghost-verifier`, `exorcism-plan`, `spooky-ui`. Kiro implements tasks from the specs; I record where spec-driven beat vibe coding in the write-up (verifier written from requirements, then PBT found edge cases).
- **Hooks** (`.kiro/hooks/`): on save of `src/ghost/**` run the verifier property tests; on save of `public/**` run an accessibility/reduced-motion lint; pre-commit-style hook that blocks committing `.env`; a hook that regenerates API docs from zod schemas.
- **PBT**: Kiro's property-based-testing workflow for the verifier and the score function.
- **Custom agent** (`.kiro/agents/archaeologist.json`): a Kiro CLI agent specialised for reading git history with read-only tools, used while developing to dogfood the idea.
- **MCP**: a git MCP server (history queries) and a GitHub MCP server for PR/issue text while building the fixtures; documented in the write-up with what it made easier.
- **Powers / Crew**: try one relevant Power if available and Kiro Crew for a parallel task (UI polish vs backend tests), report honestly what helped and what did not. IDE vs CLI vs Crew compared in the write-up. Only claim what I actually did: every hook/spec/agent in the write-up exists in the repo with commits that show it.
- Build log: commit messages reference the spec task being implemented (`spec: ghost-verifier T3`), giving judges a visible trail.

## 6. Plan (Nov 5 to Dec 4)

| When | Milestone |
|------|-----------|
| Nov 5-7 | Kiro CLI set up (done, logged in), repo, steering docs, specs for all four features |
| Nov 8-12 | Evidence ledger + crypt sample repo + tests; verifier + PBT |
| Nov 13-18 | Ghost (LLM) + API; exorcism score and plan |
| Nov 19-25 | Spooky UI, accessibility pass, hosted deploy (Render, Docker with git), license, README |
| Nov 26-30 | Demo video (under 3 min, YouTube public), write-up on Kiro use, blog post, social post with #KiroweenHackathon26 |
| Dec 1 | Request 4,000 free Kiro credits BEFORE Dec 1 12:00 PT (Resources tab) |
| Dec 2-3 | Buffer, final checks (license visible, .kiro committed, app URL up, video public) |
| Dec 4 14:00 PT | Submit (deadline; in KST Dec 5 07:00) |

## 7. Risks and decisions

- **Insufficient use of Kiro = disqualification.** Mitigation: every feature starts from a Kiro spec; keep the `.kiro` trail in git from day one; do real work in Kiro CLI sessions and keep notes.
- **Hallucinated history is the product's killer.** The Verifier plus the "record is silent" rule is the core; demo shows a rejected claim on screen.
- **Remote clone cost/abuse.** Size/time caps, GitHub-only, rate limit, cache; sample crypt always available offline.
- **Eligibility:** repo must be public with OSS license at submission (kept private until then, per instruction); disclose any pre-existing code (none planned; fixtures are written during the period).
- **Free credits:** the user must request the 4,000 Kiro credits on the Devpost Resources tab by Dec 1.
- **LLM key on a public demo:** per-day cap and fixture fallback.
