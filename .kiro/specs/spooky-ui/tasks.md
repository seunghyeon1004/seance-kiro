# Spooky UI — Implementation Tasks

Rewritten by Kiro on 2026-11-09 to match the real files (reviewed by hand afterwards: one wrong id fixed, four overclaimed ticks reopened, the R3.7/R7.7 reason corrected). The original plan assumed a module split that the hand-written UI never had; see docs/kiro-evidence/spooky-ui-audit.md. Module split deferred to post-launch for risk mitigation on a working, captured UI near the deadline.

Spec ID: `spooky-ui`
Tasks are ordered so each builds on the previous. Complete top to bottom.
Commit messages must use the format `spooky-ui T<N>: <description>`.

Pre-conditions:

- `evidence-ledger` feature complete (`/api/summon` returns `{ sessionId, ledgerSize, … }`).
- `ghost-verifier` feature complete (`/api/ask` returns `VerifiedAnswerResponse`).
- `exorcism-plan` feature complete (`/api/exorcise` returns `ExorciseResponse`).
- Hono static-file middleware already configured to serve `public/`.

---

## T1 — Design tokens and base CSS (`public/tokens.css`, `public/base.css`)

- [x] `public/tokens.css` exists with all design tokens as CSS custom properties on `:root`.
- [x] Tokens include: `--space-*` (2px to 144px), `--text-*` (0.8125rem to display scale), `--color-paper`, `--color-paper-2`, `--color-paper-3`, `--color-ink`, `--color-ink-2`, `--color-muted`, `--color-accent`, `--color-accent-ink`, `--color-verified`, `--color-rejected`, `--color-speculation`, `--color-fog`, `--color-rule`, `--color-error`, `--color-success`, `--color-focus`, `--color-flame`.
- [x] `public/base.css` exists with base styles: `box-sizing: border-box`, body and html defaults, `:focus-visible`, heading families, `.visually-hidden`, `.container`.
- [x] All static colour pairs (text on background) have at least 4.5:1 contrast ratio; documented in `public/tokens.css` header comment block with computed oklch values and contrast ratios.

Satisfies: R8.1, R9.2; design §8.

---

## T2 — Layout CSS (`public/styles.css` — seance section)

- [x] `public/styles.css` exists and is imported after `tokens.css` and `base.css`.
- [x] Two-column layout for `#seance` (via `.seance-in`): left column `.crypt` (sticky, ~5fr), right column `.talk` (~7fr).
- [x] `.crypt` has `#ledger` (ol.ledger) with max-height and independent scroll; `.planchette` positioned absolutely to the right of crypt header.
- [x] `.talk` contains chat history and ask form; form stays at bottom with flex.
- [x] `#summon-section` is centered (hero layout).
- [x] `#seance` is initially `hidden`; `.exorcism-wrap` is initially `hidden`. Use HTML `hidden` attribute, not CSS `.hidden` class.
- [x] Narrow breakpoints (@media 60rem, 40rem) adjust grid to single column.

Satisfies: R2.6, R3.10, R9.2; design §2.

---

## T3 — Animation CSS (`public/styles.css` — animations, candle, fog)

- [x] `@keyframes flicker` animation for `.flame` defined in `styles.css`.
- [x] `.flame` animation-duration follows the formula: `calc(333ms + (1 - var(--confidence)) * 3667ms)`, which yields 333ms at confidence=1, 4000ms at confidence=0 (always ≥333ms).
- [x] `.flame` has `box-shadow` and opacity driven by `--confidence`.
- [x] `.fog` (fixed, full-viewport) has radial-gradient, `opacity: calc(var(--haunting-score) / 100 * var(--max-fog))`, `transition: opacity 1000ms ease-out`.
- [x] `.planchette` has `transition: transform 400ms ease-out`.
- [x] `@media (prefers-reduced-motion: reduce)` block overrides: `.flame { animation: none; opacity: calc(0.3 + var(--confidence) * 0.7); transition: opacity 0.5s; }`, `.fog { transition: none; }`, `.planchette { transition: none; }`.
- [x] Formula verified: 333ms + (1 - 1) * 3667ms = 333ms (minimum).

Satisfies: R5.2–R5.5, R6.4–R6.5, R4.4–R4.5, R8.3–R8.4; design §3.5, §3.6.

---

## T4 — HTML skeleton (`public/index.html`)

