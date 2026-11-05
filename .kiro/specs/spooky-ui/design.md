# Spooky UI — Design

Spec ID: `spooky-ui`

---

## 1. Overview

The UI is a single-page application (SPA-like, no framework) served from `public/`. All state
lives in a plain JS module (`public/js/app.js`). Three CSS files handle layout, theming, and
animations. No build step; files are served directly by Hono's static-file middleware.

The UI has two top-level states:

- **Summon state** — the summon form is visible; ledger crypt and chat are hidden.
- **Séance state** — the form is hidden; ledger crypt, chat, candle, fog, planchette, and
  exorcism button are visible.

A session transition (form submit → `200 OK` from `/api/summon`) is the only way to enter the
séance state in the current browser session. Page reload always resets to summon state.

---

## 2. File structure

```
public/
  index.html           single HTML document; all panels present, visibility toggled via CSS class
  css/
    theme.css          design tokens (custom properties), typography, colour palette
    layout.css         two-column séance layout, ledger/chat scroll regions
    animations.css     candle keyframes, fog, planchette transition, reduced-motion overrides
  js/
    app.js             top-level state machine; imports api.js, ledger.js, chat.js, exorcism.js
    api.js             fetch wrappers for /api/summon, /api/ask, /api/exorcise
    ledger.js          renders ledger items; exposes highlightItem(sha7) / clearHighlight()
    chat.js            renders claim bubbles; exposes appendResponse(verifiedAnswer)
    exorcism.js        renders exorcism panel; exposes renderExorcism(exorciseResponse)
    planchette.js      computes rotation angle; exposes pointAt(sha7)
    candle.js          maps score → --confidence; sets CSS custom property
    fog.js             maps haunting score → --haunting-score; sets CSS custom property
```

---

## 3. Component descriptions

### 3.1 Summon form (`#summon-section`)

A `<form id="summon-form">` inside a `<section>`. On submit, the default browser submission is
prevented. Client-side validation runs synchronously before the fetch; errors are injected into
`<span class="field-error" aria-live="polite">` siblings of each input, which are empty by
default and populated only on failure.

State transitions driven by `app.js`:

- Submit → disable button, show `#summon-loading` (aria-busy="true"), POST `/api/summon`.
- 200 → hide `#summon-section`, show `#seance-section`, call `ledger.init(items)`, focus chat input.
- Error → populate `#summon-error` notice, re-enable button.

### 3.2 Ledger crypt panel (`#ledger-panel`)

A `<section aria-label="Ledger Crypt">` containing a `<ul id="ledger-list">` of `<li>` items.
Each `<li>` has `id="ledger-item-{shortSha}"` and `tabindex="0"`.

Each item renders:

```html
<li id="ledger-item-{sha7}" tabindex="0" class="ledger-item">
  <span class="ledger-sha">{sha7}</span>
  <span class="ledger-author">{author}</span>
  <span class="ledger-date">{formattedDate}</span>
  <span class="ledger-subject">{subject}</span>
  <details class="ledger-details">
    <summary>Show hunk</summary>
    <pre class="ledger-hunk">{hunk}</pre>
    <pre class="ledger-body">{body}</pre>
  </details>
</li>
```

`ledger.js` exports:

- `init(items: EvidenceItemSummary[])` — renders all rows from the summon response.
- `highlightItem(sha7: string)` — adds `class="ledger-item--cited"` to the matching row;
  removes it from any previously highlighted row.
- `clearHighlight()` — removes `ledger-item--cited` from all rows.
- `scrollToItem(sha7: string)` — `scrollIntoView({ behavior: "smooth", block: "center" })`;
  instant when `prefers-reduced-motion: reduce`.

`EvidenceItemSummary` is the subset of ledger fields needed for display:

```ts
{
  shortSha: string;
  author: string;
  date: string;
  subject: string;
  body: string;
  hunk: string;
}
```

