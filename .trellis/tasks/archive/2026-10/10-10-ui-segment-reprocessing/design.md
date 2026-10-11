# Technical Design

## Scope and Delivery Structure
One integrated task owns the shared editor, project translation choice, range processing and review/repair UI. Deliver in ordered milestones, with explicit validation gates, rather than independent child tasks: these changes share App state, Job options, the IPC boundary and cue replacement rules. The work is not independently shippable before integration.

## 1. Shared Contracts and Compatibility
- Keep authoritative schemas in `src/shared/contracts.ts` or narrowly scoped shared subtitle-processing/review contracts re-exported from it.
- Add a persisted `translationEnabled` option. Legacy missing values normalize to true to preserve existing projects. The import UI always supplies the user's explicit original-only/translation choice. Add an optional independent review profile ID.
- Import request settings contain only allowed initial subtitle options, not arbitrary Job payloads. Extend local and URL import IPC/preload and the download-to-job callback so initial options commit with the new job. Preserve canceled-file-picker and download ownership/cancellation semantics.
- Add a strict target discriminated union: `{ mode: 'selection', segmentIds: string[] }` or `{ mode: 'range', startMs: number, endMs: number }`. Inputs include job ID/revision. Validate IDs, integer milliseconds, duplicate/empty selections and media bounds in main.
- Add planning and execution APIs such as `planReprocess`, `recognizePartial`, `translatePartial`, `reviewSubtitles`, and finding acknowledgment, returning typed `Result` payloads. Names can follow existing domain patterns; do not create renderer-only alternate APIs.
- Plan result includes effective intervals, affected cue IDs/count, operation type and snapshot revision. Main recomputes/verifies scope at execution; renderer scope is never trusted. Do not store draft selection in the timeline.
- Persist an optional review report in the existing Job payload: report ID, provider/config fingerprint, inspected cue/content fingerprints, reviewed scope, completed time, validated findings and acknowledgment/recheck states. Missing reports parse normally in legacy jobs. Keep review metadata separate from media revision so scanning/ignoring alone does not invalidate exports.
- Extend progress contracts for review/partial operations without introducing mandatory missing stages in legacy payloads. Existing initialStages, schema/parser, labels, progress validation and fixtures must remain consistent. Partial success messages identify the processed range and never assert full-media coverage.

## 2. Target Resolution
- Use one main-side pure resolver for planning and execution, tested separately.
- Recognition range uses half-open overlap: `cue.startMs < range.endMs && cue.endMs > range.startMs`. Repeatedly expand to the full bounds of intersecting cues until stable; merge overlapping/touching intervals, never bridge positive gaps just because IDs were jointly selected.
- Selection begins with each selected cue interval, then applies the same whole-cue overlap expansion. Any additional intersecting cues are visible in effective scope before execution; unselected nonintersecting passages remain untouched.
- Time-range translation selects existing intersecting cues without changing their timestamps. Cue-selection translation keeps exactly the selected cue IDs, including nonadjacent IDs; does not translate neighboring context cues.
- Missing IDs, stale revisions or invalid intervals reject before expensive work. Gap recognition is valid; no-cue translation explains its empty target instead of invoking AI.

## 3. Recognition and Atomic Publication
- Extract reusable local/cloud recognition mechanics from the existing full-video path, preserving no-history `-mc 0`, actual GPU verification/fallback, configured language, upload limits, provider validation and cancellation.
- Crop source audio for each effective interval, use operation-owned temporary filenames and enforce source-identity checks. Normalization uses clip-local duration and measured extraction/audio offset, then adds absolute video offset once. Include delayed/negative-offset media and later chunks in real-media tests; do not guess offsets from renderer time labels.
- Assign fresh operation-scoped cue UUIDs so unaffected cue IDs/emphasis cannot collide. Validate combined final timeline and maximum cue count before commit.
- Draft all selected ranges and any requested translations in memory/operation-owned artifacts. Share a translation batching helper with existing services, passing neighbouring context read-only. Do not call the existing persist-each-batch whole-job translation loop for an atomic combined operation.
- One busy controller owns recognition and optional translation. Progress can change phase while cancellation always targets the same operation. Translation-disabled jobs reject translation-only and translation-requested partial inputs before any provider call.
- Immediately before publication, recheck cancellation, revision, source identity and effective plan. Replace only affected IDs, insert new cues chronologically, clear only replaced cue emphasis, retain global style/historical outputs and invalidate dependent previews/export once. Commit a revised Job atomically.
- Failure/cancellation before commit preserves prior subtitles/style. Successful silence may remove target cues, but must be represented and communicated distinctly from a failure. No provider result is automatically treated as acoustically correct.
- Existing full recognition cache and explicit confirmed full rerun retain their semantics; project-level translation gating applies to the orchestration of every generation/rerun path. Do not reset untouched recognition/translation validity through partial success.

## 4. Optional Translation End to End
- Both local and URL import present the same compact original-only versus translation choice; target-language settings appear for translation mode. Project settings can change the mode later without erasing text.
- Primary action labels and readiness checks follow the chosen mode. Original-only generation needs only recognition readiness; manually supplied source subtitles need neither ASR nor a translation profile to edit/export. Translation mode uses the chosen text service.
- Hide/disable automatic translation, full/partial retranslation and simultaneous-translation controls when the project is original-only. Main guards mirror UI gating, including older call sites and retry paths.
- Make display-content selection explicit across windowed captions, native fullscreen tracks, subtitle list, ASS/SRT/VTT compilation and video burn-in. Original-only means source text even when previous translatedText is stored. Translation mode keeps translated-or-source fallback and optional bilingual behavior.
- Reuse one content-selection rule where possible; maintain backward-compatible helper defaults for callers, but always pass the persisted mode from Job-owned paths. Toggle updates tracks/live preview and invalidates render/export without calling providers or deleting stored translations.