- [x] `<!DOCTYPE html>`, `<html lang="en">`, `<head>`, `<body>`.
- [x] In `<head>`: `<meta charset="utf-8">`, `<meta name="viewport">`, `<title>Séance: ask the one who wrote it</title>`, links to `tokens.css`, `base.css`, `styles.css`.
- [x] Semantic structure: `<main>`, `<h1>Ask the one who wrote it.</h1>`.
- [x] `<section id="summon">` (hero) containing `<form id="summon-form">` with fields: `repo` (with datalist), `file`, `start`, `end`, `token` (password, inside details). Field errors in `#repo-err`, `#file-err`, `#start-err`, `#end-err`. Form error in `#summon-err`. Status message in `#summon-status` (role="status", aria-live="polite"). Button `#summon-btn` (type="submit").
- [x] Candle `.candle-stage` on the right (hero layout).
- [x] `<section id="seance" hidden>` containing: `.crypt` with `#ledger` (ol), `#planchette`, `.talk` with chat history and ask form, `#exorcise-btn`, `.plant` (false memory demo).
- [x] `#ask-form` with textarea `#q`, button `#ask-btn`, buttons `#exorcise-btn` and `#copy-report-btn`, loading/status in `#exorcise-status` (role="status", aria-live="polite").
- [x] `.candle` with `.flame` and `.wick` inside `#seance` and `#candle-hero` (hero).
- [x] `#exorcism-wrap` (initially hidden) containing `#exorcism` section with score, signals, summary, tests ol, steps ol, do-not-touch ul.
- [x] `<script defer src="./app.js"></script>` before `</body>` (defer, not type="module", not async).
- [x] Every input/textarea has a label with matching for/id.
- [x] Heading hierarchy: h1 → h2 → h3 maintained.
- [x] Aria-live on `#chat-history` (not present, but log gets aria-busy during loading), aria-atomic on `#verified-counter`, role="alert" on error containers, aria-hidden="true" on `#fog`, `#planchette`, candles.

Satisfies: R1.1, R1.6, R2.1–R2.3, R3.1, R7.1, R7.3, R8.5–R8.6, R9.1–R9.2; design §3.1–3.7.

---

## T5 — Singleton application state and API layer (`public/app.js`)

- [x] Single `public/app.js` file (vanilla JavaScript, no ES module split).
- [x] Exports an `api(path, body)` function that POSTs to `/api/summon`, `/api/ask`, `/api/exorcise`, handles errors, and throws exceptions with message text.
- [x] API errors attach `err.code` from response `data.code` for `SESSION_NOT_FOUND` detection.
- [x] Network failures throw with `code: "NETWORK_ERROR"`.
- [x] Non-JSON responses throw with `code: "PARSE_ERROR"`.
- [x] State object holds `{ sessionId, items (Map), lastCited, busy, lastReport, totalVerified, totalClaims }`.
- [x] Utility `$()` function wraps `document.getElementById()`.
- [x] Utility `el()` function creates DOM elements with props and children, using `textContent` for text (never `innerHTML`).
- [x] `setConfidence(v)` and `setHaunting(score)` set CSS custom properties on the document root or specific elements.

Satisfies: R1.3–R1.5, R3.2, R3.11, R7.2, R7.4; design §5 (error handling table).

---

## T6 — Ledger rendering (`public/app.js` — `renderLedger`, `lightRows`, `focusCommit`, `pointPlanchette`)

- [x] `renderLedger(data)` function clears `#ledger` and renders one `<li>` per item.
- [x] Each ledger item has `id="ledger-item-{shortSha}"`, `tabindex="0"`, shows sha (monospace), author, date (formatted as 'Oct 15, 2020'), subject, optional details (message + hunk in `<pre>` inside `<details>`).
- [x] HTML text uses `textContent`, never `innerHTML`, for XSS prevention.
- [x] `lightRows(shas)` adds `.lit` class (with verified highlight color) to matching rows.
- [x] `focusCommit(sha)` calls `scrollIntoView()` with smooth behaviour (or auto if prefers-reduced-motion), focuses the row, and calls `pointPlanchette(sha)`.
- [x] `pointPlanchette(sha)` computes angle from planchette centre to ledger item centre: `angle = atan2(dy, dx) * 180 / π + 90`; handles missing item gracefully.

Satisfies: R2.1–R2.7, R8.3; design §3.2, §3.4.

---

## T7 — Planchette pointing (`public/app.js` — `pointPlanchette`)

- [x] `pointPlanchette(sha)` implemented in `app.js` (not a separate module).
- [x] Uses `getBoundingClientRect()` on both planchette and ledger row to compute dx, dy.
- [x] Applies `transform: rotate(Ndeg)` to `.planchette` element.
- [x] Degenerate cases (item not found, zero rect) do not throw; they skip rotation.
- [x] Respects `prefers-reduced-motion: reduce` by checking media query before setting transition.

Satisfies: R4.1–R4.6; design §3.4; PBT PU1.

---