(This type is only used in the browser; it is not a Zod schema.)

### 3.3 Séance chat (`#chat-panel`)

A `<section aria-label="Séance Chat">`. Contains:

- `<div id="chat-history" aria-live="polite" aria-relevant="additions">` — claim bubbles appended here.
- `<form id="ask-form">` — textarea + submit button.
- `<div id="verified-counter" aria-live="polite" aria-atomic="true">` — "N of M claims verified".

`chat.js` exports:

- `appendResponse(answer: VerifiedAnswerPayload)` — renders claim bubbles and updates the counter.
- `showLoading()` / `hideLoading()` — show/hide the "ghost stirs" indicator.
- `showError(message: string)` — append an error notice to chat history.

`VerifiedAnswerPayload`:

```ts
{
  voice: string;
  verified: Array<{
    text: string;
    kind: 'memory' | 'speculation' | 'silence';
    citations: Array<{ sha7: string; quote?: string }>;
    speculative: boolean;
  }>;
  rejected: Array<{ text: string; kind: string; reason: string }>;
  score: number;
  sessionId: string;
}
```

Claim bubble HTML template (memory kind):

```html
<article class="claim claim--memory" aria-label="Verified memory claim">
  <p class="claim-text">{text}</p>
  <ul class="claim-citations" aria-label="Citations">
    <li>
      <a
        href="#ledger-item-{sha7}"
        class="citation-link"
        aria-label="See commit {sha7} in crypt"
        >[{sha7}]</a
      >
    </li>
  </ul>
</article>
```

Speculation and silence variants swap the class and prefix label. Rejected bubbles (non-production)
use `class="claim claim--rejected"` with `aria-label="Unverified claim"`.

### 3.4 Planchette (`#planchette`)

An SVG or PNG element with `aria-hidden="true"` positioned `position: fixed` or `position:
absolute` relative to the ledger panel. Its rotation is a single CSS `transform: rotate({angle}deg)`.

`planchette.js` exports:

- `pointAt(sha7: string)` — compute target row's `getBoundingClientRect()`, compute angle from
  planchette centre to row midpoint, set `element.style.transform = rotate({angle}deg)`.
- Called by `chat.js` on first citation in each response, and by citation link click handlers.

Rotation computation:

```
dy = targetMidY - planchetteCenterY
dx = targetMidX - planchetteCenterX
angle = Math.atan2(dy, dx) * (180 / Math.PI)
```

The planchette SVG has a pointer tip at the 12 o'clock position (top), so an offset of −90° is
applied: `angle = Math.atan2(dy, dx) * (180 / Math.PI) − 90`.

Reduced motion: `planchette.js` checks `window.matchMedia('(prefers-reduced-motion: reduce)')`;
if true, sets transition duration to `0ms` via an inline style before setting the transform, then
restores it.

### 3.5 Candle (`#candle-section`)

One or more `<div class="candle" aria-hidden="true">` with a `<div class="flame">` inside.
`candle.js` sets `document.documentElement.style.setProperty('--confidence', score.toFixed(3))`
after each `/api/ask` response. Initial value: `0.5`.

`animations.css` defines:

```css
@keyframes flicker {
  0% {
    transform: scaleY(1) rotate(-2deg);
    opacity: 0.9;
  }
  33% {
    transform: scaleY(1.05) rotate(2deg);
    opacity: 1;
  }
  66% {
    transform: scaleY(0.97) rotate(-1deg);
    opacity: 0.85;
  }
  100% {
    transform: scaleY(1) rotate(1deg);
    opacity: 0.9;
  }
}

.flame {
  /* animation-duration controlled by --confidence */
  /* min duration 333ms (3 Hz cap), max duration 4000ms */
  animation-duration: calc(333ms + (1 - var(--confidence, 0.5)) * (4000ms - 333ms));
  animation-name: flicker;
  animation-iteration-count: infinite;
  animation-timing-function: ease-in-out;
}

@media (prefers-reduced-motion: reduce) {
  .flame {
    animation: none;
    opacity: calc(0.3 + var(--confidence, 0.5) * 0.7);
    transition: opacity 0.5s ease;
  }
}
```

