# Spooky UI — Implementation Tasks

Spec ID: `spooky-ui`
Tasks are ordered so each builds on the previous. Complete top to bottom.
Commit messages must use the format `spooky-ui T<N>: <description>`.

Pre-conditions:

- `evidence-ledger` feature complete (`/api/summon` returns `{ sessionId, ledgerSize, … }`).
- `ghost-verifier` feature complete (`/api/ask` returns `VerifiedAnswerResponse`).
- `exorcism-plan` feature complete (`/api/exorcise` returns `ExorciseResponse`).
- Hono static-file middleware already configured to serve `public/`.

---

## T1 — Design tokens and base CSS (`public/css/theme.css`)

- [ ] Create `public/css/theme.css`.
- [ ] Declare all design tokens from design §8 as CSS custom properties on `:root`:
      `--color-bg`, `--color-fog`, `--color-candle`, `--color-verified`, `--color-rejected`,
      `--color-speculation`, `--confidence` (initial `0.5`), `--haunting-score` (initial `0`).
- [ ] Set `body { background: var(--color-bg); color: #e8e8e8; font-family: system-ui, serif; }`.
- [ ] Set monospace family on `.ledger-sha`, `.ledger-hunk`, `.ledger-body`, `.citation-link`,
      `.claim-citations`.
- [ ] Verify all static colour pairs (text on background) have at least 4.5:1 contrast ratio
      using the WCAG relative-luminance formula; document computed ratios in a comment block.

Satisfies: R8.1, R9.2; design §8.

---

## T2 — Layout CSS (`public/css/layout.css`)

- [ ] Create `public/css/layout.css`.
- [ ] Define a two-column layout for `#seance-section`: left column `#ledger-panel` (fixed width
      ~320px, independently scrollable), right column `#chat-panel` (flex-grow, independently
      scrollable).
- [ ] Ensure `#exorcism-panel` is a full-width section below the two-column layout.
- [ ] Ensure `#chat-panel` always shows the `<form id="ask-form">` at the bottom; chat history
      scrolls above it.
- [ ] Ensure `#summon-section` is centered and constrained to a max-width of 560px.
- [ ] Hide `#seance-section` and `#exorcism-panel` by default (`display: none`); add a
      `.visible` utility class that sets `display: block` / `display: flex` as appropriate.

Satisfies: R2.6, R3.10, R9.2; design §2.

---

## T3 — Animation CSS (`public/css/animations.css`)

- [ ] Create `public/css/animations.css`.
- [ ] Define the `@keyframes flicker` animation as specified in design §3.5.
- [ ] Apply the `flicker` animation to `.flame` with `animation-duration` driven by the
      `--confidence` formula (design §3.5); confirm the formula yields ≥ 333 ms for any value
      of `--confidence` in [0, 1].
- [ ] Define `.fog-layer` styles with the radial-gradient fog, `pointer-events: none`,
      `--fog-opacity` derived from `--haunting-score`, and `transition: --fog-opacity 1s ease`
      (with `@property` declaration for `--fog-opacity` if needed for transition support).
- [ ] Define `.planchette` with `transition: transform 400ms ease` (default motion).
- [ ] Add a single `@media (prefers-reduced-motion: reduce)` block that overrides: - `.flame { animation: none; opacity: calc(0.3 + var(--confidence, 0.5) * 0.7); transition: opacity 0.5s ease; }` - `.fog-layer { transition: none; }` - `.planchette { transition: transform 0ms; }`
- [ ] Verify the flicker `animation-duration` formula can never produce a value < 333 ms by
      evaluating the expression at `--confidence = 1`; add a comment with the computed value.

Satisfies: R5.2–R5.5, R6.4–R6.5, R4.4–R4.5, R8.3–R8.4; design §3.5, §3.6.

---

## T4 — HTML skeleton (`public/index.html`)

- [ ] Create `public/index.html` with `<!DOCTYPE html>`, `<html lang="en">`, `<head>`, `<body>`.
- [ ] In `<head>`: `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width,
  initial-scale=1">`, `<title>Séance</title>`, links to the three CSS files.
