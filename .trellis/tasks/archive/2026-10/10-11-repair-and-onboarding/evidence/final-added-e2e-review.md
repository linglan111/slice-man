# Independent complete native regression review — R1–R11

Review date: 2026-10-12, Windows Electron application, development branch `codex/subtitle-repair-onboarding`. No commit, release, publication, personal-project database mutation, paid AI call, or native SQLite ABI switch.

## Scope and fixtures

Reviewed parent/child approved PRDs/design/implementation contracts and current paths. Native tests use the built `out/main/index.js` with real preload/IPC, isolated user-data directories, generated anonymous media, loopback HTTP models and genuine native media/runtime tools. The new 1027-cue fixture contains anonymous generated dialogue, not user video subtitles.

Added dedicated `person-names.spec.ts` cases for explicit review-service selection, grounded recurring counts, editable recommended values, cancel/no-op, simultaneous original/translated apply, Ann/Anna boundary preservation, unchanged IDs/times/global style, translation staleness, corrected SRT, later unrelated and same-field manual edits, restart-persisted conflict-preserving undo and record consumption. Source-only verifies stored translation never enters the prompt or changes, zero ASR/translation calls, and cancellation of an actual held HTTP request retains the previous name report. Analyzed apply/cancel actions are hit-tested at native 1440×960 and 1050×700 without scrolling.

Extended `review-one-shot.spec.ts` to cover actionable missing-service setup, unchecked/pending counts, one complete evidence correction, two-attempt failure retaining the previous valid report and real HTTP cancellation without content retry. The 31/65 selected sets use actual public IPC; the final 1027 full scan uses the real UI handler, asserting exactly one successful HTTP generation and complete coverage. Strict canonical group evidence remains exercised by contextual/native and backend tests.

## Findings and retained-test repairs

- New generation panel exposed a generic retry button even when its handler returned immediately for existing cues. Reported to the sole App owner; root chose and implemented the original safe policy: existing cues use explicit translate, confirmed recognize-again and export actions. Added renderer regressions cover failed/cancelled/interrupted translation with existing cues and a functional empty-timeline retry. Final native failure/retry/cancellation and recognition-reset paths pass on the rebuilt owner fix.
- Retained style/media tests needed explicit navigation between relocated settings dialogs, style operations and media/editor controls. Tests now close real dialogs through their public return action rather than force clicking behind them.
- Retained export cases waited for the old absent modal, then probed files before encoding finished. They now wait for actual export-form closure, inspect form-local errors and choose independent subtitle files in the unified panel. File hashes, codec/resolution/pixel assertions, cancellation and overwrite/source protection remain required.
- The single operation panel temporarily hides a retained preview draft. The busy-edit regression closes the generation panel to expose the same disabled draft, then verifies cancellation preserves its text.
- Pane drag fixture started at the new secondary minimum and attempted to drag farther below it. Native diagnostic showed value588/min588/max811 at 1440; the test chooses an inward reachable direction, asserts a nonzero adjustable range and retains extreme clamping, keyboard, reset/restart and geometry checks. Hidden preview editor geometry is excluded while the active operation is measured.
- Lower settings area now contains compact entry controls, so it need not overflow. Native independent-scroll checks test scrolling only when content actually overflows, otherwise require scrollTop0 and unchanged preview geometry.

No product evidence validator, source-only safeguard, publication guard, media-control clearance or geometry assertion was relaxed to accommodate the layout.

## Verification status

