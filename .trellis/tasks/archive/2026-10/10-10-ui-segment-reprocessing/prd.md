# UI Polish, Optional Translation and AI Subtitle Review

## Goal
Make Slice Man easier to use while viewing video, correcting subtitles and repairing suspicious passages. Support both native-language subtitle creation and translation without forcing translation services on every project.

## Background and Evidence
- `src/renderer/src/App.tsx:153` and `:158`: glyph branding, old slogan and missing Export Settings icon.
- `src/renderer/src/styles/workspace.css:1` and `:27`; `src/renderer/src/styles/components.css:20`: preview and proofreading stack in a document that grows beyond the viewport.
- `src/main/index.ts:63`: default 1440x960 window, minimum 1050x700, no explicit icon or application-menu suppression.
- `src/renderer/src/App.tsx:47` and `:96`: generation depends on a translation profile and always calls translation after recognition.
- `src/renderer/src/App.tsx:170`: selected-cue translation already exists.
- `src/main/services/jobs/lib/job-service.ts:340`: recognition currently replaces the full timeline.
- `src/main/services/providers/lib/text-provider.ts:80`: text generation already supports OpenAI, Anthropic and Gemini.
- Additional inspection and compatibility notes are in `research-initial.md`.

## Requirements
### R1 - Application identity and styling
Refine the existing dark UI with consistent typography, spacing, borders and vector action/navigation icons. Add a coherent S/video/subtitle application icon in the sidebar, window/taskbar, executable and installer. Add a leading Export Settings icon. Use the approved slogan: "识别、翻译、校对，一站完成".

### R2 - Persistent editing workspace
Keep video preview, subtitle creation actions and proofreading available together, without scrolling the whole page. Give the proofreading list and settings pane independent scrolling. Preserve inline editing, click-to-seek, lyric following, fullscreen playback and access to long forms at default and minimum window sizes.

### R3 - Collapsible navigation and clean window
Allow the left sidebar to collapse into an accessible icon rail with tooltips and an obvious expand control; remember the choice. Remove the default File/Edit/View/Window menu while retaining normal native window controls and text editing shortcuts.

### R4 - Project-wide optional translation
Local-file and URL import must let users choose whether the project needs translation. Persist that choice and allow changing it in project settings. Original-language mode must generate, preview, correct and export source subtitles without a translation profile or translation request. Apply this mode to every generation/rerun/repair/translation step, not just the primary button. Translation-only actions and bilingual controls are unavailable until translation is enabled. Enabling translation exposes target language/service controls and explicit translation actions; disabling it preserves stored translations but displays and exports source text only. Existing projects retain their prior behavior on upgrade.

### R5 - Target selection and range boundaries
Support selected existing subtitle cues and explicit video start/end time ranges, including gaps with no subtitles. For recognition, automatically expand to whole intersecting cues and show the effective range and affected cue count before execution (approved by user). Expand across overlapping boundary cues consistently. Nonadjacent selections form separate processing ranges rather than one interval spanning unrelated passages. Time-range translation targets existing intersecting cues and keeps cue timing intact; an empty target reports that there is no text to translate.

### R6 - Partial recognition and translation
Place "重新识别片段" and "重新翻译片段" immediately to the left of "添加画面字幕". Partial recognition uses the current local/cloud engine and may include translation only if project translation is enabled and the user selects it. Replace only the displayed effective target; preserve unrelated cues, corrections, style references and historical exported files. A recognition-plus-translation operation publishes only after all requested processing succeeds; failure/cancellation retains prior target content. Fresh recognition may change cue count and timing; translation-only preserves source text, IDs and timing. Progress, cancel, missing configuration and stale-revision errors must be understandable.

### R7 - AI review of all subtitles
Add an optional full-subtitle text review for suspicious timing, source text and existing active translations/caption content (user decision). Use supplied subtitle text/timing and neighbouring context; do not analyze or upload source audio for this review. Flag suspicions with cue references, categories and short reasons. Do not claim acoustic correctness, fabricate subtitles for gaps, or modify source/timing/translations automatically. Original-language projects can review source/timing without a translation service by selecting an independent review text service.

### R8 - Review and quick repair interaction
Integrate review in the proofreading area with "全部" and "待检查" filters/counts, cue reason tags and direct seek/play. Offer scoped re-recognition, translation-only when enabled, optional simultaneous translation, batch selection, manual edit and ignore/acknowledge. Show the effective repair range inline before replacement. Do not require a separate page or repeated large dialogs. Edited/replaced findings become pending recheck rather than silently verified. Old reports cannot be used as current evidence after the inspected content or service settings change. Keep review outcomes/acknowledgments with the project across restart.

### R9 - Data and workflow compatibility
Preserve current uncommitted work and existing project content. Retain revision/busy/cancellation guards, local GPU fallback and cloud timestamp requirements. Retain current source-only preview, manual CRUD, export preferences and no-overwrite output publication. Report partial processing as partial processing; do not imply untouched content was re-recognized or reviewed.