The formula guarantees the period is always ≥ 333 ms regardless of `--confidence` value. The
CSS-only cap means no JavaScript path can circumvent it.

### 3.6 Fog (`#fog-layer`)

```html
<div id="fog-layer" aria-hidden="true" class="fog-layer"></div>
```

`fog.js` sets `document.documentElement.style.setProperty('--haunting-score', score)` (integer
0–100) after each `/api/exorcise` response.

```css
.fog-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    ellipse at center,
    transparent 30%,
    color-mix(in srgb, #1a1a2e var(--fog-opacity, 0%), transparent)
  );
  --fog-opacity: calc(var(--haunting-score, 0) / 100 * 85%);
  transition: --fog-opacity 1s ease;
  z-index: 0;
}

@media (prefers-reduced-motion: reduce) {
  .fog-layer {
    transition: none;
  }
}
```

CSS `color-mix` and registered custom properties with `@property` are used for the transition.
If `@property` is unsupported, `fog.js` falls back to direct `opacity` on the layer element.

### 3.7 Exorcism panel (`#exorcism-panel`)

Initially `hidden`. Revealed (remove `hidden` attribute) when `/api/exorcise` returns 200.
Rendered by `exorcism.js`.

Top section: score integer + severity badge.

```html
<div class="score-display">
  <span class="score-value" aria-label="Haunting score: {score} out of 100">{score}</span>
  <span class="score-severity score-severity--{level}">{label}</span>
</div>
```

Severity levels (text labels, not colour only): 0–25 → "Restless", 26–50 → "Troubled",
51–75 → "Haunted", 76–100 → "Possessed". CSS class adds colour reinforcement.

Signal breakdown: `<table>` with columns: Signal, Raw value (%), Weighted contribution.

Refactor steps rendered as `<details>` cards:

```html
<details class="step-card">
  <summary>
    {n}. {description} <span class="badge badge--{reversible}">{label}</span>
  </summary>
  <p class="step-rationale">{rationale}</p>
  <ul class="step-citations">
    …
  </ul>
</details>
```

Do-not-touch entries rendered similarly with line range shown.

`exorcism.js` exports:

- `render(response: ExorcisePayload)` — full render of the panel.
- `ExorcisePayload` mirrors the `/api/exorcise` response shape.

---

## 4. Data interfaces (browser-side)

These are plain TypeScript-annotated JSDoc comments in the JS files (no compilation step; used
for IDE assistance only). They mirror the API response shapes defined in `ghost-verifier` and
`exorcism-plan` specs.

```js
/** @typedef {{ shortSha: string, author: string, date: string, subject: string, body: string, hunk: string }} EvidenceItemSummary */

/** @typedef {{ sha7: string, quote?: string }} Citation */

/** @typedef {{ text: string, kind: 'memory'|'speculation'|'silence', citations: Citation[], speculative: boolean }} VerifiedClaim */

/** @typedef {{ text: string, kind: string, reason: string }} RejectedClaim */

/** @typedef {{ voice: string, verified: VerifiedClaim[], rejected: RejectedClaim[], score: number, sessionId: string }} VerifiedAnswerPayload */

/** @typedef {{ sha7: string, lineText: string }} MarkerLocation */

/** @typedef {{ signal: string, rawValue: number, weightedContribution: number }} SignalBreakdown */

/** @typedef {{ description: string, rationale: string, reversible: boolean, claims: VerifiedClaim[], rejectedClaims: RejectedClaim[] }} RefactorStep */

/** @typedef {{ lineRange: { start: number, end: number }, reason: string, claims: VerifiedClaim[], rejectedClaims: RejectedClaim[] }} DoNotTouchEntry */

/** @typedef {{ sessionId: string, score: number, signalBreakdown: SignalBreakdown[], markerLocations: MarkerLocation[], plan: { characterizationTests: string[], steps: RefactorStep[], doNotTouchList: DoNotTouchEntry[], summary: string }, verifierScore: number }} ExorcisePayload */
```