## 5. AI Text Review and Report Lifecycles
- Review is an explicit user action using an independent optional text profile, reusing existing OpenAI/Anthropic/Gemini `generateText` support. Source text/timing are enough; include active translated content only when present and relevant. Never send source audio through review.
- Supply cue IDs, timing, source/active translation and bounded neighbouring context. Batch by cue count and character budget so long projects do not produce an unbounded prompt; all reviewed cues must have explicit completed coverage.
- Strictly parse model JSON into a closed category set (timing/source/translation), cue references and short reasons. Validate every returned cue ID against the batch; reject unknown/duplicate/malformed findings and excessive output. AI cannot author replacement timestamps or patches.
- Report absence of findings as "未发现可疑项", not a guarantee of correctness. Failed/cancelled scans retain any previous report with honest stale/incomplete status; do not publish a partial scan as a complete all-clear.
- Content snapshots/fingerprints and provider/config version prevent stale application. Manual source/timing/translation edits and partial replacements mark related findings pending recheck; unaffected findings can remain usable when their snapshots still match. Material review provider changes stale the report. Whole replacement resets applicability to old IDs.
- Ignoring/acknowledging is a guarded metadata update. Re-recognition success does not automatically verify the new text; allow explicit targeted recheck or a later full review. Review metadata alone does not increment media revision or invalidate rendered output.
- Review shares the single-operation busy/cancel policy. Do not add background scans or recurring external jobs.

## 6. Editor and Interaction Layout
- Bound the root to available viewport height. Compact header/status strip; center column has persistent preview/action bar above a flexed proofreading region. Right settings use an independent scroll region and collapsible sections where useful. Banners must fit without covering the player/actions.
- Player uses contain geometry and adaptive height rather than making every preview consume a full-width 16:9 height. At minimum size keep a usable preview and proofreading/form region simultaneously; tall inline forms scroll locally. Preserve preview-local and list-local inline editor context without introducing an edit modal.
- Toolbar order: current position, re-recognize passage, retranslate passage, add on-screen subtitle. Translation action unavailable in original-only mode. Keep buttons readable through responsive wrapping rather than clipped text.
- A compact inline operation panel supports selection/time modes, effective-range summary and optional translation (only for translation-enabled jobs). No extra confirmation per cue; the displayed plan and explicit execute button are the replacement acknowledgment.
- Proofreading toolbar: AI check action, All/Pending counts, selected-count/batch actions, follow-playback control. Issue rows show category/reason plus locate/play, re-recognize, available retranslate, edit and ignore. Repair preselects the issue target and exposes effective expansion inline.
- Collapse sidebar to an icon rail with accessible labels/tooltips, active-project indicator, scrollable project icons and persistent expand control. Store the UI preference locally, outside Job content.
- Use shared SVG components for navigation and branding. Preserve focus rings, reduced motion, scrollbar gutters and real native player controls.

## 6a. Contextual Risk Refinement (2026-10-11)
- One shared versioned rubric maps closed rule IDs to category and severity, with explicit examples/counterexamples. AI returns an assessment for every target cue and zero or more grounded issues using those rule IDs. Main derives each finding/category/severity and each cue's maximum level; an empty issue list explicitly means none. Do not default a missing model cue to none.
- Preserve findings/acknowledgments for existing repair interactions; add optional graded assessments/rubric/context metadata for legacy storage compatibility. Legacy reports stay ungraded until a fresh complete review.
- Context comes from stable chronological review windows, not the selected-ID array. Partition the full timeline into bounded contiguous batches, append bounded neighbouring cues and grade only the selected targets within relevant windows. The same target receives the same window in a full scan and targeted scan of the same snapshot; never concatenate distant selected cues as adjacent dialogue.
- Persist context groups/fingerprints efficiently per batch and tie each assessment to its context group. Any supplied-context change invalidates every dependent assessment/finding, including none-level assessments. Partial replacement does not assign old levels to fresh cue IDs. Rubric/provider changes stale all affected grades; failed scans keep the previous complete report.
- Renderer uses compact badges and one suspicion-level selector with current counts; distinguish unreviewed, legacy-ungraded and recheck states. Existing time order and seek/edit/follow/repair behavior remain. Do not add a second large toolbar row that steals the minimum-window proofreading area.
- Fixed rules and stable inputs improve consistency; they do not guarantee identical LLM judgment or prove what was spoken. No new audio analysis, hidden summary passes, automatic patches or provider-specific randomness parameters are introduced.

## 7. Native Identity and Packaging
- Maintain one source vector mark plus generated PNG and multi-resolution ICO resources. Renderer and native assets must reflect the same mark.
- Wire BrowserWindow icon in development and packaged resource paths, builder executable/NSIS icons and packaging resources. Verify executable resources rather than assuming config alone changes the icon; current `signAndEditExecutable: false` may prevent icon stamping and must be assessed during implementation.
- Remove the default application menu and prevent Alt restoration while keeping native window controls. Verify standard copy/paste/select-all shortcuts and ordinary playback.
- Build/smoke-test in a separate task output folder if existing portable output is in use. Do not close the user's running app or overwrite its files.

## Risks and Rollback
- Partial normalization, overlapping cues and delayed audio require actual media tests; malformed/timing-invalid results fail before publication.
- Long review requests must be bounded; external findings are suspicions and may contain false positives.
- Legacy defaults must preserve old translated jobs; new UI imports must always persist an explicit mode.
- No SQL schema migration is expected because Job options/report live in JSON, but schema defaults and store read/write compatibility need tests.
- Revert by task-owned code/resource changes only. Preserve source videos, databases, historical exports, previous valid reports and unrelated working-tree edits.
