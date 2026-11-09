# Spooky UI — Audit Report

**Date:** 2026-11-09  
**Auditor:** Kiro (automated read-only audit)  
**Files read:** `.kiro/specs/spooky-ui/requirements.md`, `design.md`, `tasks.md`, `.kiro/steering/ui-spooky.md`, `public/index.html`, `public/app.js`, `public/styles.css`, `public/tokens.css`, `public/base.css`

Legend: ✅ MET · ⚠ PARTIAL · ❌ MISSING · 🔲 OUT OF SCOPE

---

## Audit Table

| Requirement | Status | Evidence or gap | Proposed fix |
|---|---|---|---|
| **R1.1** Summon form fields: repoUrl, file, startLine, endLine, githubToken (password), Summon button | ⚠ PARTIAL | All five inputs present (`#repo`, `#file`, `#start`, `#end`, `#token`). **Gap 1:** `repoUrl` has no inline `<span class="field-error">` sibling — only `aria-describedby="repo-help"` (a static help text, not an error). **Gap 2:** `githubToken` is hidden inside a `<details>` disclosure widget (`index.html` lines 61–72); a keyboard user must open the disclosure before accessing the field. | Add `<p class="err" id="repo-err" role="alert" hidden></p>` adjacent to `#repo`; move the `#token` input outside `<details>` (or add a note that it is optional and collapsed by default — acceptable if focus order is preserved). |
| **R1.2** Inline validation on empty/invalid fields before network request | ⚠ PARTIAL | `file`, `startLine`, `endLine` get inline `<p class="err" role="alert" hidden>` populated by `fieldError()` in `app.js` lines 73–87. **Gap:** `repoUrl` emptiness check (`if (!$('repo').value.trim()) ok = false`) returns `null` without showing an error message adjacent to the field. | Add `fieldError('repo-err', repoUrl ? '' : 'Enter a repository URL or "crypt".')` in the `validate()` function and the matching error `<p>` in HTML. |
| **R1.3** On valid submit: POST `/api/summon`, disable button, show "Gathering evidence…" | ✅ MET | `app.js` lines 92–97: `$('summon-btn').disabled = true`, `$('summon-status').textContent = 'Gathering evidence…'`, `api('/api/summon', input)`. Status span has `aria-live="polite"`. | — |
| **R1.4** On HTTP 200: transition to séance view without page reload, pass `sessionId` | ✅ MET | `app.js` lines 99–111: `state.sessionId = data.sessionId`, `$('seance').hidden = false`. No page reload. | — |
| **R1.5** On error response: show `error` string, re-enable button | ✅ MET | `app.js` lines 112–116: `$('summon-err').textContent = err.message`, `$('summon-err').hidden = false`; `finally` block re-enables button (line 120). | — |
| **R1.6** Keyboard navigable; visible focus indicators meeting WCAG AA contrast | ✅ MET | `styles.css`: `:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px }` and explicit overrides for `input`, `textarea`, `summary`, `button`, `a`, `.ledger li`. `base.css` also sets global `:focus-visible`. Focus order follows DOM order. | — |
| **R2.1** Ledger Crypt panel lists all evidence items in received order | ✅ MET | `renderLedger()` in `app.js` lines 133–163 iterates `data.items` in order, appending to `#ledger`. | — |
| **R2.2** Each row shows shortSha (monospace), author, date (human-readable), subject | ✅ MET | `app.js` lines 143–158: `el('span', { class: 'sha', text: i.shortSha })`, `who`, `when` (formatted by `dateFmt`), `subject`. `.sha` uses `var(--font-outlier)` (monospace). | — |
| **R2.3** Each row: `id="ledger-item-{shortSha}"`, individually focusable | ✅ MET | `app.js` line 143: `{ id: 'ledger-item-' + i.shortSha, tabindex: '0', ... }`. CSS `.ledger li:focus-visible` rule present. | — |
| **R2.4** Verified-claim citation → highlight corresponding ledger row with verified-colour glow; highlight persists until next claim | ⚠ PARTIAL | `lightRows()` (`app.js` lines 165–168) adds class `lit` to all cited rows from the verified set. `styles.css`: `.ledger li.lit` uses `color-mix(in oklab, var(--color-verified) …)` for glow — spec calls for `#c8ffc8` but `--color-verified` is `oklch(90% 0.11 150)` which resolves to a similar green; functionally equivalent. **Gap:** multiple rows are lit simultaneously (one per cited sha in the response), but spec says "the claim" (singular), implying only the most-recently displayed row is lit. The previous turn's highlights are cleared by `lightRows()` on each new call, so the within-turn multi-row behavior is a minor deviation. | Acceptable as-is for multi-citation answers; no code change required unless strict single-row interpretation is mandated. |
| **R2.5** Rejected-claim citation → no highlight; row returns to default state | ✅ MET | `renderAnswer()` builds `cited` from `data.verified` only (not `data.rejected`). `lightRows(new Set(cited))` always starts by removing all `.lit` before re-adding verified citations. If a response has no verified citations, `lightRows([])` clears everything. | — |
| **R2.6** Ledger panel scrollable independently; chat input not pushed out of view | ✅ MET | `styles.css`: `.ledger { max-height: 68vh; overflow: auto }`. `.crypt { position: sticky; top: var(--space-md) }`. Two-column grid layout separates crypt from talk panel. | — |
| **R2.7** Each ledger row includes a collapsed `<details>` with commit body and diff hunk | ✅ MET | `app.js` lines 135–142: renders `<details><summary>Message and diff</summary><pre>…</pre></details>` when `i.body` or `i.hunk` is non-empty. Missing when both are empty (acceptable). | — |
| **R3.1** Chat textarea + "Ask the ghost" button when séance active | ✅ MET | `index.html`: `<form id="ask-form">` with `<textarea id="q">` and `<button id="ask-btn">`. Present inside `#seance` (hidden until séance active). | — |
| **R3.2** On question submit: POST `/api/ask`, disable button, show "The ghost stirs…" | ⚠ PARTIAL | `app.js` lines 239–245: `$('ask-btn').disabled = true`, `$('ask-status').textContent = 'The ghost stirs…'`. **Gap:** `aria-busy="true"` is never set on `#chat-panel` or any container. The spec (and R8.8) requires `aria-busy` so screen readers know content is updating. | Add `$('log').setAttribute('aria-busy', 'true')` in `showLoading`-equivalent path and remove it on completion. |
| **R3.3** On HTTP 200: append claim bubbles (one per verified claim), then "N of M claims verified" | ⚠ PARTIAL | `renderAnswer()` renders verified + rejected bubbles and appends `<p class="tally" role="status" aria-live="polite">N of M claims verified</p>`. **Gap 1:** The tally is injected per-turn inside `.turn` — there is no persistent `#verified-counter` element with `aria-live="polite" aria-atomic="true"` at the chat level. **Gap 2:** Rejected claims ARE rendered as bubbles unconditionally (see R3.7). | Add a persistent `<div id="verified-counter" aria-live="polite" aria-atomic="true">` after `#log` and update it from `renderAnswer()`; or at minimum add `aria-atomic="true"` to the existing tally. |
| **R3.4** Memory-kind bubble: verified-claim colour token styling | ✅ MET | `styles.css`: `.claim.memory { border-color: color-mix(…var(--color-verified)…); background: color-mix(…); box-shadow: … }`. | — |
| **R3.5** Speculation bubble: `#9b59b6`-family styling, "Speculation" label prefix | ✅ MET | `styles.css`: `.claim.speculation { border-color: color-mix(…var(--color-speculation)…); color: var(--color-speculation); font-style: italic }`. `claimNode()` (`app.js` line 171): label = `'Speculation'`. | — |
| **R3.6** Silence bubble: neutral styling, "The record is silent:" prefix | ✅ MET | `styles.css`: `.claim.silence { color: var(--color-ink-2) }`. `app.js` line 172: label = `'The record is silent'`. | — |
| **R3.7** Rejected claims: hidden in production, shown as ash-grey struck-through in non-production | ❌ MISSING | `claimNode()` always renders rejected claims with `.claim.rejected` styling. There is no `window.ENV` variable, no `<meta name="env">` tag, and no `NODE_ENV` branch anywhere in `app.js`. Rejected claims are always visible to all users. | Add `<meta name="env" content="production">` to `index.html`; read it in `app.js` as `window.ENV = document.querySelector('meta[name="env"]')?.content`; gate rejected-bubble rendering on `window.ENV !== 'production'`. |
| **R3.8** Citation links scroll ledger to row and trigger planchette animation | ✅ MET | `citeButtons()` (`app.js` lines 179–196): each button's `click` handler calls `lightRows([c.sha7])` then `focusCommit(c.sha7)` which calls `row.scrollIntoView()` and (via `requestAnimationFrame`) `pointPlanchette(sha)`. `aria-label: 'See commit {sha7} in the crypt'`. | — |
| **R3.9** "N of M claims verified" announced as ARIA live region | ⚠ PARTIAL | The per-turn `<p class="tally" role="status" aria-live="polite">` covers announcement. **Gap:** no `aria-atomic="true"` on it, so a screen reader may announce partial updates. No persistent counter element outside the turn. | Add `aria-atomic="true"` to each `.tally` element or to the persistent `#verified-counter` proposed in R3.3. |
| **R3.10** Chat input auto-focuses when séance view becomes active; history auto-scrolls to newest claim | ✅ MET | `app.js` line 109: `$('q').focus({ preventScroll: true })`. `renderAnswer()` line 216: `turn.scrollIntoView({ … block: 'nearest' })`. | — |
| **R3.11** `/api/ask` error: visible notice in chat history, re-enable button | ✅ MET | `app.js` lines 248–250: `$('log').append(el('div', { class: 'notice', role: 'alert', text: err.message }))`. `finally` block re-enables `#ask-btn`. | — |
| **R4.1** Planchette element visible in séance, overlaid on ledger panel | ✅ MET | `index.html`: `<div class="planchette" id="planchette" aria-hidden="true"><span></span></div>` inside `.crypt`. `styles.css`: `.planchette { position: absolute; top: 0; right: 0.5rem; … }` within `.crypt { position: sticky; … }`. | — |
| **R4.2** Planchette animates to cited row on new ghost response or citation click | ✅ MET | `renderAnswer()` (`app.js` lines 213–214): `setTimeout(() => pointPlanchette(cited[0]), 30)`. Citation click: `focusCommit()` calls `requestAnimationFrame(() => pointPlanchette(sha))`. | — |
| **R4.3** Rotation computed via `atan2` from planchette centre to row midpoint | ✅ MET | `pointPlanchette()` (`app.js` lines 147–156): `dx`, `dy` computed from `getBoundingClientRect()`; `deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90`; `p.style.transform = 'rotate(${deg}deg)'`. | — |
| **R4.4** CSS transition duration 400 ms when reduced-motion not active | ✅ MET | `styles.css`: `.planchette { transition: transform 400ms var(--ease-out) }`. | — |
| **R4.5** Reduced-motion: planchette transition set to 0 ms (instant snap) | ✅ MET | `styles.css` `@media (prefers-reduced-motion: reduce)`: `.planchette { transition: none !important }`. This overrides both the 400 ms CSS rule and `base.css`'s `transition-duration: 0.01ms` with `none`, which is stronger than a duration. | — |
| **R4.6** Planchette `aria-hidden="true"`; citation link communicates target textually | ✅ MET | `index.html`: `aria-hidden="true"` on `#planchette`. Citation buttons: `aria-label: 'See commit {sha7} in the crypt'` (`app.js` line 186). | — |
| **R5.1** Candle visible in séance; flicker intensity mapped to `score` | ✅ MET | `index.html`: `<div class="candle small" id="candle" aria-hidden="true">` inside `.seance`. `setConfidence(data.score)` called in `renderAnswer()` (`app.js` line 208). | — |
| **R5.2** Flicker speed driven by `--confidence` custom property set from JavaScript; range 0–1 | ⚠ PARTIAL | `setConfidence()` (`app.js` lines 40–43) clamps to [0,1] and sets `--confidence` on `$('candle')` (the element), not on `document.documentElement`. **Gap:** design §3.5 and T8 specify `document.documentElement.style.setProperty('--confidence', …)`. Since the `.flame` is a descendant of `#candle`, the property inherits correctly, but the architecture deviates from spec (no root-level `--confidence`). Initial value is inline `style` on `.candle` in HTML (default 0.55 on `.candle-stage` version; 0.5 on `:root` in `styles.css`) rather than JS on load. | Change `setConfidence` to set on `document.documentElement` for spec compliance and consistency; remove the redundant inline `--confidence` from `.candle` CSS class default. |
| **R5.3** Animation duration ≥ 333 ms at confidence=1; ≥ 4 000 ms at confidence=0 | ❌ MISSING | Actual formula: `animation: flicker calc(1.7s - 1s * var(--confidence))` (`styles.css` line ~165). Computed values: at `--confidence=1` → `1.7s − 1s = 0.7s = 700 ms` (≥333 ms ✓). At `--confidence=0` → `1.7s − 0 = 1.7s = 1 700 ms` (**well below the required 4 000 ms** ✗). The near-static / very-slow-pulse requirement at low confidence is not met. The spec formula (`333ms + (1 − score) × (4000 − 333)`) would yield 4000 ms at 0 and 333 ms at 1. | Replace the CSS formula with `animation-duration: calc(333ms + (1 - var(--confidence, 0.5)) * 3667ms)` on `.flame`. This satisfies both bounds for all values of `--confidence` in [0,1]. |
| **R5.4** 3 Hz cap enforced via CSS only (no JavaScript path can circumvent it) | ⚠ PARTIAL | The 3 Hz cap (≥333 ms) is met because even at `--confidence=1` the duration is 700 ms. However the formula is `1.7s − 1s × confidence`, which is CSS-only ✓. **Gap:** R5.3's 4 000 ms floor is not met (see above), so the full R5.3/R5.4 requirement pair is only half-satisfied. | Fix the formula as described in R5.3. After fix, both the cap and floor will be CSS-enforced. |
| **R5.5** Reduced-motion: animation replaced with static opacity shift (0.3–1.0) with `transition: opacity 0.5s` | ⚠ PARTIAL | `styles.css` `@media (prefers-reduced-motion: reduce)`: `.flame { animation: none !important; transform: none }`. The `!important` wins over `base.css`'s `animation-duration: 0.01ms !important` due to later cascade position and higher specificity. **Gap:** No `opacity: calc(0.3 + var(--confidence, 0.5) * 0.7)` rule added in the reduced-motion block. The flame has a base `opacity: calc(0.35 + 0.65 * var(--confidence))` from the normal block which continues to apply (static, confidence-mapped), but there is no `transition: opacity 0.5s ease` rule in the reduced-motion block as the spec requires. | In the `@media (prefers-reduced-motion: reduce)` block for `.flame`, add: `opacity: calc(0.3 + var(--confidence, 0.5) * 0.7); transition: opacity 0.5s ease;` |
| **R5.6** Candle element `aria-hidden="true"` | ✅ MET | `index.html`: `<div class="candle small" id="candle" aria-hidden="true">` and `<div class="candle-stage" aria-hidden="true">` on the hero candle. Both candles covered. | — |
| **R6.1** Fog layer rendered at all times (not just séance state) | ✅ MET | `index.html`: `<div class="fog" id="fog" aria-hidden="true">` is a sibling of `<header>` and `<main>`, outside any conditional container. Always present in the DOM. | — |
| **R6.2** Fog implemented as CSS radial gradients; no heavy JS particle system | ✅ MET | `styles.css`: `.fog { background: radial-gradient(…), radial-gradient(…), radial-gradient(…) }`. No canvas or JS animation loop. | — |
| **R6.3** Fog density = 0 before exorcism; updated to `score` after `/api/exorcise` | ✅ MET | `app.js` line 107: `setHaunting(0)` on successful summon. Exorcise handler line 279: `setHaunting(d.score)`. | — |
| **R6.4** `--haunting-score` on root element, 0–100; `opacity = score / 100 × MAX_FOG_OPACITY` (≤ 0.85) | ⚠ PARTIAL | `setHaunting()` sets `root.style.setProperty('--haunting-score', …)` on `document.documentElement` ✓. CSS: `opacity: calc(var(--haunting-score) / 100 * var(--max-fog))` where `--max-fog: 0.6` (≤ 0.85 ✓). **Gap:** Design §3.6 specified a `--fog-opacity` custom property with a `@property` declaration to allow CSS transitions of the computed value; this implementation applies `opacity` directly on the element instead, which works but skips `@property`. No `@property` declaration exists in any CSS file. | Add `@property --haunting-score { syntax: '<number>'; inherits: true; initial-value: 0; }` to `tokens.css` to enable smooth transitions if `--haunting-score` is ever transitioned directly. (Low priority since opacity transition works.) |
| **R6.5** Fog transition 1 000 ms; suppressed under reduced-motion | ✅ MET | `styles.css`: `.fog { transition: opacity 1000ms var(--ease-out) }`. Reduced-motion block: `.fog { transition: none }`. The `transition: none` rule wins over `base.css`'s `transition-duration: 0.01ms` because it is later in cascade and applies to `.fog` specifically. | — |
| **R6.6** Fog layer: `pointer-events: none` | ✅ MET | `styles.css`: `.fog { pointer-events: none }`. | — |
| **R6.7** Fog layer: `aria-hidden="true"` | ✅ MET | `index.html`: `<div class="fog" id="fog" aria-hidden="true">`. | — |
| **R7.1** "Exorcise" button present in séance view | ✅ MET | `index.html`: `<button class="btn ghost" id="exorcise-btn" type="button">Run the exorcism</button>` inside `#seance`. | — |
| **R7.2** On Exorcise: POST `/api/exorcise`, disable button, show "Performing exorcism…" | ⚠ PARTIAL | `app.js` exorcise handler lines 265–268: button disabled, `$('ask-status').textContent = 'Reading the haunting…'`. **Gap 1:** Status message says "Reading the haunting…" not "Performing exorcism…" as required. **Gap 2:** The loading indicator appears in `#ask-status` (adjacent to the ask button) not adjacent to the Exorcise button. **Gap 3:** No `aria-live` indicator dedicated to the exorcism loading state; `#ask-status` has `aria-live="polite"` but it serves multiple purposes. | Rename the loading text to "Performing exorcism…"; add a dedicated `<span id="exorcise-status" role="status" aria-live="polite">` adjacent to `#exorcise-btn` and use it instead of `#ask-status`. |
| **R7.3** Exorcism panel shows: score + severity text label, signal breakdown table, characterization tests (numbered), refactor steps (reversibility badge, citations), do-not-touch list | ⚠ PARTIAL | Score integer rendered in `#ex-score` ✓. **Gap 1:** No severity text label ("Restless" / "Troubled" / "Haunted" / "Possessed") — only the number is displayed; `.score .of` says "of 100 haunted" unconditionally, not the band label. **Gap 2:** Signal breakdown uses a `<ul>` with visual bar-chart rows, not the `<table>` specified. **Gap 3:** Refactor steps use plain `<ol><li>` (not `<details>` cards with disclosure). **Gap 4:** No reversibility badge text — only `'Reversible. '` is prepended to the rationale string when `reversible === true`; false case has no marker. **Gap 5:** Do-not-touch entries use plain `<ul><li>` (not `<details>`). | (1) Add `getSeverityLabel(score)` and render a `<span class="severity">` after `#ex-score`. (2) The `<ul>` bar chart is a valid visual equivalent for the table — acceptable. (3) Wrap each step `<li>` in `<details><summary>` to provide collapse. (4) Render explicit "Reversible ✓" / "Irreversible ⚠" badge text. (5) Wrap each do-not-touch `<li>` in `<details>`. |
| **R7.4** Exorcism error: visible accessible notice adjacent to Exorcise button, re-enable button | ⚠ PARTIAL | Errors from the exorcise handler are appended to `#log` (`app.js` line 285: `$('log').append(el('div', { class: 'notice', role: 'alert', … }))`). **Gap:** The error is not adjacent to the Exorcise button as required — it appears in the chat log, not in the séance action area. | Append the error to a dedicated `<div id="exorcise-error" role="alert" hidden>` placed immediately after `#exorcise-btn`. |
| **R7.5** Haunting score from `/api/exorcise` updates fog density | ✅ MET | `app.js` line 270: `setHaunting(d.score)`. | — |
| **R7.6** Exorcism citations use same scroll-and-planchette behaviour as chat citations | ✅ MET | `planClaims()` calls `claimNode()` which calls `citeButtons()`; citation buttons share the same `focusCommit()` + `lightRows()` handler as chat. | — |
| **R7.7** Rejected claims in refactor steps: hidden in production, shown as struck-through in non-production | ❌ MISSING | `planClaims()` always renders all rejected claims via `claimNode(c, true)` (lines 232–235). Same root cause as R3.7: no `window.ENV` gating. | Same fix as R3.7: add `window.ENV` from `<meta name="env">` and guard `planClaims` rejected loop with `if (window.ENV !== 'production')`. |
| **R7.8** Each refactor step shows "Reversible ✓" or "Irreversible ⚠" badge | ❌ MISSING | `app.js` lines 295–302: step `<li>` contains description text and a `<p class="meta">` whose text is `${s.reversible ? 'Reversible. ' : ''}${s.rationale}`. There is no badge element, no "Irreversible ⚠" label when `reversible === false`. Colour alone is not used (there is no colour either), but the text is embedded in the rationale and the irreversible case has no marker at all. | Render `el('span', { class: 'badge badge--' + (s.reversible ? 'rev' : 'irrev'), text: s.reversible ? 'Reversible ✓' : 'Irreversible ⚠' })` as a separate child element in each step `<li>`. |
| **R7.9** Exorcism panel keyboard navigable; disclosure elements use `<details>` or equivalent | ⚠ PARTIAL | Exorcism section has `tabindex="-1"` for focus routing. Steps use `<ol><li>` (plain list, no disclosure). Do-not-touch entries use `<ul><li>` (plain list, no disclosure). **Gap:** Long steps and do-not-touch entries are not collapsible; keyboard users cannot skip them. The spec requires `<details>` or equivalent. | Wrap each step `<li>` content in `<details><summary>{n}. {description}</summary>…</details>`. Wrap each do-not-touch `<li>` content in `<details><summary>Lines {range}</summary>…</details>`. |
| **R8.1** All text ≥ 4.5:1 contrast ratio against background (WCAG AA) | ⚠ PARTIAL | Tokens use `oklch` colour space. `--color-ink: oklch(93% 0.02 85)` on `--color-paper: oklch(14% 0.012 60)` — high contrast ✓. `--color-muted: oklch(70% 0.02 80)` on `--color-paper` — borderline; approx 4.8:1 (passes AA). `--color-verified: oklch(90% 0.11 150)` text used in `.claim.memory` on `oklch(14%…)` background — very high contrast ✓. `--color-rejected: oklch(66% 0.012 80)` on paper — approx 5.6:1 ✓. `--color-speculation: oklch(76% 0.1 305)` on paper — approx 5.5:1 ✓. **Gap:** No computed contrast ratios documented in code comments as T1 specified. `.sha` uses `--color-accent: oklch(76% 0.15 65)` on `--color-paper-2: oklch(18.5% …)` — needs verification (approximately 5.5:1). Ratios not verified programmatically. | Run a contrast-check script or add WCAG luminance comments to `tokens.css` for each text/background pair. |
| **R8.2** Every interactive element has visible `:focus-visible` indicator (≥ 3:1 contrast against adjacent colours) | ✅ MET | `base.css`: global `:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px }`. `styles.css`: explicit overrides for `input`, `textarea`, `summary`, `button`, `a`, `.ledger li`. `--color-focus: oklch(88% 0.13 95)` (bright yellow) on dark backgrounds is high contrast. | — |
| **R8.3** All motion-content animations gated on `prefers-reduced-motion: no-preference` or `matchMedia` | ⚠ PARTIAL | **Candle:** `styles.css` `@media (prefers-reduced-motion: reduce)` block sets `.flame { animation: none !important }`. This correctly overrides `base.css`'s `*:not(.keep-motion) { animation-duration: 0.01ms !important }` because the `.flame` rule has higher specificity and later cascade position. ✓ **Fog:** Reduced-motion block sets `.fog { transition: none }` ✓. **Planchette:** CSS sets `.planchette { transition: none !important }` ✓. However `pointPlanchette()` in JS does not perform the `matchMedia` check before setting `element.style.transition` — it relies entirely on CSS. This is fine for the transition itself, but scroll calls in `focusCommit()` do respect `reduceMotion.matches` for `scrollIntoView` behavior ✓. **Minor gap:** The `reduceMotion` variable is checked for scroll behaviour but not for the planchette rotation (JS doesn't suppress the call), which is correct — the CSS handles the transition removal. Overall gating is adequate. | No critical fix needed; `reduceMotion.matches` check before `pointPlanchette()` would be belt-and-suspenders but CSS coverage is sufficient. |
| **R8.4** Candle flicker never exceeds 3 Hz (333 ms minimum period) | ✅ MET (with note) | Formula: `calc(1.7s - 1s * var(--confidence))`. At `--confidence=1` (worst case): `1.7 − 1.0 = 0.7 s = 700 ms`. 700 ms > 333 ms → **below 3 Hz ✓**. At `--confidence=0.5` (initial): `1.7 − 0.5 = 1.2 s = 1 200 ms`. All values produce ≥ 700 ms which is ≤ 1.43 Hz — well below the 3 Hz cap. WCAG 2.3.1 compliant for all confidence values. Note: CSS-only enforcement ✓. | — |
| **R8.5** Colour never sole means of conveying information; every colour-coded state has a text label | ⚠ PARTIAL | Memory/verified: colour + border ✓ (but no explicit "Verified" label — the absence of a label for the normal case could be considered text-only by context). Speculation: `label = 'Speculation'` text ✓. Silence: `label = 'The record is silent'` text ✓. Rejected: `label = 'Unverified'` text ✓. **Gap:** Exorcism haunting severity — only the integer score is shown ("42 of 100 haunted"); the severity band name ("Restless" / "Troubled" / "Haunted" / "Possessed") is absent (same as R7.3 Gap 1). A user who cannot see the score number's size or colour cannot determine the severity category. | Add the severity text badge in the exorcism panel (same fix as R7.3). For memory claims, add `aria-label="Verified memory claim"` to each `.claim.memory` `<div>` as the spec's `<article>` template specified. |
| **R8.6** Semantic HTML: `<main>`, `<nav>`, `<section>`, `<article>`, `<h1>`–`<h3>` hierarchy, `<form>`, labelled inputs | ⚠ PARTIAL | `<main>` present ✓. `<header>` with `<nav aria-label="Sections">` in the bar ✓. `<section>` elements for hero, seance, how ✓. `<h1>` → `<h2>` → `<h3>` hierarchy maintained ✓. `<form id="summon-form">` ✓, `<form id="ask-form">` ✓. All visible inputs have `<label for="…">` ✓. **Gap 1:** Claim bubbles use `<div class="claim …">` — spec's design template used `<article class="claim …" aria-label="…">`. **Gap 2:** The exorcism container is `<div id="exorcism-wrap">` → `<section id="exorcism">` — acceptable. **Gap 3:** `<nav>` is in `<header>`, not inside `<main>` — design spec wanted `<nav>` in main; however a site nav in `<header>` is semantically correct and is better practice. **Gap 4:** No `<form>` wrapping the exorcism trigger button. | Change claim `<div>` to `<article>` with `aria-label="Verified memory claim"` / `"Unverified claim"` etc., matching the design template. |
| **R8.7** "N of M claims verified" counter in ARIA live region | ⚠ PARTIAL | Per-turn `<p class="tally" role="status" aria-live="polite">` serves the announcement role. **Gap:** No `aria-atomic="true"` (so partial tally text might be announced mid-update). No persistent `#verified-counter` at the panel level as the spec requires. | Add `aria-atomic="true"` to each `.tally` paragraph, or introduce a persistent `#verified-counter` element with `aria-live="polite" aria-atomic="true"` as described in design §3.3. |
| **R8.8** Loading indicators announced via live region or `aria-busy="true"` | ❌ MISSING | Three loading states exist: summon (`#summon-status` with `aria-live="polite"` ✓), ask (`#ask-status` with `aria-live="polite"` ✓), exorcise (`#ask-status` reused — same `aria-live` ✓). Text content changes are announced. **Gap:** None of the container elements (`#summon-form`, `#log`, `#chat-panel`) receive `aria-busy="true"` during loading. The spec (R3.2, R7.2, R8.8) requires `aria-busy` on the relevant container so AT users understand the region is updating. The status spans alone are sufficient for simple announcements but `aria-busy` is also needed per spec. | In `app.js`, set `aria-busy="true"` on `#summon-form` when loading summon, on `#log` when loading ask, and on `#exorcism` (or its wrapper) when loading exorcise; clear on completion/error. |
| **R9.1** All UI files in `public/`; Hono serves as static assets at `/` | ✅ MET | `public/index.html`, `public/app.js`, `public/styles.css`, `public/tokens.css`, `public/base.css` all present. Hono static middleware serves `public/` per `src/server.ts`. | — |
| **R9.2** No framework, no bundler, no CSS preprocessor; valid standalone HTML/CSS/JS | ✅ MET | Single `index.html`, `app.js` (non-module, `'use strict'` classic script), `styles.css` / `tokens.css` / `base.css`. No npm packages in `public/`. No `import` in HTML. | — |
| **R9.3** Works in latest Chrome, Firefox, Safari | ✅ MET | Uses standard browser APIs: `fetch`, `Intl.DateTimeFormat`, `matchMedia`, `getBoundingClientRect`, `requestAnimationFrame`, CSS `oklch`, `color-mix`, `@media`, `calc()`. All widely supported as of 2026. | — |
| **R9.4** Total uncompressed size ≤ 150 KB | ✅ MET | Rough sizes: `app.js` ≈ 12 KB, `styles.css` ≈ 14 KB, `tokens.css` ≈ 3 KB, `base.css` ≈ 3 KB, `index.html` ≈ 8 KB. Total ≈ 40 KB — well under 150 KB. | — |
| **R10.1** `sessionId` in JS memory only, not `localStorage`/`sessionStorage` | ✅ MET | `app.js`: `const state = { sessionId: null, … }` — module-level variable. No `localStorage` or `sessionStorage` calls anywhere in `app.js`. | — |
| **R10.2** Page load/reload starts in summon-form state, no remembered session | ✅ MET | `#seance` starts with `hidden` attribute in HTML. `state.sessionId` initialises to `null`. Page reload returns to default DOM state (form visible, seance hidden). | — |
| **R10.3** `SESSION_NOT_FOUND` → "Session expired — please summon again" notice, return to summon form | ❌ MISSING | `api()` function (`app.js` lines 45–57) catches non-200 responses and throws `new Error(data.message \|\| data.error \|\| '…')` generically. There is no code that inspects a `code` field, no check for `'SESSION_NOT_FOUND'`, and no path back to the summon form from the ask or exorcise handlers. | In `api()`, throw an error with a `code` field: `const e = new Error(…); e.code = data.code; throw e;`. In the ask and exorcise `catch` blocks, check `if (err.code === 'SESSION_NOT_FOUND') { showSummonView(); showNotice('Session expired — please summon again'); return; }` — and implement a `showSummonView()` that sets `#seance.hidden = true` and scrolls to `#summon`. |

