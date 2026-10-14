# Integrated verification

Date: 2026-10-14. Branch: `codex/ai-chapters-resumable-tools`. Delivery: local source commit and `0.1.5-preview.6` verification installer. Formal package version and release branch remain unchanged.

## Completed source checks

- Global ESLint and TypeScript: passed after the final implementation fixes.
- Final complete unit/integration run: **77 files, 749 tests passed**. Log: `.native-smoke/chapters-all-unit-release.log`.
- Production build: passed. Log: `.native-smoke/chapters-build-final.log`.
- Independent full-scope review: `final-review.md`, no remaining material finding. Cross reviews: `research/b-independent-review.md`, `research/d-independent-review.md`.
- Independent visual review actually inspected 32 screenshots: `research/final-ui-e2e-review.md`. Root subsequently inspected the final 1050×700 chapter screenshot to confirm completed-operation progress is removed.

## New native workflow evidence

The final rebuilt chapter suite's three scenarios passed through real Electron/preload/main, SQLite and bundled FFmpeg:

1. Streamed normal/custom chapter generation; three native window sizes; safe duplicate-title SRT exports without overwriting a sentinel; chapter seek to 2 seconds; UI title/summary save confirmed through public IPC; selected single MP4 export with actual FFprobe showing a 2-second video and audio; criterion add/copy/delete/select; normalized-answer diagnostics and real restart persistence.
2. A lone partial streamed answer becomes visible in both the file and SQLite while the server stays silent. Cancellation preserves the prefix, publishes no name report and triggers no hidden generation replay. Restart retains the same answer.
3. A genuine >30-minute media file uses chapter review. Chapter 2 fails after chapter 1 commits; continuing checks only remaining targets (three total review calls across initial attempt/retry), reusing the existing chapter plan.

## Failures discovered and repaired during integration

- Minimum chapter operation footer exceeded the 1050×700 viewport. Bounded list allocation/local scrolling now reserves the visible footer; native three-size assertions passed.
- Full translation could discard a faster later chapter when a slower earlier chapter failed/cancelled. Incremental full translation now publishes each complete chapter immediately; scoped operations remain atomic.
- Export publication could leave a valid clip untracked on interruption. Checkpoint path/hash before publication and recover matching files on restart. Actual delayed/ended-audio MP4/MKV tails also pass.
- A heartbeat followed by one early delta could leave SQL/progress at zero indefinitely. Independently paced serialized checkpoints now refresh without needing another network chunk; cancellation/close waits for disk finalizers.
- Tool installation returned a pre-finally snapshot that could overwrite its newer cache event. Return the final cache-enriched snapshot while holding the operation lease through the last event. Real HTTP/hash/ZIP service tests cover returned/event identity and retained installs.
- Historical install assertions expected old labels and later checksum wording. Updated them to explicit resume/cache operations and precise early length-integrity errors, preserving old-install byte-equality checks. Initial logs are retained; they are not presented as passing final results.

## Coverage boundaries

Local provider fixtures prove streaming/protocol/validation/recovery and request counts. They do not establish live model quality, actual service latency, token savings or every remote CDN's Range support. Paid/external tests remain opt-in. Selected MP4 and SRT are native end-to-end; MKV/ASS/VTT boundary and offset cases use genuine FFmpeg/SQLite integration. No installed personal database was modified, no paid request was sent, and no push/GitHub release or installation into the user's application directory is part of delivery.

## Final native and package gates

Final rebuilt full Electron run: **41 passed, 3 intentionally gated external/paid cases skipped, 0 failed** (44 cases, 4.5 minutes). Log: `.native-smoke/chapters-final-e2e.log`. This includes both repaired installation flows and the expanded chapter seek/edit/MP4/criteria scenario. Installer `VALIDATION.md`, `package-verification.json` and `SHA256SUMS.txt` identify the exact source commit and packaged build; packaging results are appended after completion.

Source work commit: `e15442b21e4c61902b89078a8f5103d8fac9ef7b`.

Local NSIS build `dist/verification-0.1.5-preview.6-20261014` completed successfully. `npm run test:package -- --app-dir .../win-unpacked` passed actual packaged startup, native SQLite/preload IPC, production flag isolation, fonts/media/notices/native module checks. Additional packaged verification passed version/name, seven production mutation handlers rejecting absent jobs, diagnostics/criteria/export storage handlers, first-run guide and help replay. Isolated packaged user data was used; the installer was not installed into the personal application directory. The output directory contains installer, SHA-256, package JSON reports, final test logs and three-size chapter/diagnostic screenshots.