### R10 - Contextual four-level review with fixed criteria (user clarification 2026-10-11)
AI review must analyze subtitle meaning together with its surrounding dialogue, including low contextual relevance, missing transitions and suspected omissions. Every reviewed cue gets one explicit suspicion level: none/low/medium/high, displayed as 无/低/中/高. Unreviewed, legacy-ungraded and outdated results must not become “无”. Use a single versioned rubric with examples and conservative evidence thresholds in every request; the model identifies applicable rule IDs with grounded reasons, and main derives the level from the fixed rule mapping rather than accepting an arbitrary model score. “无” means no obvious suspicion detected, not acoustic verification. Low covers minor/weak cues without material meaning change; medium requires concrete contextual/readability/meaning evidence needing human confirmation; high requires strong evidence of a severe problem. Topic shifts, quotations, humour and spoken ellipsis alone never establish a high issue.
Keep bounded chronological batches and overlapping neighbouring context across batch boundaries. Selected-cue rechecks must receive the same contiguous context as a full scan, rather than assembling unrelated selected cues as a fictional dialogue. Track the actual supplied context as report dependencies: changes to context, mode, model or rubric invalidate affected assessments, including previously clear cues. Preserve old reports across failure/cancellation and legacy read compatibility. Show per-cue badges, one compact four-level filter/count interaction and existing scoped repair controls without breaking the minimum-window layout.

## Acceptance Criteria
- AC1 (R1,R3): application/sidebar/native/package icons share one identity, all navigation items have consistent icons, approved slogan appears, sidebar collapse survives restart, and File/Edit/View/Window remains absent even after Alt.
- AC2 (R2): at actual 1440x960 and 1050x700 windows, video, processing/add controls and usable proofreading are visible together; editing a long form or scrolling subtitles/settings does not move the whole document or hide the player. Both sidebar states, banners and portrait video remain usable.
- AC3 (R4): both import paths record the user's translation choice. Original-language generation/rerun/repair makes zero translation-provider calls, needs no translation configuration and produces source-only windowed/fullscreen playback plus MP4/MKV/SRT/ASS/VTT output.
- AC4 (R4,R9): toggling translation preserves stored text; enabling it allows explicit translation without unnecessary recognition; legacy saved jobs remain readable and keep prior translated display/behavior.
- AC5 (R5,R6): cue and time selection handle disjoint/overlapping/boundary/gap/empty targets correctly; expanded effective ranges match the server's replacement scope; new timestamps remain absolute and bounded by source duration.
- AC6 (R6,R9): local and cloud scoped reruns use fresh cue IDs and replace only approved targets. Unrelated cues/emphasis remain unchanged. Translation-only changes only target translations. Missing configuration, stale revision, busy, cancellation and failure do not overwrite valid content.
- AC7 (R6): combined recognition/translation commits once only after success; recognition success followed by translation failure/cancellation retains previous target subtitles. Successful silence is shown as a valid empty result for the target, distinct from provider failure.
- AC8 (R7): review scans all cues in bounded batches with context, validates IDs/categories/reasons and provides progress/cancel. No-audio/no-translation review works. A failed/incomplete scan is not presented as an all-clear report.
- AC9 (R8): findings survive restart, locate playable fragments, support ignore/manual/batch repair and mark changed content for recheck. No finding from an old content snapshot applies blindly to new cues.
- AC10 (R9): relevant unit/integration and isolated real Electron E2E pass. Real media/native tests cover cropped-audio offsets, unchanged exports/source files and original-only rendering. Layout screenshots and packaging-icon evidence are saved to this task.
- AC11 (R10): full review explicitly covers every cue with one validated four-level assessment. Unknown/missing/duplicate IDs, unknown rules and references outside the supplied context fail without replacing the previous report. Server-side fixed rule mapping and examples determine the severity; repeated requests use the same rubric version and stable chronological context.
- AC12 (R10): cue badges/grade counts/filtering and batch repair work for all four levels; unreviewed/legacy/stale cues remain distinguishable. Editing a neighbour makes dependent previously-clear and flagged results require recheck. Context-boundary and sparse-selected tests plus actual minimum/default-window screenshots cover the refinement.

## Out of Scope and Limits
- Acoustic verification against original audio, multimodal models and automatic full-video second transcription for review.
- Automatic application of AI corrections or any guarantee that suspected errors are actual errors.
- Waveform editing, draggable timeline, advanced subtitle merge/split tools and custom native titlebar redesign.
- Provider linguistic accuracy remains provider-dependent; deterministic provider fixtures establish workflow correctness, not translation quality.

## Decision and Artifact Status
User approved: slogan, both selection modes, automatic whole-cue boundary expansion, text/timing-only AI review, and import-time project-wide translation choice. User subsequently approved the consolidated plan and implementation with "可以". On 2026-10-11, user requested continuation and clarified that review must jointly analyze context, classify every cue into four grades and establish consistent standards. R10/AC11/AC12 record that refinement to the authorized review functionality. Implementation remains on `codex/ui-segment-reprocessing`; design and execution/context artifacts accompany this PRD.
