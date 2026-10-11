# Optimize subtitle workspace layout and UI regression

## Goal

Move subtitle proofreading to the right, move secondary settings below with collapse support, fix UI defects, and delegate full regression review and Electron E2E.

## Background and Evidence

- The user wants frequent proofreading actions available without scrolling the entire workspace; scrolling through individual cues remains necessary.
- `src/renderer/src/App.tsx:189` places preview and proofreading vertically in one column; `:197` reserves the right column for secondary settings.
- `src/renderer/src/styles/editor-layout.css:36` fixes the settings column width while the preview and subtitle panel compete for height (`:41`, `:50`). Preview editing shrinks the video and caps the form at 170px (`:74`, `:75`), further reduced at narrow widths (`:107`). Severity: major usability defect.
- `src/renderer/src/styles/review-grades.css:9` prohibits filter toolbar wrapping. Combined with narrow columns and translated text this can clip controls. Severity: moderate usability defect.
- Native windows support a default 1440x960 and minimum 1050x700 (`src/main/index.ts:72`). Existing Electron tests exercise real IPC, media encoding, and isolated user data.

## Requirements

- R1: Display preview on the left and subtitle proofreading on the right throughout supported desktop window sizes. Proofreading has the available workspace height and independently scrollable cues.
- R2: Move existing generation settings, generation actions/status, subtitle style and exported-file information below the preview. Provide an accessible collapse/expand control and remember the user's preference. Initially collapse secondary content for existing subtitles, and expose it for projects awaiting generation.
- R3: Keep proofreading heading, add, AI check, grade filter, follow playback and selected-cue actions accessible in the viewport. Editing, additions, deletion, timing navigation, partial processing and preview subtitle clicks remain operational.
- R4: Correct layout conflicts, squeezed preview, clipped forms/controls, long titles/text overflow, banners and minimum-window regressions. Preserve usable preview and bounded local scrolling while editing and processing.
- R5: Preserve existing data, IPC behavior, source/translation modes, styles, exports, profile/runtime dialogs and import flows. Existing local changes must not be reverted.
- R6: Delegate implementation according to the Trellis workflow; after implementation delegate an independent complete regression review and real Electron end-to-end testing. Fix discovered issues before completion and retain screenshots/results.
- R7: Allow users to drag pane dividers to adjust the expanded navigation width, preview/proofreading width allocation, and preview/lower-settings height allocation. Inline preview edit/repair areas support height adjustment when present. Preserve the left-preview/right-proofreading arrangement. Remember user dimensions, clamp them to usable limits after window resize, and provide keyboard adjustments and reset-to-default.
- R8: Per the user's red-box screenshot correction, application names in the native window title, HTML document title and workspace brand label must be exactly `Slice Man`; remove the descriptive title suffixes and `SUBTITLE STUDIO` label. Keep project names and the existing tagline.

## Acceptance Criteria

- AC1 (R1, R3, R4): At 1050x700, 1440x960 and 1920x1080 native windows, both sidebar states show left preview/right proofreading; common proofreading controls fit without document scrolling or horizontal clipping, with and without banners, selection and review summaries.
- AC2 (R1, R2): Cue scrolling does not move the preview or proofreading toolbar. Expanding/collapsing secondary content does not displace the right panel; controls remain keyboard accessible and preference survives restart.
- AC3 (R3, R4): Long portrait/landscape media, long titles/cues, preview/list inline editors, new drafts and partial-processing forms expose their inputs and save/cancel/execute actions through appropriate local scrolling; the video never collapses to an unusable strip.
- AC4 (R3, R5): Exercise cue CRUD, playback seeking/following, review/filter/ignore/recheck, selected/range repair, source-only/translation/bilingual modes, styles, imports, profile/runtime settings, cancellation/retry, text and video exports, and persistence through existing and new regression coverage.
- AC5 (R6): Lint, TypeScript, unit/integration suite, build and complete available Electron E2E suite pass. Independent review findings are resolved. Real-credential/network/GPU skips and fixture limitations are reported honestly, separately from passed mock-provider tests.
- AC6 (R7): Actual pointer drags change pane geometry in the intended axis, keyboard separator controls work, preferences survive restart, reset restores defaults, and aggressive drags/window resizes cannot hide common proofreading actions or collapse preview/list/form viewports. Verify all supported native sizes, sidebar/disclosure states, and inline processing/edit modes.
- AC7 (R8): A real Electron window reports native and document titles exactly `Slice Man` before/after import/restart; the workspace brand label at its visible default width reads `Slice Man`, with neither old title suffix nor old studio label present.

## Scope Boundaries

- No new recognition/translation provider, database schema, export codec or unrelated product feature.
- Pane resizing is in scope; module reordering/free placement is out of scope, matching the user's explicit choice.
- Preserve the current application identity and dark visual system.
- Do not modify or close the user's installed/running application; tests use isolated app data.
- Paid live-provider calls require existing explicit authorization and usable credentials; otherwise report their gated tests as skipped.

## Planning Status

Task creation, planning, the original layout summary and the revised R7/AC6 pane-resizing summary approved by the user on 2026-10-11. The user selected width/height adjustment over reordering and explicitly directed continuation after the revised final review. The user subsequently gave the small exact-name correction R8. Full implementation, these explicit UI corrections and regression are authorized.