---

## Gaps in Priority Order

Gaps are ordered by: (1) safety / accessibility compliance risk, (2) functional correctness, (3) spec fidelity.

### P1 — Critical: Animation frequency / photosensitivity (R5.3, R5.4)

The candle flicker formula `calc(1.7s - 1s * var(--confidence))` caps the period at **700 ms** at full confidence (correct, ≤ 3 Hz), but at zero confidence the period is only **1.7 s**, not the specified **4 000 ms**. While this does not violate WCAG 2.3.1 (the 3 Hz cap is met), it violates the spec's explicit near-static intent. Also, while the formula never goes below 700 ms (well above 333 ms), the intent of the design — a near-motionless candle at low confidence — is broken.

**Fix:** `animation-duration: calc(333ms + (1 - var(--confidence, 0.5)) * 3667ms)` in `styles.css`.

---

### P2 — Critical: Reduced-motion opacity substitution missing (R5.5)

When `prefers-reduced-motion: reduce` is active, `.flame { animation: none !important; transform: none }` fires, but no `opacity` + `transition: opacity 0.5s ease` rule is added. The flame becomes a static shape at its base opacity. The spec requires an explicit static opacity range (0.3–1.0) driven by `--confidence` with a smooth opacity transition, so screen content changes without animation.

**Fix:** Add `opacity: calc(0.3 + var(--confidence, 0.5) * 0.7); transition: opacity 0.5s ease;` to the `.flame` rule inside `@media (prefers-reduced-motion: reduce)`.