- [ ] Add semantic structure: `<main>`, `<h1>Séance</h1>`.
- [ ] Add `<section id="summon-section">` containing `<form id="summon-form">` with: - `<label for="repo-url">Repository URL or path</label>` + `<input id="repo-url" …>` +
      `<span class="field-error" id="repo-url-error" aria-live="polite"></span>` - Same pattern for `file`, `start-line` (type="number" min="1"), `end-line`
      (type="number" min="1"), `github-token` (type="password"). - `<div id="summon-error" role="alert" class="error-notice hidden"></div>` - `<div id="summon-loading" aria-live="polite" hidden>Gathering evidence…</div>` - `<button type="submit" id="summon-btn">Summon</button>`
- [ ] Add `<section id="seance-section" hidden>` containing: - `<div id="ledger-panel">` with `<h2>Ledger Crypt</h2>` and `<ul id="ledger-list">`. - `<div id="planchette" aria-hidden="true" class="planchette"></div>` - `<div id="chat-panel">` with `<h2>Séance</h2>`,
      `<div id="chat-history" aria-live="polite" aria-relevant="additions"></div>`,
      `<div id="verified-counter" aria-live="polite" aria-atomic="true"></div>`,
      `<form id="ask-form">` (textarea + `<div id="ask-loading" hidden>The ghost stirs…</div>` + button). - `<div id="candle-section" aria-hidden="true"><div class="candle"><div class="flame"></div></div></div>` - `<div id="fog-layer" aria-hidden="true" class="fog-layer"></div>` - `<button id="exorcise-btn">Exorcise</button>` + `<div id="exorcise-loading" hidden aria-live="polite">Performing exorcism…</div>` + `<div id="exorcise-error" role="alert" class="error-notice hidden"></div>`
- [ ] Add `<section id="exorcism-panel" hidden>` with `<h2>Exorcism Report</h2>` and placeholder
      containers for score, signals, characterization tests, steps, and do-not-touch list.
- [ ] Add `<script type="module" src="js/app.js"></script>` before `</body>`.
- [ ] Confirm every `<input>` has a corresponding `<label>` with matching `for`/`id`.
- [ ] Confirm `<h1>` → `<h2>` → `<h3>` heading hierarchy is maintained.

Satisfies: R1.1, R1.6, R2.1–R2.3, R3.1, R7.1, R7.3, R8.5–R8.6, R9.1–R9.2; design §3.1–3.7.

---

## T5 — API module (`public/js/api.js`)

- [ ] Create `public/js/api.js`.
- [ ] Export `async function summon(payload)` — POST `/api/summon`, return parsed JSON, throw
      `ApiError` with `{ status, code, error }` on non-200.
- [ ] Export `async function ask(sessionId, question)` — POST `/api/ask`, same error convention.
- [ ] Export `async function exorcise(sessionId, options)` — POST `/api/exorcise`, same convention.
- [ ] `ApiError` is a plain class extending `Error` with `status`, `code`, and `error` fields.
- [ ] Handle `fetch` network failures (promise rejection) by throwing `ApiError` with
      `status: 0`, `code: "NETWORK_ERROR"`, `error: "Network error — please try again"`.
- [ ] Handle non-JSON responses (e.g. HTML 500 pages) by catching `JSON.parse` errors and
      throwing `ApiError` with `code: "PARSE_ERROR"`, `error: "Unexpected server response"`.

Satisfies: R1.3–R1.5, R3.2, R3.11, R7.2, R7.4; design §5 (error handling table).

---

## T6 — Ledger module (`public/js/ledger.js`)

- [ ] Create `public/js/ledger.js`.
- [ ] Export `function init(items)` — clear `#ledger-list`, render one `<li>` per item using the
      HTML template in design §3.2; each `<li>` has `id="ledger-item-{shortSha}"` and
      `tabindex="0"`.
- [ ] Export `function highlightItem(sha7)` — remove `ledger-item--cited` from any existing
      highlighted row; add it to the matching row if found.
