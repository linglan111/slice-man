# Operation workspace research

Internal source inspection, 2026-10-11. Planning for user-added R10 only; no new layout product edits.

## Evidence and current responsibility

- App.tsx owns global workspace header, banners/progress/stage strip, left preview toolbar and inline editor/ReprocessingPanel, collapsed SecondaryControls containing JobSettings/generation/StylePanel/outputs, and right SubtitleList.
- Existing footer has engine/API/download/export preference entry points. Generation and style settings/action controls are currently mixed inside SecondaryControls.
- ReprocessingPanel.tsx already supplies seconds fields, selected/range modes, main-computed effective scope and cancel/execute. SegmentEditor.tsx supplies source/translation/times and atomic save through App.
- ExportDialog.tsx mixes reusable export form state/options/async publication with Modal wrapper. Extract form content only if an inline export panel is required; preserve existing export cancel/main progress/path-selection behaviour.
- StylePanel.tsx combines template/font/layout/bilingual/emphasis settings with explicit AI prompt/design. JobSettings.tsx owns recognition/translation/review/style provider options. Split settings from actions without duplicating processing logic.
- useWorkspaceLayout measures actual preview children and clamps video/editor/settings sizes; its current exclusion selector recognizes video-stage/preview-editor/reprocessing-panel. New operation panel must be included in allocation measurement and hasInlineForm, not merely styled around old85px minimum.
- editor-layout.css fixes shell height and reserves separate scroll areas; global title/stage/banners consume height. Existing Native BrowserWindow minimum1050x700/default1440x960 define acceptance geometry.
- Standards is rendered at the top of subtitle-list scroll area. A native Modal outside that scroll subtree reliably opens regardless of cue scroll offset.

## Recommended concrete layout

Keep preview left and proofreading right. Add a single preview operation toolbar with generation, partial recognition, partial translation, add overlay cue, AI style, export and name review. An activeOperation state ensures only one panel below is open at a time; no automatic expensive execution on toolbar click. Generation panel has ready/settings summary and explicit actions; style panel has explicit AI description/generate plus settings link; export form uses two-column type/format/video options and save/cancel. ASR/translation/add-cue panels reuse existing validation and publication actions.

Lower-left footer adds generation settings and style settings entries opening keyboard-accessible two-column settings dialogs. Export defaults retain their existing independent entry. Extract shared settings/form content rather than render duplicate active inputs in both areas.

To reclaim centre-bottom height: move title/help/reset above right proofreading, compact phase status beside preview (vertical when width permits, compact wrap otherwise), and place error/result/exports below right cue list with bounded height. Do not let long errors/output paths shrink the cue list to zero; retain clear alert/status semantics and cancel visibility during all work. Empty-workspace shell still has a consistent title/help area.

Within right proofreading heading, Add subtitle follows AI check. Follow playback sits immediately before Standards in the filter toolbar. Standards uses existing native Modal/focus restore rather than inserting content into a scrolled-off list.

## Fit and compatibility

Use a shared operation-panel two-column grid with compact spacing and explicit visible action footer; split source/translation fields or settings/summary rather than nest a second scroll viewport. Native1050x700 test must assert primary/cancel button within viewport/panel without scrollTo, with cue list/video still usable. At deliberately narrow user-dragged widths, permit internal bounded text scrolling but keep action footer pinned and avoid horizontal overflow; user-resize persistence/reset remains.

No provider/IPC/state algorithm changes belong to this child. Coordinate with review/person children for buttons/panels and final guide copy. Existing selectors/tests genuinely need updates for relocated settings/actions; do not suppress legacy functional assertions or fake geometry using renderer-only viewport emulation.

## Tests

Default/min native windows; open each toolbar operation and assert two columns/visible submit+cancel; settings footer expanded/collapsed sidebar; standards after scrolling cue list to bottom; Add/Follow exact relative placement; video/cue list bounds; error/long export paths; drag/keyboard/reset/restart; original-language hidden translation; actual generation/style/export/partial repair plus loop/name workflows after integration.
