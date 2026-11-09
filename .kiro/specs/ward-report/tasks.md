# Ward Report — Implementation Tasks

Commit messages must use the format `ward-report T<N>: <description>`.

Pre-condition: `ghost-verifier` is complete (`VerifierResult` and claim schemas exist in `src/ghost/schema.ts`).

## T1 — Renderer

- [x] Create `src/ghost/report.ts` with `WardReportMeta`, `escapeMd` and `renderWardReport` as in design.md.
- [x] Create `test/ghost/report.test.ts`: one verified memory claim with a quote, one silence claim, one rejected claim; assert the exact output. Assert the struck heading is absent when nothing is rejected.

## T2 — Property tests

- [x] Create `test/ghost/pbt/report.pbt.ts` with properties P1–P4 from design.md, using `@fast-check/vitest` in the style of `test/ghost/pbt/verifier.pbt.ts`.

## T3 — API field and copy button

- [x] Add `report` to the `/api/ask` and `/api/ward` responses and their schemas; extend `test/server/ask.test.ts`.
- [x] Add a "Copy ward report" button to the ghost panel in `public/index.html` and `public/app.js` (clipboard API, status text in the existing `role="status"` element).