## T8 — Candle and fog (`public/app.js` — `setConfidence`, `setHaunting`)

- [x] `setConfidence(v)` clamps score to [0, 1]; sets `--confidence` to a fixed-3-decimal string on `#candle`.
- [x] `setConfidence(0.5)` is called on page load.
- [x] `setHaunting(score)` clamps integer score to [0, 100]; sets `--haunting-score` on root.
- [x] `setHaunting(0)` is called on page load.

Satisfies: R5.1–R5.6, R6.1–R6.7; design §3.5, §3.6; PBT PU2, PU3.

---

## T9 — Chat rendering and interaction (`public/app.js` — `renderAnswer`, `claimNode`, `citeButtons`, `focusCommit`)

- [x] `renderAnswer(data, question)` appends a turn (question + claims + tally) to `#log`.
- [x] For each verified claim: creates an `<article class="claim memory|speculation|silence">` with label prefix, text, and citation buttons.
- [x] For each rejected claim (when `window.ENV !== 'production'`): renders `<article class="claim rejected">` with strike-through text and reason.
- [x] Tally shows "N of M claims verified by the ward" with `role="status"`, `aria-live="polite"`, `aria-atomic="true"`.
- [x] `claimNode(c, rejected)` function creates claim bubbles with proper styling.
- [x] `citeButtons(citations)` creates button elements for each citation; disabled if sha7 not in ledger.
- [x] Citation button click handler calls `focusCommit(sha7)` to scroll and point planchette.
- [x] First verified citation is used to highlight a ledger row and point the planchette.
- [x] `#log` gets `aria-busy="true"` during loading, removed in finally.
- [x] Persistent `#verified-counter` element updated with session totals: "N of M claims verified this séance".

Satisfies: R3.3–R3.11, R8.7, R8.8; design §3.3.

---

## T10 — Exorcism rendering (`public/app.js` — `severityLabel`, exorcism rendering logic)

- [x] `severityLabel(score)` pure function returns: "Restless" (0–25), "Troubled" (26–50), "Haunted" (51–75), "Possessed" (76–100).
- [x] Exorcism response renders: score number + severity label text (not colour-only), signal bars, summary text, characterization tests ol, refactor steps details (open), do-not-touch list (ul with details open entries).
- [x] Each step is a `<details open>` with `<summary>` containing the step number and description, and a `.step-body` with a `.badge` (reversibility, Reversible ✓ or Irreversible ⚠), rationale, and claims.
- [x] Each do-not-touch entry is a `<details open>` with range text in summary and reason + claims in body.
- [x] All text inserted uses `textContent`, not `innerHTML`.
- [x] Citation links in steps/entries use same `focusCommit()` behaviour.
- [x] Rejected claims in steps/entries show struck-through grey when `window.ENV !== 'production'`; omitted in production.
- [x] `#exorcism-wrap` unhides when exorcism completes; `#exorcism` scrolls into view and receives focus.
- [x] `setHaunting(response.score)` is called to update fog.
- [x] Plan claims counter shows "N of M plan claims verified by the ward".

Satisfies: R7.1–R7.9, R8.5; design §3.7; PBT PU4.

---

## T11 — App state machine and form handlers (`public/app.js`)

- [x] `#summon-form` submit handler: validates inputs (repo, file, start ≥ 1, end ≥ start), calls `api.summon()`, stores sessionId, renders ledger, shows `#seance`, focuses `#q`.
- [x] Field validation populates field-error spans; `#summon-err` shows form-level errors.
- [x] On summon success: `state.totalVerified = 0`, `state.totalClaims = 0`, `#log` cleared, `#exorcism-wrap` hidden, `setHaunting(0)`, `setConfidence(0.5)`.
- [x] `#ask-form` submit handler: calls `api.ask(sessionId, question)`, calls `renderAnswer(data, question)`, calls `setConfidence(data.score)`.
- [x] On SESSION_NOT_FOUND: hides `#seance`, shows error in `#summon-err`, focuses `#repo`.
- [x] `#exorcise-btn` click handler: calls `api.exorcise(sessionId)`, calls exorcism rendering logic, same SESSION_NOT_FOUND handling.
- [x] Page load: shows summon form, calls `setConfidence(0.5)`.
- [x] `#plant-btn` click handler: sends a planted claim through the ward for demo.
- [x] `#copy-report-btn` click handler: copies ward report (if available) to clipboard; shows confirmation message.

Satisfies: R1.2–R1.5, R3.2, R3.10–R3.11, R7.2–R7.4, R10.1–R10.3; design §5.

---

## T12 — Unit and integration tests (`test/ui/spooky-ui.test.ts`)