- [ ] Export `function clearHighlight()` — remove `ledger-item--cited` from all rows.
- [ ] Export `function scrollToItem(sha7)` — call `scrollIntoView({ behavior: 'smooth',
  block: 'center' })` on the matching row; use `behavior: 'instant'` when
      `window.matchMedia('(prefers-reduced-motion: reduce)').matches`.
- [ ] Format the `date` field as a human-readable string using `new Date(date).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })`.
- [ ] Escape HTML in all ledger text fields before inserting into the DOM (use `textContent`
      assignment or a `escapeHtml()` helper, not `innerHTML` for untrusted text).

Satisfies: R2.1–R2.7, R8.3; design §3.2.

---

## T7 — Planchette module (`public/js/planchette.js`)

- [ ] Create `public/js/planchette.js`.
- [ ] Export `function pointAt(sha7)` implementing the angle computation from design §4.3:
      `angle = Math.atan2(dy, dx) * (180 / Math.PI) − 90`, where `dx`/`dy` are measured from
      the planchette's `getBoundingClientRect()` centre to the ledger item's `getBoundingClientRect()` midpoint.
- [ ] Handle the degenerate case where the ledger item is not found or `getBoundingClientRect()`
      returns a zero rect: skip the rotation (leave unchanged) rather than applying `NaN`.
- [ ] Apply the reduced-motion check before setting `element.style.transition`:
      if `prefers-reduced-motion: reduce` is active, set `transition: 'transform 0ms'`; otherwise
      restore `transition: ''` (falls back to CSS-defined 400 ms).
- [ ] Export `function reset()` — set `element.style.transform = 'rotate(0deg)'`.

Satisfies: R4.1–R4.6; design §3.4; PBT PU1.

---

## T8 — Candle and fog modules (`public/js/candle.js`, `public/js/fog.js`)

- [ ] Create `public/js/candle.js`.
  - Export `function setConfidence(score)` — clamp `score` to [0, 1]; set
    `document.documentElement.style.setProperty('--confidence', score.toFixed(3))`.
  - Call `setConfidence(0.5)` on module load (initial state).
- [ ] Create `public/js/fog.js`.
  - Export `function setHauntingScore(score)` — clamp integer `score` to [0, 100]; set
    `document.documentElement.style.setProperty('--haunting-score', String(score))`.
  - Call `setHauntingScore(0)` on module load.

Satisfies: R5.1–R5.6, R6.1–R6.7; design §3.5, §3.6; PBT PU2, PU3.

---

## T9 — Chat module (`public/js/chat.js`)

- [ ] Create `public/js/chat.js`.
- [ ] Export `function appendResponse(answer)`: - For each claim in `answer.verified`: create a claim bubble `<article>` with the
      correct class (`claim--memory`, `claim--speculation`, `claim--silence`), text, label
      prefix, and citation links. - If `answer.rejected.length > 0` and `window.ENV !== 'production'`: append rejected
      bubbles with `claim--rejected` class and `aria-label="Unverified claim"`. - Append the "N of M claims verified" line to `#verified-counter`. - Auto-scroll `#chat-history` to its bottom (`scrollTop = scrollHeight`). - Call `planchette.pointAt(firstCitationSha7)` for the first citation found across all
      verified claims (if any); call `ledger.highlightItem(sha7)` for the same sha7.
- [ ] Export `function showLoading()` — set `#ask-loading` `hidden = false`; set
      `#ask-form button` `disabled = true`; set `aria-busy="true"` on `#chat-panel`.
- [ ] Export `function hideLoading()` — reverse the above.
- [ ] Export `function showError(message)` — append an `<div role="alert" class="chat-error">` to
      `#chat-history`.
- [ ] Citation link click handler: call `ledger.scrollToItem(sha7)` and
      `planchette.pointAt(sha7)` on click/Enter; prevent default link navigation.

Satisfies: R3.3–R3.11, R8.7, R8.8; design §3.3.

---

## T10 — Exorcism module (`public/js/exorcism.js`)

