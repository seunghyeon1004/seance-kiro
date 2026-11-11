---
inclusion: fileMatch
fileMatchPattern: 'public/**'
---

# Séance — Spooky UI Steering

Applies to `public/`. Vanilla HTML, CSS and JS; no framework, no build step. Every colour, font, space, size, duration and z-index is a token in `public/tokens.css` `:root`; use `var(--…)`, never a literal, below the token block.

## Colour tokens (`--color-*`, oklch)

- `paper`, `paper-2`, `paper-3`: page background, raised panels, the highest surfaces (question bubbles, candle wax).
- `ink`, `ink-2`, `muted`: body text, secondary text, meta and help text.
- `rule`, `rule-strong`: hairlines; input and control borders (3:1).
- `accent`, `accent-ink`: amber primary buttons and highlights; text on accent.
- `focus`: the focus outline. `flame`: the candle flame. `error`: error borders and fills.
- `verified`, `rejected`, `speculation`: claims that passed the ward, refused claims, speculation.
- `fog`: the fog gradient. `haunt`: the haunting fill of a map tile.
- `sys-text`, `sys-highlight`: `CanvasText` and `Highlight`, only inside `@media (forced-colors: active)`.
- Fonts: `--font-display` (system serif, the ghost's voice and headings), `--font-body` (system-ui), `--font-outlier` (monospace for hashes, quotes, code).

## UI ↔ data mappings

- Candle: `setConfidence(answer.score)` sets `--confidence` on `#candle`; glow, opacity and flicker speed follow it. The flicker period is never under 333 ms (≤ 3 Hz).
- Fog: `setHaunting(score)` sets `--haunting-score` from the exorcism; fog opacity is `score / 100 × --max-fog`.
- Planchette: `pointPlanchette(sha)` rotates it towards the cited row in the crypt.
- Map tile: `--share` = departed touches / total touches drives the `haunt` fill. The fill repeats the text, never replaces it.
- Counter `#verified-counter`: "N of M claims passed the ward this séance", silence claims named apart.

## Vocabulary

- A claim "passed the ward"; its label is "Citations verified". Never call a sentence verified or true.
- Refused claims: "Unverified" plus "The ward refused it: <reason>". Silence: "The record is silent (the ghost's words, not checked)".
- Plan text outside cited claims is "the model's words".
- Recorded turns and plans always show the recorded label; scripted (possessed) turns always show the scripted label; planted claims show "Planted by you". Planted and scripted turns never count as the ghost's; a recorded turn is the ghost's answer and counts.

## Accessibility floor (non-negotiable)

- Text ≥ 4.5:1, borders and focus rings ≥ 3:1, against the real backgrounds.
- An error is tied to its control: `aria-invalid` and `aria-describedby` on the field, or `aria-describedby` on the button that failed.
- A busy button uses `aria-disabled="true"`, never `disabled`, so it keeps focus.
- Grid tracks use `minmax(0, 1fr)` (or `minmax(min(100%, …), 1fr)`) so the layout shrinks to 320 px.
- No colour-only signal: every claim state, warning and map tile says it in text.
- The candle control ("Still the candles" / "Light the candles") adds `html.still`, stops the flame and is remembered in `localStorage`. `prefers-reduced-motion` also stops every animation.
- `@media (forced-colors: active)` uses `sys-text` and `sys-highlight` so bars, lit crypt rows and focus outlines stay visible; the map tile's `haunt` fill is hidden and its text carries the meaning.
- Every control is keyboard-operable with an instantly visible `:focus-visible`.

## Components

- **Guide** (`#guide`, "Try it in three clicks"): ask, try to fool the ward, run the exorcism; each step marks itself done.
- **Source lines**: "The line in question", the selected lines at HEAD.
- **Claim** (`claimNode`): label, text, cite buttons, and under a verified claim "The words the ward found" (hash, field, quote as text).
- **Map**: `.map-legend` (glyph, name, last seen, files haunted), `.map-tile` per file with "Summon here" (none on "You are here"), "Tended by the living" for the rest.

## Design floor

- No `transition: all`; animate only `transform` and `opacity`. `overflow-x: clip` on `html` and `body`.
- No eyebrows, tracked capitals or small caps for labels; sentence case. No emoji icons, no card in a card.
- Never invent a number: every figure on screen comes from the ledger, the ward or the score.

## Checks in the repo

- `npm run contrast` reads the real `:root` tokens in `tokens.css`, fails if the comment table disagrees with them, and checks the pairs `styles.css` uses.
- `test/ui/` (jsdom DOM tests, `test/ui/pbt/`) and `test/e2e/` (the page against the real server through `test/e2e/harness.ts`).