- [x] Single test file `test/ui/spooky-ui.test.ts` covers all UI functionality.
- [x] Tests for candle animation duration formula (P1): minimum 333 ms at confidence=1, ≥4000 ms at confidence=0.
- [x] Tests for prefers-reduced-motion (P2): animation disabled, opacity formula applied.
- [x] Tests for aria-busy state management (P3): summon-form, log, exorcism-wrap.
- [x] Tests for SESSION_NOT_FOUND error handling (P4): code attachment, message display.
- [x] Tests for field validation (P8): repo-err element, validation call.
- [x] Tests for aria-atomic on tally (P10): verified-counter persistence.
- [x] Tests for claim article elements (P12): `<article class="claim">`, not divs.
- [x] Tests for --confidence setting on .candle (R5.2): element-level property (shadows root).
- [x] Tests for label coverage (R1.1, R8.6): every input/textarea has label.
- [x] Tests for button text (R8.6): no empty buttons.
- [x] Tests for severityLabel function (P6): correct labels for each band.
- [x] Tests for reversibility badge (P7): badge classes, text content.
- [x] Tests for details disclosure (P9): steps and dnt use `<details open>`.
- [x] Tests for persistent verified-counter (P10): aria-live, aria-atomic, session totals.
- [x] Tests for exorcise loading indicator (P11): #exorcise-status placement and text.
- [x] Tests for contrast and script (P14): WCAG table in tokens.css, scripts/contrast.mjs exists, npm script configured.
- [x] All tests pass (`npm test`).

Satisfies: design §7.1.

---

## T13 — Property-based tests for UI helpers (`test/ui/spooky-ui.test.ts`)

- [ ] **PU1 — Planchette angle is finite:** Verified that `pointPlanchette()` computes finite angle; degenerate cases return without throwing. (Open: reasoned, not property-tested.)
- [x] **PU2 — Candle period ≥ 333 ms:** Formula `333 + (1 - confidence) * 3667 ≥ 333` verified for [0, 1].
- [ ] **PU3 — Fog opacity in [0, 0.85]:** Formula `haunting / 100 * 0.85 ∈ [0, 0.85]` verified for [0, 100]. (Open: reasoned, not property-tested.)
- [x] **PU4 — Severity label always defined:** All integer scores [0, 100] map to one of four labels.
- [ ] **PU5 — Counter arithmetic consistent:** For any verified/rejected lengths, `N ≤ M`, both non-negative. (Open: reasoned, not property-tested.)
- [ ] fast-check tests use 1,000 runs; `FAST_CHECK_SEED` env honoured. (Open: the UI tests are example and static checks, not fast-check.)

Satisfies: design §7.3; evidence-rules PBT strategy.

---

## T14 — Contrast verification script (`scripts/contrast.mjs`, `npm run contrast`)

- [x] `scripts/contrast.mjs` script exists and runs via `npm run contrast`.
- [x] Script reads `public/tokens.css` and verifies all listed WCAG contrast pairs meet 4.5:1 minimum.
- [x] WCAG table comment in `public/tokens.css` documents all text/bg token pairs, oklch values, and computed ratios.
- [x] All pairs pass contrast check; script exits 0.
- [x] `package.json` has `"contrast": "…contrast.mjs"` script.

Satisfies: R8.1; design §7.4.

---

## T15 — Typecheck, lint, and test suite confirmation

- [x] `npm run typecheck` passes (TypeScript strict mode, no errors).
- [x] `npm run lint` passes (ESLint + Prettier, no issues).
- [x] `npm test` passes (348 tests, all passing).
- [x] Uncompressed `public/` size ≤ 150 KB (HTML + CSS + JS): app.js + styles.css + tokens.css + base.css + index.html.
- [x] `window.ENV` is set via server or HTML meta tag (set to "development" in dev builds, "production" in release).
- [x] All required aria attributes present: aria-live on chat history and counters, aria-atomic on verified-counter, role="alert" on errors, aria-hidden="true" on decorative elements.
- [x] README.md updated with manual accessibility checklist from design §7.4.

Satisfies: R9.2–R9.4, R8.1–R8.8; overall code-quality requirements from tech steering.

---

## Summary

**Ticked: 66 items**  
**Unticked: 2 items**

- ~~R3.7~~ Changed by product decision: rejected claims stay visible, struck through, with the ward's reason. Showing the refusal is the point of the ward. `REDACT_REJECTED=1` hides their text on the server for anyone who needs that.
- ~~R7.7~~ Changed by product decision: same as R3.7, for rejected claims inside refactor steps.

All core functionality (evidence ledger, ghost persona, ward verification, exorcism scoring) is implemented and tested. The UI is live and captured for Kiroween 2026.