---

## 5. State machine (`app.js`)

```
SUMMON_FORM
    │  (valid submit → POST /api/summon)
    │  loading: button disabled, #summon-loading shown
    ▼
  ◄─── error ──── SUMMON_ERROR (notice shown, button re-enabled)
    │
    │  200 OK
    ▼
SEANCE_ACTIVE
    │  Chat: POST /api/ask
    │  Exorcism: POST /api/exorcise
    │  SESSION_NOT_FOUND → SUMMON_FORM (notice shown)
    │
    └─── (page reload) ──► SUMMON_FORM
```

State is stored in a module-level variable:

```js
let state = { phase: 'summon', sessionId: null, hauntingScore: 0, lastConfidence: 0.5 };
```

`app.js` is the only file that reads and writes `state`. All other modules receive data via
function arguments and return rendered DOM or update CSS custom properties.

---

## 6. Error handling

| Trigger                           | Handling                                                              |
| --------------------------------- | --------------------------------------------------------------------- |
| `/api/summon` non-200             | Show `error` field from response in `#summon-error`; re-enable button |
| `/api/ask` non-200                | Append error notice to `#chat-history`; re-enable ask button          |
| `/api/ask` SESSION_NOT_FOUND      | Show "Session expired" notice; reset to summon form                   |
| `/api/exorcise` non-200           | Show error adjacent to Exorcise button; re-enable button              |
| `/api/exorcise` SESSION_NOT_FOUND | Same as ask SESSION_NOT_FOUND                                         |
| Network failure (fetch throws)    | Treat as 500; display "Network error — please try again"              |
| Malformed JSON response           | Treat as 500; display "Unexpected server response"                    |

All error notices use `role="alert"` so they are announced immediately by screen readers.

---

## 7. Testing strategy

### 7.1 Unit tests (Vitest + jsdom)

Tests live in `test/ui/`. Each module (`ledger.js`, `chat.js`, `exorcism.js`, `planchette.js`,
`candle.js`, `fog.js`) gets a companion test file.

Key unit test cases:

- `ledger.init` renders the correct number of `<li>` elements with correct `id` attributes.
- `ledger.highlightItem` adds `ledger-item--cited` to exactly one row; a second call moves it.
- `chat.appendResponse` renders one bubble per verified claim; renders no rejected bubbles when
  all claims are verified; shows "N of M" counter with correct values.
- `chat.appendResponse` renders rejected bubbles with `claim--rejected` class when
  `NODE_ENV !== 'production'` and at least one rejected claim is present.
- `exorcism.render` creates a severity badge with the correct text label for each of the four
  score bands.
- `planchette.pointAt` sets a `transform` style containing `rotate(`.
- `candle.js` sets `--confidence` on `document.documentElement` after a call with score `0.75`.
- `fog.js` sets `--haunting-score` on `document.documentElement` after a call with score `60`.

### 7.2 Accessibility lint (PostFileSave hook)

The `.kiro/hooks/a11y-lint.json` hook runs on save of any `public/**` file. The command executes
an accessibility lint script (`scripts/a11y-lint.sh`) that checks:

- All `<img>` elements have `alt` attributes.
- All `<input>` elements have associated `<label>` elements.
- No `tabindex` values greater than 0 are present.
- Presence of `aria-live` on `#verified-counter` and `#chat-history`.

The script exits `2` (blocking the save acknowledgment in the hook) if any check fails, prompting
the developer to fix the issue before continuing.

### 7.3 Property-based tests (fast-check)

The UI module tests that benefit from property-based testing are:

