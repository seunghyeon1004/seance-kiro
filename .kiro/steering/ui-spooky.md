---
inclusion: fileMatch
fileMatchPattern: "public/**"
---

# Séance — Spooky UI Steering

Applies when editing files under `public/`. Vanilla HTML/CSS/JS only — no framework, no build step for the UI.

## Design tokens
- **Background:** `#0a0a0f` (near-black)
- **Fog:** `#1a1a2e` (deep navy)
- **Candle glow:** `#ff6b35` (amber) — intensity mapped to evidence confidence (0–1)
- **Verified claim:** `#c8ffc8` (pale green glow)
- **Unverified / rejected claim:** `#6b6b6b` (ash grey, struck through)
- **Speculation label:** `#9b59b6` (muted purple, italic)
- **Font:** system serif for ghost voice; system monospace for SHAs and quotes

## UI ↔ data mappings
- Candle flicker rate ∝ evidence confidence of the current claim — never exceed 3 Hz
- Ouija planchette animates to point at the cited commit in the ledger panel
- Fog density ∝ haunting score (0 = clear, 100 = maximum fog)
- Verified claims: pale green glow; rejected claims: ash-grey + strikethrough
- "N of M claims verified" counter always visible while a séance is active

## Accessibility floor (non-negotiable)
- All text contrast ≥ 4.5:1 against its background (WCAG AA)
- Respect `prefers-reduced-motion`: replace flicker/pulse animations with a static opacity shift; planchette movement becomes instant
- Candle flicker capped at 3 Hz even without reduced-motion (photosensitivity)
- Every interactive element reachable and operable by keyboard; focus ring always visible
- Rejected/speculation claims communicated via text label, not colour alone

## Component notes
- Candle: CSS animation driven by a `--confidence` custom property set from JS
- Fog: layered `<canvas>` or CSS radial gradients behind the main panel; avoid heavy JS particle systems
- Planchette: CSS `transform: rotate()` transition pointing at an active ledger item
