# Complete Electron E2E Regression

Status: complete. Final available Electron suite passed after product repairs and affected-test verification; three explicitly gated external tests were skipped.

## Execution and Isolation

- Ran `npm run test:e2e` with the repository's one-worker runner (28 tests collected). All application launches use absolute isolated test user-data paths and generated anonymous media/public JFK speech; no personal application database/media or running installed application was touched.
- Initial run was intentionally interrupted after the independent reviewer found a real preview-height defect. Completed results before interruption: six passes, one stale-test failure and one gated real-download skip. The complete initial progress log is `evidence/full-e2e-initial.log`.
- Real paid DeepSeek and network download gates remain unchanged. No credentials were obtained or gates overridden.

## Findings and Retained Reproduction

1. **Stale interrupted-translation test:** `desktop.spec.ts` expected the generic retry button despite existing cues. The same button condition exists in Git HEAD; adjacent existing cancellation/failure tests explicitly require it absent and use `翻译全部字幕`. Corrected the restart test to assert absence then use that action, preserving checks for interrupted state, unchanged recognition count, corrected cues and missing-source handling. Initial trace/error context retained in `evidence/initial-failures/`.
2. **Confirmed product clipping defect:** independent review identified a normal-video minimum mismatch. The strengthened real-Electron pane test reproduces expanded lower-settings divider `Home` at 1440x960: fullscreen help bottom 510.98px exceeds preview bottom 493.59px. Button-only/viewport-only assertions missed this because buttons still fit. Failure screenshot, trace and context retained in `evidence/pre-fix-pane-results/`; log in `evidence/pre-fix-pane.log`.
3. Added regression coverage for preview controls inside their actual clipping parent and pointer hit-testing, fullscreen/error text containment, dynamic playback error/reload after `Home`, and preservation/restoration of long source/translation drafts when switching between preview editing and partial repair.
4. **Synthetic cancellation fixture race:** the first complete run's 30s static-color H264 input completed native H265 conversion before the test observed nonzero temporary output; eleven published download directories were already present. Replaced only the generated input with moving `testsrc2` at identical resolution/duration. Existing real partial-file, cancel, cleanup, no-new-job and sentinel-byte checks remain unchanged. Corrected matrix passed in 34.3s.
5. **Native scrub geometry assumption:** clicking 15% of the narrower video element can land before the edited cue's 0.5s start because the native timeline has insets. Changed the native click to 25%, asserted the settled time belongs to [0.5, 1.5), retained exact caption assertions and recorded actual positions. Affected run recorded forward 2.893328s/backward 0.919118s; playback/fullscreen test passed in 4.4s.
6. Strengthened exact `Slice Man` document/native-window/header branding checks before import, after import and after process restart. Native minimum welcome verifies sidebar default 184px, real pointer adjustment and header reset. Expanded pane regression passed in 10.2s.

The first complete run was 23 passed/2 test failures/3 gated skips in 211.383s; it is retained as `evidence/full-e2e-first-complete.log` and `.json`. The four affected tests passed in 50.8s (`evidence/affected-rerun.log`). No renderer/main changes were made for findings 4/5; they repair stimuli and target assumptions without relaxing behavior assertions.

## Coverage and Evidence

| Area | Exercised behavior / retained evidence |
| --- | --- |
| Real desktop and persistence | All text protocols over deterministic loopback HTTP; real IPC, corrections, profile credential presence, style, restart, interrupted work, missing original, failure/retry/cancel. |
| Native recognition | Real CPU archive/model install, hash verification, genuine Whisper inference and update rollback. GPU and explicit CPU jobs independently verify `actualBackend` and `recognition-backend.json`; `gpu-desktop-result.json`. |
| Subtitle CRUD and repairs | List/preview create/edit/delete, timestamps, overlap/gap targeting, draft cancellation/revision protection, follow/manual browse, selected/time-range partial recognition/translation and reset safeguards. |
| Context review | Four grades, batch/context windows, selected recheck, ignore/filter, neighbour invalidation, stale/legacy distinctions, source-only mode with no translation calls; contextual JSON/screenshots. |
| Actual playback | Native controls, frame clock, bilingual/edit updates, browser fullscreen captions, long unbuffered range seeks and decoded-frame checks; `native-scrub-positions.json`, `live-captions-desktop-result.json`, `seek-desktop-result.json`. |
| Real export | SRT/ASS/VTT current corrected cues; FFmpeg/libass burned glyphs and reference parity; MP4/MKV with original/H264/H265/AV1/VP8/VP9 codecs, every configured resolution/quality, no enlargement, source/destination preservation, native-dialog/encode cancellation. `export-settings-matrix.json`, `export-original-web-codecs.json`, source-only exported artifacts. |
| Downloads | Pinned actual yt-dlp/Deno archives served from loopback, installation verification/rollback/cancel; anonymous HTTP download/probe/import/decoded playback; directory validation including real NTFS denial, format/codec/resolution/downscale/no-enlargement, actual conversion cancellation and restart settings. Real public-site extraction is separately gated. |
| Resizing/layout | Native 1050x700, 1440x960, 1920x1080; sidebar/settings expanded/collapsed; portrait/landscape, long titles/cues/forms, notices/errors/review/selection; separate list/form/settings scrolling, pointer/keyboard/extreme/cancel/restart/reset dimensions, preview content hit-testing and dynamically inserted reload controls. |
| Process/window | Real second-process primary activation preserves active work and isolated app data can run separately; exact `Slice Man` native/document title and header across import/restart. |