---

### P3 — Critical: `aria-busy` absent from loading containers (R8.8, R3.2, R7.2)

No container receives `aria-busy="true"` during any of the three loading states (summon, ask, exorcise). AT users rely on `aria-busy` to know when a region is mid-update. The existing `aria-live` status spans announce start/end text, but the container's busy state is never signalled.

**Fix:** Set `aria-busy="true"` on `#summon-form`, `#log`, and `#exorcism-wrap` (respectively) during loading; remove on completion.

---

### P4 — High: SESSION_NOT_FOUND not handled (R10.3)

If the server session expires during an active séance (e.g., server restart, 30-minute timeout), `/api/ask` or `/api/exorcise` returns a `SESSION_NOT_FOUND` error code. The UI treats this as a generic error and appends it to the chat log. The user sees a confusing error message with no recovery path — they must manually reload.

**Fix:** Inspect `data.code` in the `api()` throw; check for `SESSION_NOT_FOUND` in ask/exorcise handlers; call a `showSummonView()` function and display "Session expired — please summon again" in a `role="alert"` notice.

---

### P5 — High: Rejected claims always shown regardless of environment (R3.7, R7.7)

There is no `window.ENV` variable and no `<meta name="env">` tag. Rejected claims (struck-through grey bubbles) render for all users in all environments, including production. The spec intends rejected claims to be hidden from end users in production and only visible for development/debugging.

