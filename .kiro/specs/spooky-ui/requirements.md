# Spooky UI — Requirements

Spec ID: `spooky-ui`
Depends on: `evidence-ledger` (`/api/summon`), `ghost-verifier` (`/api/ask`), `exorcism-plan` (`/api/exorcise`)

All UI lives in `public/` as vanilla HTML, CSS, and JavaScript — no framework, no build step.
Design tokens, animation rules, and the accessibility floor are defined in `.kiro/steering/ui-spooky.md`.

---

## Functional requirements

### R1 — Summon form

**R1.1** When a user visits the root URL, the system shall display a summon form containing:

- a text input for a repository URL or local path (`repoUrl`),
- a text input for the file path within the repository (`file`),
- a numeric input for the start line (`startLine`, integer ≥ 1),
- a numeric input for the end line (`endLine`, integer ≥ startLine),
- an optional password-masked text input for a GitHub token (`githubToken`),
- and a "Summon" submit button.

**R1.2** When the user submits the summon form with any required field empty or with `endLine < startLine`, the system shall display an inline validation message adjacent to the offending field before making any network request.

**R1.3** When the user submits a valid summon form, the system shall POST to `/api/summon`, disable the submit button, and display a loading indicator labeled "Gathering evidence…" until the response is received.

**R1.4** When `/api/summon` returns HTTP 200, the system shall transition the page to the séance view (ledger crypt panel + chat panel) without a full page reload, passing the returned `sessionId` to subsequent requests.

**R1.5** When `/api/summon` returns an error response, the system shall display the `error` string from the response body as a visible, accessible error notice on the form, and re-enable the submit button.

**R1.6** The summon form shall be navigable and operable using only a keyboard; every input and the submit button shall receive visible focus indicators that meet WCAG 2.1 AA contrast requirements.

---

### R2 — Ledger crypt panel

**R2.1** When a séance is active, the system shall display a "Ledger Crypt" panel listing all evidence items returned from the most recent `/api/summon` response, in the order they are received.

**R2.2** Each ledger item row shall display at minimum: `shortSha` (7 characters, in monospace), author name, ISO date (rendered as a human-readable date string), and the commit subject.

**R2.3** Each ledger item row shall be individually focusable and shall carry an `id` attribute of the form `ledger-item-{shortSha}` to enable deep-linking and planchette targeting.

**R2.4** When the ghost cites a ledger item in a verified claim, the system shall highlight the corresponding ledger row with the verified-claim colour token (`#c8ffc8` glow) for as long as the claim is the most-recently displayed claim in the chat.

**R2.5** When the ghost cites a ledger item in a rejected claim, the system shall apply no highlight; the row returns to its default state.

**R2.6** The ledger crypt panel shall be scrollable independently of the chat panel; long ledgers shall not push the chat input out of view.

**R2.7** Each ledger item row shall include a visually collapsed `<details>` element containing the full commit body and diff hunk, expandable by keyboard or click.

---

### R3 — Séance chat

**R3.1** When a séance is active, the system shall display a chat interface with a text area for the user's question and a "Ask the ghost" submit button.

**R3.2** When the user submits a question, the system shall POST to `/api/ask` with `{ sessionId, question }`, disable the submit button, and display a loading indicator labeled "The ghost stirs…".

**R3.3** When `/api/ask` returns HTTP 200, the system shall append the ghost's response to the chat history as a sequence of rendered claim bubbles (one bubble per claim in the `verified` array), followed by a summary line reading "N of M claims verified" where N = `verified.length` and M = `verified.length + rejected.length`.

**R3.4** A memory-kind claim bubble shall be styled with the verified-claim token (`#c8ffc8` glow, pale green text on dark background).

**R3.5** A speculation-kind claim bubble shall be styled with the speculation token (`#9b59b6`, muted purple, italic text) and shall display the label "Speculation" before the claim text.

**R3.6** A silence-kind claim bubble shall be styled neutrally and shall display the label "The record is silent:" before the `silenceReason` text.

**R3.7** Rejected claims shall not be rendered as bubbles in the default (production) view; they shall instead be counted in the "N of M claims verified" line. In a non-production environment they shall be rendered as ash-grey (`#6b6b6b`) struck-through bubbles preceded by the label "Unverified:".