- [ ] Create `public/js/exorcism.js`.
- [ ] Export `function render(response)`: - Set `#exorcism-panel` `hidden = false`. - Render score display with numeric value and severity badge text as per R7.3. - Export `function getSeverityLabel(score)` as a named export: returns "Restless" (0–25),
      "Troubled" (26–50), "Haunted" (51–75), "Possessed" (76–100). - Render signal breakdown table (six rows). - Render marker locations list; show "No markers found" when empty. - Render characterization tests as a numbered `<ol>`. - Render refactor steps as `<details>` cards with description, rationale, reversibility
      badge ("Reversible ✓" or "Irreversible ⚠"), and citation links. - Render do-not-touch entries as `<details>` cards with line range, reason, and citations. - Call `fog.setHauntingScore(response.score)` to update fog density. - Rejected claims in steps/entries: render struck-through grey text when
      `window.ENV !== 'production'`; otherwise omit.
- [ ] Citation links in the exorcism panel shall use the same `ledger.scrollToItem` and
      `planchette.pointAt` behaviour as chat citations (R7.6).
- [ ] All text inserted from `response` fields shall use `textContent` or `escapeHtml()`, not
      `innerHTML`, for XSS prevention.

Satisfies: R7.1–R7.9, R8.5; design §3.7; PBT PU4.

---

## T11 — App state machine (`public/js/app.js`)

- [ ] Create `public/js/app.js` as an ES module.
- [ ] Import `api`, `ledger`, `chat`, `exorcism`, `planchette`, `candle`, `fog` modules.
- [ ] Declare `let state = { phase: 'summon', sessionId: null, hauntingScore: 0, lastConfidence: 0.5 }`.
- [ ] Implement `showSummonForm()` / `showSeanceView()` functions that toggle `hidden` on
      `#summon-section` and `#seance-section` and manage `aria-hidden` where appropriate.
- [ ] Attach submit handler to `#summon-form`: - Run client-side validation; on error, populate field-error spans and `return`. - Show loading state; call `api.summon(payload)`. - On success: store `sessionId`, call `ledger.init(summonResponse.ledgerItems)`, call
      `showSeanceView()`, focus chat textarea. - On error: display error in `#summon-error`, restore button.
- [ ] Attach submit handler to `#ask-form`: - Call `chat.showLoading()`. - Call `api.ask(state.sessionId, question)`. - On success: call `chat.hideLoading()`, `chat.appendResponse(answer)`,
      `candle.setConfidence(answer.score)`. - On `SESSION_NOT_FOUND`: show "Session expired" notice, call `showSummonForm()`. - On other error: call `chat.hideLoading()`, `chat.showError(message)`.
- [ ] Attach click handler to `#exorcise-btn`: - Show `#exorcise-loading`; disable button. - Call `api.exorcise(state.sessionId, {})`. - On success: call `exorcism.render(response)`. - On `SESSION_NOT_FOUND`: same as ask handler. - On error: show `#exorcise-error`, re-enable button.
- [ ] On page load, call `showSummonForm()` and `candle.setConfidence(0.5)`.
- [ ] Set `window.ENV` from a `<meta name="env" content="…">` tag in `index.html` (set to
      `"production"` or `"development"`) so `chat.js` and `exorcism.js` can branch on it.

Satisfies: R1.2–R1.5, R3.2, R3.10–R3.11, R7.2–R7.4, R10.1–R10.3; design §5.

---

## T12 — Unit tests for UI modules (`test/ui/`)

- [ ] Create `test/ui/ledger.test.ts`: - `init` renders correct number of `<li>` elements with correct `id` attributes. - `highlightItem` adds `ledger-item--cited` to exactly one row; calling again moves it. - `scrollToItem` calls `scrollIntoView` on the matching element.
- [ ] Create `test/ui/chat.test.ts`: - `appendResponse` with all verified claims renders no `.claim--rejected` bubbles. - `appendResponse` with rejected claims and `window.ENV !== 'production'` renders rejected
      bubbles. - Counter shows correct "N of M" string. - Citation links have correct `href` and `aria-label`.