| Gate | Final result | Raw evidence |
| --- | --- | --- |
| Global lint | Pass, exit0 | [final-added-lint.log](final-added-lint.log) |
| Global TypeScript | Pass, exit0 | [final-added-typecheck.log](final-added-typecheck.log) |
| Complete unit/integration, captured by root on identical final product source | **60 files / 574 passed**, exit0 | [final-unit.log](final-unit.log) |
| Fresh production build after owner retry fix | Pass, exit0; existing Zod PURE-annotation warnings only | [final-added-build.log](final-added-build.log) |
| Complete native suite, one worker, final fresh bundle | **40 total: 37 passed / 3 explicit gates skipped / 0 failed**, exit0, 4.0 minutes | [final-added-full-native.log](final-added-full-native.log) |
| Affected relocated-operation/media/export/pane fixtures | 16/17 passed, followed by the remaining style case passing after scoping its error to the form; all17 subsequently pass in the final complete suite | [final-added-affected-native.log](final-added-affected-native.log), [final-added-style-native.log](final-added-style-native.log) |

Focused names2/review2 passed before the final full run. These and affected reruns overlap the40-case complete suite and are not added as separate unique-test totals. Initial complete-run/diagnostic failures in `final-added-full-native-initial.log` and `final-added-resize-native.log` are superseded by the final complete run above; they are retained to show actual findings and repair history.

The final complete suite includes actual CPU installation/inference, actual CUDA inference and explicit CPU selection, import choices, download/format settings and rollback, real decoded seeks/native controls/fullscreen, inline CRUD/overlap/follow/retained busy drafts, contextual grades/invalidation, review aggregate/correction/cancellation, names apply/undo/restart/source-only, recognition reset, single instance, first-run/replay/keyboard, fixed-range repair convergence/fresh IDs/caps/cancel, pointer/keyboard pane clamping/persistence/reset, portrait/landscape and1440×960/1050×700/1920×1080 geometry. Every toolbar panel has native input and primary/cancel hit tests without scrolling at default/minimum size. Actual FFmpeg exports validate independent subtitles, MP4/MKV, original/H264/H265, AV1/VP9/VP8, resolutions/qualities, no upscaling, decoded subtitle pixels, source/destination protection, cancelled-file cleanup and retained content.

Actual runtime evidence is NVIDIA GeForce RTX5070 / Whisper1.8.3 Base, separately verified CUDA0 and explicit CPU receipts. See [final-native-gpu-receipt.json](final-native-gpu-receipt.json). Cloud speech/translation/review/names/style responses use isolated loopback fixtures; no claim about live AI linguistic accuracy or provider performance follows from these tests. The release workflow was not changed.

## Final visual inspection

Viewed the final default/minimum names mapping and restart-conflict screenshots, completed1027-cue review, minimum guide, minimum range repair with inline editing, and minimum export operation. Actions remain bounded and visible, name fields are editable before apply, conflict summary preserves the manual text, review grades render without silently classifying unchecked cues as none, guide footer fits, and native media controls remain inside preview. Some snapshots capture Chromium's transient media loading indicator; decoded playback/seek/control behavior is independently verified by dedicated native cases.

- [Name mappings at minimum window](final-names-minimum.png)
- [Name mappings at default window](final-names-default.png)
- [Restart undo preserves later edits and explains conflict](final-names-restart-undo.png)
- [Complete1027-cue UI review](final-review-1027.png)
- [Review cancellation retains valid prior results](final-review-cancel-preserved.png)
- [Minimum guide](final-guide-minimum.png)
- [Minimum range repair and editor](final-repair-minimum.png)
- [Minimum export operation](operation-1050-导出作品.png)

## Findings not fixed

No unresolved product correctness finding remains in the approved R1–R11 scope after the owner retry fix and final complete native run. The disabled external/paid gates below remain unverified; no credential or live-service activation was inferred. Root owns final task/spec/commit planning; this reviewer made no commit/publication/archive changes.

## External gates

Three explicit gates remain disabled: authorized real YouTube/Bilibili download (`APP_REAL_DOWNLOAD_E2E=1`), and two live DeepSeek paid-key cases (`APP_LIVE_DEEPSEEK=1` plus session-only key). Loopback model tests prove plumbing/state/integrity; they do not establish live linguistic judgment quality or third-party compatibility.