## Explicit External Gates

- Two DeepSeek live tests skip with `Explicit live gate and session-only user key are required.` Neither `APP_LIVE_DEEPSEEK=1` nor an authorized session key was supplied. Loopback text-provider compatibility does not demonstrate live-provider linguistic quality.
- One YouTube/Bilibili live-download test skips with `Explicitly gated live user-supplied video downloads`. `APP_REAL_DOWNLOAD_E2E=1` was not enabled. Loopback anonymous downloads do not validate current public-site extraction.
- Actual GPU inference is available and passed on NVIDIA GeForce RTX 5070, driver 610.74; it is not a hardware skip. Per-inference CUDA proof and a separate explicit CPU receipt were validated against pinned Base/Whisper 1.8.3 assets.

## Final Result

- The definitive `npm run test:e2e` log includes successful main, preload and renderer builds, then **28 tests using one worker: 25 passed / 0 failed / 3 expected skips**, in **181.68573 seconds** (3.0 minutes). The JSON start time is `2026-10-11T03:26:56.274Z` (11:26:56.274 Asia/Hong_Kong).
- `evidence/full-e2e-final.json` reports `expected: 25`, `skipped: 3`, `unexpected: 0`, `flaky: 0` and no top-level errors. All 28 tests have exactly one result with `retry: 0`; the runner also configured zero retries. Every passed result has an empty error list. The retained log ends with `3 skipped` and `25 passed (3.0m)`.
- The final full run includes the corrected download cancellation matrix (31.348s), actual live-caption/native-scrub regression (4.032s), and pane-resizing/branding regression (10.020s). These are full-suite results, not inferred from the earlier affected rerun.
- Actual GPU receipt in `evidence/gpu-desktop-result.json` confirms CUDA0 execution on RTX 5070 with `gpuExecutionVerified: true`; separate explicit CPU inference reports `backend: cpu` and `gpuExecutionVerified: false`. Final observed wall times were 1475ms and 1413ms respectively. These timings describe these individual test invocations, not a general benchmark.
- Independently inspected final screenshots `resize-default-workspace-brand.png`, `resize-1050x700-translated-inline.png` and `resize-1050x700-secondary-home-playback-error.png`. They show the exact visible `Slice Man` brand, right-side proofreading, left-side collapsible settings, usable native controls and preview actions, reachable inline save/cancel, and contained late error/reload controls at the minimum allocation. No visual defect was found. The default/inline captures include a transient video loading indicator; actual playback/decoded frames are verified by their separate passing tests, not inferred from these still images. Native titles are verified by Electron assertions rather than renderer screenshots.
- Lint/typecheck/unit results remain attributed to the independent reviewer: its recorded final checks are lint pass, typecheck pass and **49 files / 446 unit/integration tests passed**. No unchanged checks or native runners were repeated during this evidence audit.

## Acceptance Evidence Map

| Criterion | Final evidence and scope |
| --- | --- |
| AC1 | Both portrait and landscape `subtitle-workspace` layout tests passed at all three native sizes and both sidebar/settings states, including banners, grade summaries, selected actions, bounded cue geometry and no document overflow. |
| AC2 | `subtitle-workspace` tests verify independent cue/settings scrolling, stable right-panel geometry and disclosure persistence across restart. Native button semantics and keyboard disclosure are also covered by the recorded unit review. |
| AC3 | Layout and pane tests pass with long text, preview/list editors and range forms, local scrolling/action reachability, computed video minima, and exact draft restoration after repair temporarily hides editing. |
| AC4 | The final suite passes real IPC CRUD/review/repair, modes, styles, imports, profile/runtime operations, cancellation/retry, playback/fullscreen/seeking, real media/text exports and restart. Text-provider responses use deterministic loopback fixtures; live paid-provider quality and live public-site extraction remain unverified under the stated gates. |
| AC5 | Final native suite/build pass plus the independent recorded lint/typecheck and 49-file/446-test checks; coordinated review findings F1/F2/F3 and late playback-error observation are resolved. Three expected external skips remain explicit above. |
| AC6 | Pane regression passes actual pointer/keyboard adjustments, extreme limits, cancellation, native resize, restart and reset. All four dividers are exercised, including translated long inline/repair states; preview clip/hit-target assertions and usable inner list/form/video bounds are retained. |
| AC7 | Pane regression asserts native/document titles before import and asserts native/document/header branding after import and restart; the visible header is checked before import at default width. All are exactly `Slice Man`. The final default-width screenshot confirms the visible label. |

The available regression gate is clear. The three external skips remain a boundary on coverage; no live paid credentials, supplied public URLs, packaged installation or another-machine environment is claimed by this desktop E2E run.
