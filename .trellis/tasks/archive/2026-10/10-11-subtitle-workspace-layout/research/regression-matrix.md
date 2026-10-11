# Regression Coverage and Evidence Plan

## Layout Acceptance

Native BrowserWindow sizes: 1050x700 minimum, 1440x960 default, 1920x1080 larger screen. Measure renderer dimensions after native chrome rather than assuming requested outer size equals CSS viewport. Exercise both navigation states and both secondary-settings disclosure states.

Verify preview left/proofreading right, toolbar and add/review/filter/follow/selected actions inside viewport, no horizontal/document overflow, usable video and cue-list inner dimensions, independent cue scrolling, secondary expansion without moving the right panel, keyboard disclosure and restart preference. Include portrait video, long names/cues, error/success/processing banners, review grades/findings, preview/list drafts and scoped repair forms. Save representative screenshots and inspect them visually; geometry assertions remain mandatory.

User-added resize scope: expanded-navigation width, column width allocation, preview/expanded-secondary height allocation and preview/inline-form height allocation. Verify actual pointer geometry change, keyboard separators, storage/restart, reset, extreme-limit clamping and resizing native windows after customization. Divider dragging must not activate cue editing/video controls or alter media data.

Independent review adds clipping-ancestor and hit-testing assertions for every preview action at secondary Home/End, preview draft -> repair -> close -> exact draft restoration, late playback error/reload insertion after a minimum preview allocation, and fresh empty-window navigation resizing/reset. Capture native failures before fixes where possible; retain exact regression assertions afterward.

## Full Existing Electron Suite

| Suite | Behaviors |
| --- | --- |
| desktop | provider protocols, recognition/translation, corrections, style, exports/restart, failures/retry/cancel, real CPU install/inference |
| subtitle-workspace | source-only workflow, scoped repairs/review, layouts, import modes |
| inline-subtitles | preview/list CRUD, timeline/follow/overlap/gap/seek/manual browse, drafts and busy safeguards |
| contextual-review | context grades, filters/selection, repair, stale/legacy states |
| live-captions and seeking | actual playback clock, bilingual/paused edit/native fullscreen, long unbuffered seeking and decoded frames |
| recognition-reset | dismissal/failure/cancel preserves corrections; successful full replacement |
| export-settings and export-original-web-codecs | defaults/overrides, text CRUD exports, video format/codec/resolution/quality matrices, libass pixels, source/destination preservation and cancellation |
| download and download-settings | native tool install/rollback, imports/playback, formats/resolutions, directory validation/persistence |
| single-instance | second-process activation without interrupting work |
| gpu-native | actual backend receipts, optional NVIDIA hardware and pinned CUDA fixtures |
| deepseek-live | explicit live gate and session credentials; distinguish skips from provider validation |
| download-real | explicit real-download gate and supplied URLs; otherwise skip honestly |

## Environment and Reporting

Node 24.17.0 and npm 11.13.0 match the pinned toolchain. Existing runtime cache contains CPU/CUDA archives, Base/Tiny models and JFK speech; media resources include FFmpeg/FFprobe and managed CJK fonts. Presence alone is not proof of successful CUDA inference; use test receipts.

Read-only hardware inventory: nvidia-smi reports NVIDIA GeForce RTX 5070, driver 610.74. Actual inference still needs the gpu-native suite and per-invocation receipts.

Run the full Electron suite from one process to avoid build/native-state/output conflicts. Do not overwrite live-provider/download gates or use personal application data. Report total passed/failed/skipped and skip reasons, unit/integration counts, lint/typecheck/build results and independent review findings. Retain current-task evidence; do not claim loopback responses validate live translation quality.