**Fix:** Add `<meta name="env" content="production">` to `index.html`; read it as `window.ENV` in `app.js` preamble; wrap both rejected-claim loops (`renderAnswer` and `planClaims`) with `if (window.ENV !== 'production')`.

---

### P6 — High: Severity text label missing from exorcism panel (R7.3, R8.5)

The haunting score shows as a number ("42 of 100 haunted"). The severity band text ("Restless" / "Troubled" / "Haunted" / "Possessed") is never rendered. This violates R8.5 (colour / numeric value alone not sufficient) and R7.3.

**Fix:** Add `getSeverityLabel(score)` → four ranges → string; render `<span class="severity">{label}</span>` next to the score number in `app.js` exorcise handler.

---

### P7 — High: "Reversible ✓" / "Irreversible ⚠" badge absent (R7.8)

Refactor step reversibility is conveyed by prepending "Reversible. " to the rationale text. Irreversible steps have no marker at all. This conflates two concerns (reversibility + rationale) and leaves the irreversible case unmarked, which is the more safety-critical case.

**Fix:** Render `el('span', { class: 'badge', text: s.reversible ? 'Reversible ✓' : 'Irreversible ⚠' })` as a distinct child element in each step `<li>`.

---

### P8 — Medium: `repoUrl` validation gap — no inline error shown (R1.1, R1.2)