**R3.8** Each claim bubble shall display its citations as a list of inline `[sha7]` links; clicking or activating a link shall scroll the ledger crypt panel to the corresponding row (via `#ledger-item-{sha7}`) and trigger the planchette animation.

**R3.9** The "N of M claims verified" counter shall be announced to screen readers as a live region (ARIA live region with `aria-live="polite"`).

**R3.10** The chat question input shall auto-focus when the séance view becomes active, and the chat history shall auto-scroll to show the newest claim after each response.

**R3.11** When `/api/ask` returns an error, the system shall display the error message in the chat history as a visible notice and re-enable the submit button.

---

### R4 — Planchette animation

**R4.1** When a séance is active, the system shall display a planchette element overlaid on or adjacent to the ledger crypt panel.

**R4.2** When the user activates a citation link (R3.8) or when a new ghost response is rendered and contains at least one citation, the planchette shall animate to visually point toward the cited ledger item row.

**R4.3** The pointing direction shall be implemented as a CSS `transform: rotate()` transition applied to the planchette element; the rotation angle shall be computed in JavaScript from the planchette's current centre position and the cited ledger item's midpoint position on screen.

**R4.4** The CSS transition duration for the planchette rotation shall be 400 ms when `prefers-reduced-motion` is not active.

**R4.5** When `prefers-reduced-motion: reduce` is active, the planchette transition shall be set to `0ms` (instant snap) rather than 400 ms; no rotation animation shall play.

**R4.6** The planchette element shall have an `aria-hidden="true"` attribute; its pointing state shall be communicated textually via the citation link label (e.g., `aria-label="See commit abc1234 in crypt"`).

---

### R5 — Candle flicker

**R5.1** When a séance is active, the system shall display one or more candle elements whose flicker animation intensity is mapped to the `score` value of the most recent `/api/ask` response (verified claims ratio, 0–1).

**R5.2** The candle flicker shall be implemented via a CSS keyframe animation whose speed is controlled by the `--confidence` custom property, set from JavaScript after each `/api/ask` response; `--confidence` shall range from 0 (no recent response or score = 0) to 1 (score = 1).

**R5.3** The animation-duration for the candle flicker shall be derived from `--confidence` such that:

- at `--confidence = 1` the flicker cycle period is no shorter than 333 ms (3 Hz cap), and
- at `--confidence = 0` the candle is near-static (very slow pulse, period ≥ 4 000 ms).

**R5.4** The 3 Hz cap (R5.3) shall be enforced regardless of user input; it shall not be adjustable via any JavaScript path.

**R5.5** When `prefers-reduced-motion: reduce` is active, the candle animation shall be replaced with a static opacity shift driven by `--confidence` (no keyframe animation); the opacity shall range from 0.3 (low confidence) to 1.0 (full confidence).

**R5.6** The candle element shall be `aria-hidden="true"`.

---

### R6 — Fog density

**R6.1** When a séance is active, a fog layer shall be rendered behind the main content panels.

**R6.2** The fog shall be implemented as layered CSS radial gradients or a `<canvas>` element; heavy JavaScript particle systems are prohibited.

**R6.3** The fog density shall be mapped to the haunting score returned by `/api/exorcise`; before exorcism has been run the fog shall be at minimum density (score treated as 0).

**R6.4** The CSS or canvas fog intensity shall be driven by a `--haunting-score` custom property set on the root element, ranging from 0 (no fog) to 100 (maximum density); the mapping from score integer to visual opacity shall be linear (`opacity = score / 100 * MAX_FOG_OPACITY`, where `MAX_FOG_OPACITY ≤ 0.85`).

**R6.5** Fog density transitions between score values shall animate over 1 000 ms; when `prefers-reduced-motion: reduce` is active this transition shall be suppressed (instant update).

**R6.6** The fog layer shall not intercept pointer events (`pointer-events: none`).

**R6.7** The fog layer shall be `aria-hidden="true"`.

---

### R7 — Exorcism panel

**R7.1** When a séance is active, the system shall provide an "Exorcise" button in the UI.

**R7.2** When the user activates the Exorcise button, the system shall POST to `/api/exorcise` with `{ sessionId }`, disable the button, and display a loading indicator labeled "Performing exorcism…".

**R7.3** When `/api/exorcise` returns HTTP 200, the system shall reveal the exorcism panel containing:

- the haunting score displayed as an integer (0–100) with a visual severity indicator (text labels: 0–25 "Restless", 26–50 "Troubled", 51–75 "Haunted", 76–100 "Possessed"),
- a signal breakdown table with one row per signal (signal name, raw value as a percentage, weighted contribution),
- a "Marker locations" list of `{ sha7, lineText }` pairs (empty list shown as "No markers found"),
- a "Characterization tests" section listing each test description as a numbered item,
- a "Refactor steps" section listing each step as a numbered card with description, rationale, reversibility flag, and verified citations,
- a "Do not touch" list with entries showing line range, reason, and verified citations.

**R7.4** When `/api/exorcise` returns an error, the system shall display the error message as a visible, accessible error notice adjacent to the Exorcise button and re-enable the button.

**R7.5** The haunting score value returned from `/api/exorcise` shall be used to update the fog density (R6.3).

**R7.6** Verified citations within refactor steps and do-not-touch entries shall be rendered as `[sha7]` links identical in behaviour to chat citation links (R3.8 — scroll and planchette).

**R7.7** Rejected claims within a refactor step shall be rendered as ash-grey struck-through text in non-production environments; in production they shall be hidden (count only).

**R7.8** Each refactor step card shall display a "Reversible ✓" or "Irreversible ⚠" badge communicating the `reversible` boolean; this state shall be communicated via text, not colour alone.

**R7.9** The exorcism panel shall be keyboard-navigable; all disclosure elements (step cards, do-not-touch entries) shall be `<details>` or equivalent keyboard-accessible expand/collapse controls.

---

### R8 — Global accessibility requirements

**R8.1** All text content shall have a contrast ratio of at least 4.5:1 against its background (WCAG 2.1 Level AA).

**R8.2** Every interactive element (inputs, buttons, links, `<details>` summaries) shall have a visible focus indicator with a contrast ratio of at least 3:1 against adjacent colours (WCAG 2.1 SC 1.4.11).

**R8.3** All animations with motion content (candle flicker, planchette rotation, fog transitions) shall be gated on a `@media (prefers-reduced-motion: no-preference)` media query or equivalent `matchMedia` check; reduced-motion alternatives are specified in R4.5, R5.5, and R6.5.

**R8.4** Candle flicker animation frequency shall never exceed 3 Hz (333 ms minimum period) to comply with WCAG 2.1 SC 2.3.1 (Three Flashes or Below Threshold).

**R8.5** Colour alone shall never be the sole means of conveying information; every colour-coded state (verified, rejected, speculation, severity) shall also carry a visible text label or icon label.

**R8.6** The page shall use semantic HTML: `<main>`, `<nav>`, `<section>`, `<article>`, `<h1>`–`<h3>` heading hierarchy, `<form>`, `<label>` elements linked to inputs via `for`/`id`, and `<button>` for all interactive controls that are not links.

**R8.7** The "N of M claims verified" counter (R3.9) shall be wrapped in an ARIA live region so screen readers announce updates without the user navigating to it.

**R8.8** Loading indicators (R1.3, R3.2, R7.2) shall be announced to screen readers via a live region or `aria-busy="true"` on the relevant container.

---

### R9 — Static file serving and no-framework constraint

**R9.1** All UI files shall reside in `public/`; the Hono server shall serve them as static assets at the root path (`/`).

**R9.2** The UI shall use no JavaScript framework, no bundler, and no CSS preprocessor; every file served from `public/` shall be valid standalone HTML, CSS, or browser-native JavaScript.

**R9.3** The UI shall function correctly in the latest stable versions of Chrome, Firefox, and Safari (macOS/iOS/Android) as of the spec date; no polyfills for CSS custom properties or CSS animations are required.

**R9.4** The total uncompressed size of all files in `public/` (HTML + CSS + JS) shall not exceed 150 KB.

---

### R10 — Session state in the browser

**R10.1** The active `sessionId` shall be stored in JavaScript memory only (not `localStorage` or `sessionStorage`) so that closing the tab does not leave stale session references.

**R10.2** When the page is loaded or reloaded, the UI shall start in the summon-form state with no remembered session; the user must summon again.

**R10.3** If the server returns `SESSION_NOT_FOUND` on a `/api/ask` or `/api/exorcise` call, the UI shall display a notice "Session expired — please summon again" and return to the summon form state.
