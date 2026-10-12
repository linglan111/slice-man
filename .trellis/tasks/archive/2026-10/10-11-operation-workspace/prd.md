# Visible operation toolbar and compact two-column panels

## Goal
Expose common generation/style/export actions and keep opened operation forms directly usable without scrolling down.

## Requirements
- W1: Generation, style and export actions join re-recognize/retranslate/add-overlay-subtitle in the preview operation toolbar. Generation/style settings are accessible from the lower-left settings area rather than hiding action buttons there.
- W2: Clicking an operation opens its panel below the toolbar with two columns and compact spacing; retain draggable width/height and visible primary/cancel actions at default/minimum native sizes.
- W3: If necessary reclaim height: stage status beside preview, workspace title/header over proofreading, errors/output information below proofreading. Treat these as layout tools, not mandatory changes if fit already succeeds.
- W4: Move Add subtitle to the right of AI review; move follow playback immediately left of Standards. Standards opens in a reliably visible region.
- W5: Preserve playback, manual edits, settings persistence, original-language safeguards, export and current loop controls. Every panel must explain unavailable prerequisites.
- W6: Use one active operation panel; opening a toolbar panel does not start an expensive generation, export or name request. Preserve explicit execute/cancel and busy ownership.

## Confirmed evidence
See parent `research/operation-workspace.md`: App owns header/status/preview/secondary settings and right list; JobSettings and StylePanel mix configuration with actions; export form currently belongs to a Modal. useWorkspaceLayout measures known inline panels and must account for the new panel. Existing BrowserWindow geometry is default1440x960/minimum1050x700. Standards currently opens inside the independently scrolled list.

## Acceptance criteria
- [x] All specified actions visible in shared toolbar, with lower-left generation/style settings entries and two-column forms.
- [x] At 1440x960/1050x700 native windows, opening each operation shows action/cancel without manual vertical scrolling; preview and right cue list remain usable.
- [x] Required button placement and standards visibility pass native tests after list scroll.
- [x] Draggable/resizable/collapsible layout persists, reset works, and import/recognize/translate/style/export/loop regressions pass.

## Dependencies
App/SubtitleList implementation waits for original loop/guide integration. Coordinates standards/profile controls with review-reliability child; final guide copy reflects new settings/action labels. Does not change main processing contracts itself.

## Out of scope
Free module rearrangement, separate duplicated processing APIs, automatic action execution on panel opening, and guaranteeing no internal scroll after deliberately shrinking a user-resizable panel to its minimum. Default/minimum window primary controls remain visible; constrained layouts keep action footer accessible.

## Planning status

Latest combined final-planning-summary.md explicitly approved by user on2026-10-11 (批准). Child activated on codex/subtitle-repair-onboarding; implementation in progress. See task.json approval record.

## Final validation2026-10-12

Approved behavior implemented and independently reviewed. Global lint/typecheck/build passed; full unit/integration60files574pass; final native40total37pass/3explicitexternalgateskip/0fail. See parent evidence/final-added-e2e-review.md and final-unit.log. Implementation is not an AI accuracy guarantee. Task remains active pending required commit confirmation and bookkeeping; no release/version change.
