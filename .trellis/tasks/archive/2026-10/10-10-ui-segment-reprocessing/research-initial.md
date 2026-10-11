# Initial Repository Findings

## Current UI
- `src/renderer/src/App.tsx:153`: sidebar brand uses a text/glyph mark and slogan "让视频跨越语言".
- App provides preview-local and list-local inline subtitle editors; these must remain accessible after layout changes.
- `src/renderer/src/styles/workspace.css:1`: root uses min-height, allowing document growth.
- `src/renderer/src/styles/workspace.css:27`: preview and subtitle list share the left column; settings occupy the right column.
- Preview uses a fixed 16:9 aspect ratio and is followed by subtitle controls/list, explaining whole-page scrolling.
- Sidebar has no collapse control; most navigation icons are Unicode glyphs and Export Settings has none.

## Processing
- App stores selected subtitle IDs and already calls `jobs.translate` with that selection.
- `JobService.runRecognition` supports whole-video recognition and confirmed whole-video replacement with revision protection.
- Local and cloud recognition paths already use MediaService extraction; new range recognition can reuse providers and normalization but requires range-aware timestamp and merge contracts.
- Translation writes completed batches with revision protection. Combined partial ASR and translation needs an explicit failure/publication contract.
- Existing full rerun removes all cue-specific emphasis; partial rerun must preserve emphasis attached to unaffected cues.
- Historical export files are retained when source edits invalidate derived output states.

## Window and Packaging
- Main window defaults to 1440x960 with minimum 1050x700.
- Main window does not set an icon or suppress the application menu.
- electron-builder config has no app icon and disables executable signing/editing; packaged icon verification must include the actual executable/installer behavior.

## Product Decisions Pending
1. Selection mode resolved: both existing subtitle cue selection and explicit video start/end time range.
2. Range-boundary rule resolved: automatic expansion to whole intersecting cues, with effective range shown before execution. Combined-operation failure behavior proposed: draft and commit atomically, preserve previous cues on failure/cancellation.
3. Slogan resolved: "识别、翻译、校对，一站完成". Concrete styling/layout/repair proposals now live in the final PRD/design, pending full-plan approval.

## Proposed Layout Direction (In Final Plan for Approval)
A viewport-bounded editor with persistent preview/action bar, independently scrolling subtitle list, independently scrolling right settings pane, and a collapsible left navigation rail. Validate both default and minimum window sizes; keep inline editor usable.

## AI Review Addition (2026-10-10)
- User added full-subtitle AI issue detection and fast targeted recognition with optional translation; requests discussion of friendly interaction.
- `src/main/services/providers/lib/text-provider.ts:80` exports `generateText` supporting existing OpenAI, Anthropic and Gemini text protocols.
- `src/renderer/src/components/JobSettings.tsx` has recognition, translation and style profiles, but no review-specific profile/entry.
- Current Segment contract exposes cue IDs, source/translated text, timing and translation-stale status, without acoustic confidence or review annotations.
- Text-only review can inspect supplied subtitle content and consistency. It lacks source audio evidence, so fluent but acoustically incorrect words cannot be verified by that mode.
- Full audio verification would need an additional recognition/comparison or audio-model contract and introduces extra full-media processing/upload, not just text review. User explicitly excluded it: review only suspicious timeline/source/caption content.
- Proposed interaction uses the existing proofreading region, avoiding a separate page: review filter, reason tags, click-to-play, targeted rerun, optional translation, multi-select repair and ignore/manual-edit choices. Review outcomes must bind to the inspected revision so stale findings cannot be applied blindly after edits.

## Import-Time Project-Wide Translation Choice (2026-10-10)
- User clarified that optional translation applies to every step and is chosen during import, not merely via a primary-action checkbox.
- `optionsSchema` lacks translation enablement; imported jobs currently initialize options via `optionsSchema.parse({})`.
- Local import has no settings input and URL import currently accepts only URL. Both typed paths and download import callback need to carry initial project mode atomically.
- Preview/native tracks and subtitle compiler currently prefer translatedText whenever present. Original-only mode must explicitly select source content, including after switching a previously translated project, without erasing stored translations.
- Current Store material-profile invalidation handles recognition/translation/style dependencies; review profile/report applicability needs an independent extension.
- Existing package smoke accepts `--app-dir` only for an ordinary directory under workspace/dist; use a separate task output there.
- Prior-task specs and memory search confirm inline editing, lyric following, native-control clearance and historical-output preservation should remain intact.