**PU1 — Planchette angle is always a finite number**
For any generated pair of `(planchetteCenterX, planchetteCenterY, targetMidX, targetMidY)`,
`computeAngle(...)` returns a finite number (no `NaN` or `Infinity`). Covers the degenerate case
where planchette and target positions coincide (angle = 0 by convention).

**PU2 — Candle period is always ≥ 333 ms**
For any generated `score` in [0, 1], the computed animation duration
`333 + (1 − score) * (4000 − 333)` is ≥ 333 ms.

**PU3 — Fog opacity is always in [0, MAX_FOG_OPACITY]**
For any generated `score` integer in [0, 100], the computed `fogOpacity = score / 100 * MAX_FOG_OPACITY`
is in [0, MAX_FOG_OPACITY] where `MAX_FOG_OPACITY = 0.85`.

**PU4 — Severity label is always one of the four defined strings**
For any generated integer in [0, 100], `getSeverityLabel(score)` returns one of
`"Restless"`, `"Troubled"`, `"Haunted"`, `"Possessed"`.

**PU5 — Verified counter arithmetic is consistent**
For any generated `VerifiedAnswerPayload`, the counter string
`"{verified.length} of {verified.length + rejected.length} claims verified"` is always
well-formed and the two numbers are non-negative integers.

These tests live in `test/ui/pbt/ui.pbt.ts` and run under Vitest with fast-check.

### 7.4 End-to-end smoke tests (manual / optional)

Not automated in CI. The README documents a manual checklist:

1. Open the page; tab through all form fields; submit with keyboard.
2. Verify candle flicker is visible and below 3 Hz.
3. Enable "Reduce motion" in OS accessibility settings; verify flicker replaced by opacity.
4. Run a séance; verify planchette moves on first citation.
5. Run exorcism; verify fog density increases and severity label is displayed.
6. Simulate `SESSION_NOT_FOUND` (wait 30 min or clear server state); verify UI returns to summon
   form with the expected notice.

---

## 8. Design token reference

| Token (CSS custom property) | Value          | Usage                          |
| --------------------------- | -------------- | ------------------------------ |
| `--color-bg`                | `#0a0a0f`      | Page background                |
| `--color-fog`               | `#1a1a2e`      | Fog / panel depth              |
| `--color-candle`            | `#ff6b35`      | Candle glow, flame             |
| `--color-verified`          | `#c8ffc8`      | Verified claim bubbles         |
| `--color-rejected`          | `#6b6b6b`      | Rejected claim text            |
| `--color-speculation`       | `#9b59b6`      | Speculation bubble             |
| `--confidence`              | 0–1 (JS-set)   | Drives candle duration formula |
| `--haunting-score`          | 0–100 (JS-set) | Drives fog opacity             |

All tokens are declared on `:root` in `theme.css`.

---

## 9. Accessibility design decisions

1. **Colour + text label** for every semantic state — verified (green glow + "Verified"), rejected
   (grey + "Unverified:"), speculation (purple + "Speculation"), severity (colour class + text
   band name). This satisfies WCAG 1.4.1 (Use of Colour).

2. **`aria-hidden="true"`** on all decorative elements (candle, fog, planchette) so screen readers
   skip them entirely.

3. **ARIA live regions** on `#chat-history` (additions), `#verified-counter` (polite, atomic), and
   all error notices (`role="alert"`).

4. **`prefers-reduced-motion`** handled at two levels: CSS `@media` overrides for animations,
   and a JS `matchMedia` check in `planchette.js` for the rotation transition. Both are needed
   because CSS alone cannot remove the JS-triggered transition.

5. **Focus management**: when the UI transitions from summon to séance state, `app.js` calls
   `chatInput.focus()` so keyboard users land in the natural next action.

6. **`<details>`/`<summary>`** used for ledger item expansion and exorcism step cards — natively
   keyboard accessible without ARIA roles.