- [ ] Create `test/ui/exorcism.test.ts`: - `getSeverityLabel` returns correct label for each of the four score bands (0, 25, 26, 50,
      51, 75, 76, 100). - `render` creates the correct number of refactor step `<details>` elements. - Reversibility badge text is "Reversible ✓" for `reversible: true`.
- [ ] Create `test/ui/planchette.test.ts`: - `pointAt` sets a `transform` style containing `rotate(`. - Returns without throwing when target element not found.
- [ ] Create `test/ui/candle.test.ts`: - `setConfidence(0.75)` sets `--confidence` to `"0.750"` on `documentElement`.
- [ ] Create `test/ui/fog.test.ts`: - `setHauntingScore(60)` sets `--haunting-score` to `"60"` on `documentElement`.

All tests use `jsdom` environment (configured via `vitest.config.ts`).

Satisfies: design §7.1.

---

## T13 — Property-based tests for UI helpers (`test/ui/pbt/ui.pbt.ts`)

- [ ] **PU1 — Planchette angle is finite:** For any generated `(cx, cy, tx, ty)` as finite
      numbers, `computeAngle(cx, cy, tx, ty)` returns a finite number; when `cx === tx` and
      `cy === ty` the result is `−90` (straight up, no rotation from identity).
- [ ] **PU2 — Candle period ≥ 333 ms:** For any generated `score` in [0, 1],
      `333 + (1 − score) * (4000 − 333) ≥ 333`.
- [ ] **PU3 — Fog opacity in [0, 0.85]:** For any generated integer `score` in [0, 100],
      `score / 100 * 0.85 ∈ [0, 0.85]`.
- [ ] **PU4 — Severity label always defined:** For any generated integer in [0, 100],
      `getSeverityLabel(score)` is one of `["Restless", "Troubled", "Haunted", "Possessed"]`.
- [ ] **PU5 — Counter arithmetic consistent:** For any generated `VerifiedAnswerPayload`
      (arbitrary verified/rejected array lengths ≥ 0), the `N` and `M` values derived from the
      payload are non-negative and `N ≤ M`.
- [ ] Configure fast-check with 1 000 runs; use `FAST_CHECK_SEED` env if set.

Satisfies: design §7.3; evidence-rules PBT strategy.

---

## T14 — Accessibility lint hook (`.kiro/hooks/a11y-lint.json`)

- [ ] Create `scripts/a11y-lint.sh` that checks `public/index.html` for: - All `<input>` elements have a corresponding `<label>`. - No `tabindex` value > 0. - Presence of `aria-live` on `#verified-counter`. - Presence of `aria-hidden="true"` on `#fog-layer`, `#candle-section`, `#planchette`. - Presence of `aria-live="polite"` on `#chat-history`.
      Exits `0` on pass, prints a summary; exits `1` with error lines on fail.
- [ ] Register the hook in `.kiro/hooks/a11y-lint.json` using the `createHook` tool: trigger
      `PostFileSave`, matcher `public/.*`, action type `command`, command `bash scripts/a11y-lint.sh`.

Satisfies: R8.1–R8.8; design §7.2.

---

## T15 — Typecheck, lint, and test suite confirmation

- [ ] Run `npm run typecheck`; fix any TypeScript errors introduced by UI test files.
- [ ] Run `npm run lint`; fix any ESLint or Prettier issues in `public/` and `test/ui/`.
- [ ] Run `npm test`; confirm all unit and PBT tests in `test/ui/` pass.
- [ ] Confirm total uncompressed size of `public/` (HTML + CSS + JS) is ≤ 150 KB.
- [ ] Confirm `window.ENV` is set to `"production"` in `index.html` for the production build
      and `"development"` in the development variant (or driven by a `<meta>` tag injected by the
      server based on `NODE_ENV`).
- [ ] Confirm all `aria-hidden`, `aria-live`, and `role="alert"` attributes are present in
      `index.html` as required by R8.
- [ ] Update `README.md` with the manual accessibility checklist from design §7.4.

Satisfies: R9.2–R9.4, R8.1–R8.8; overall code-quality requirements from tech steering.
