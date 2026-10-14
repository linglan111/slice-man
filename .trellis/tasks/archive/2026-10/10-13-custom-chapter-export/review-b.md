# Independent B review of D

Date: 2026-10-14. Read criteria repository, chapter/export schemas, renderer panel/criteria/results, IPC wiring, selected export service, media range path and existing real export tests.

## Findings repaired
1. Output identity was calculated only after final file publication. A crash between publication and SQLite checkpoint could leave a valid clip untracked and create a duplicate on retry. Hash the owned staging file first and persist reserved destination/hash while the clip is running. Retry now recognizes matching completed payloads even when the final clip state checkpoint was interrupted. It never replaces an existing file. Stream hashing checks cancellation between chunks.
2. Range export assumed every source audio stream continued until source video end. A real 4-second video with only 1 second of audio failed output validation for an otherwise valid silent tail. Determine audio overlap from actual source stream start/duration; Matroska DURATION is an end timestamp, unlike MP4 stream.duration. Retain output audio validation against the correct overlap rather than dropping the check.

## Evidence
- `npm test -- tests/integration/backend/chapter-export.test.ts`:9 passed after final changes. Includes genuine FFmpeg encode/probe for MP4/MKV delayed audio, ended-audio tails, exact subtitle clip/rebase, ASR/source preservation, safe existing/duplicate names, rollback/cancel/resume, interrupted publication checkpoint and criteria persistence/reopen.
- Targeted ESLint of export service/media/new tests passed. Global typecheck passed after initial fixes; parent runs final integrated checks.
- No native Electron run or live/paid/provider operation during this review. No commits or installer mutations.

## Native regression follow-up requested by root
Updated only `tests/e2e/desktop.spec.ts` and `tests/e2e/download.spec.ts` to match retained-download UI labels and explicitly clear owned verified caches before slow/corrupt network fault tests. Existing installed pointer byte-equality assertions remain, with additional equality checks immediately after cache clear. No helper/root chapter test edits. Targeted ESLint passed; native execution intentionally left to root because its full suite was in progress.