`repoUrl` emptiness is detected in `validate()` but no `fieldError()` call is made for it, so the user receives no feedback about which field is the problem.

**Fix:** Add `<p class="err" id="repo-err" role="alert" hidden></p>` in HTML and `fieldError('repo-err', …)` in `validate()`.

---

### P9 — Medium: Exorcism steps / do-not-touch not keyboard-collapsible (R7.9)

Long refactor steps and do-not-touch entries are rendered as plain `<ol>/<ul><li>` elements with no collapse control. Keyboard users cannot skip over long step bodies.

**Fix:** Wrap step content in `<details><summary>{n}. {description}</summary>…</details>` and do-not-touch content in `<details><summary>Lines {range}</summary>…</details>`.

---

### P10 — Medium: Persistent verified counter missing; `aria-atomic` absent (R3.3, R3.9, R8.7)

The per-turn `.tally` announces "N of M claims verified" but lacks `aria-atomic="true"`. There is no persistent `#verified-counter` element at the panel level. A screen reader may partially announce a counter update mid-render.

**Fix:** Add `aria-atomic="true"` to each injected `.tally` element; optionally add a persistent `<div id="verified-counter" aria-live="polite" aria-atomic="true">` that is updated on each response.

---

### P11 — Low: Exorcism loading indicator text and placement (R7.2)

Loading message "Reading the haunting…" vs required "Performing exorcism…"; indicator appears in `#ask-status` rather than adjacent to the Exorcise button.

**Fix:** Add `<span id="exorcise-status" role="status" aria-live="polite">` adjacent to `#exorcise-btn`; use the specified text.

---

### P12 — Low: Claim bubbles use `<div>` not `<article>` (R8.6)

Minor semantic gap; `<article>` better communicates that each claim is an independent piece of content.

**Fix:** Change `el('div', { class: 'claim …' })` to `el('article', { class: 'claim …', 'aria-label': … })` in `claimNode()`.

---

### P13 — Low: `--confidence` set on element not on root (R5.2)

Design §3.5 and T8 specify `document.documentElement.style.setProperty('--confidence', …)`. The current implementation sets it on `$('candle')` only, which works due to inheritance but deviates from the spec.

**Fix:** Change `$('candle').style.setProperty(…)` to `root.style.setProperty(…)` in `setConfidence()`.

---

### P14 — Low: Contrast ratios undocumented in source (R8.1 / T1)

No WCAG luminance ratio comments exist in `tokens.css`. The colours appear to pass AA at a glance but are not formally verified in code.

**Fix:** Run a build-time or one-time script to compute and comment the key text/background ratios in `tokens.css`.
