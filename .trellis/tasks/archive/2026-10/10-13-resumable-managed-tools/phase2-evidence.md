# Managed artifact resume implementation review evidence

Date: 2026-10-14. Reviewer: dispatched `trellis-check`.

## Verified behavior

- Whisper CPU/GPU, all three models, yt-dlp and Deno use the shared stable pinned-identity cache outside install staging. Cancel/network interruption preserves the actual prefix and metadata; complete earlier assets remain reusable.
- Parameterized loopback tests cover all seven asset IDs. Resumed requests start at the persisted byte offset and use a legal strong validator when available; weak validators are never sent as If-Range. Encoding remains identity, including Electron/undici's duplicate identity token for ranges.
- Valid 206 ranges, full-200 restart after ignored ranges/entity changes, incomplete 416 reset, short bodies/subranges, wrong range bounds/validators, compressed/overlong bodies and same-size hash corruption are tested. Full cached data is hashed again before reuse. Invalid data never activates.
- A real isolated embedded-Node child downloads 8192 bytes, is force-terminated without a cancellation callback, then a new cache instance resumes at exactly 8192 and produces the pinned complete payload. The user's app and files are not involved.
- Junction and hard-link cache paths are rejected. Explicit clear/acquire races and staging collisions preserve unrelated files. Staging copy handles close on failure; local write failures are reported as storage errors rather than retrying them as network failures.
- Free-space checks reserve remaining durable download plus independent staging copies and extraction headroom. Runtime and tool tests fail before acquisition when that extra space is unavailable, preserving the cached prefix.
- Runtime/download dialogs show retained bytes, offer explicit resume/clear, never start downloads when opened, and preserve ready installed status. A delayed initial status response cannot resurrect cleared cache bytes. Small retained prefixes show accurate KB/B values.
- Existing runtime cancellation regression now explicitly asserts absent install staging and retained durable cache. Existing tool/native-probe rollback and online-video cancellation semantics remain intact.
- Parent native regression exposed a genuine final-status race: `install()` returned an earlier success object before its `finally` emitted updated cache bytes, so IPC could overwrite the newer renderer event. Success now returns the final cache-bearing snapshot; success/failure/cancel retain the operation lease through final cache refresh. A real HTTP/hash/ZIP integration asserts returned snapshot equals the last event, two verified reusable assets on success, zero retransfers on reinstall, an 8192-byte final cancelled event, and old-pointer retention on failed replacement.

## Executed checks

- A/C checkpoint: 10 files / 137 tests passed (overlaps other evidence; do not sum).
- `tests/integration/runtime/resumable-artifacts.test.ts`: all 27 tests passed, including the force-terminated child. The final identity-header assertion refinement was rerun for `resumes model-base`: passed.
- `tests/integration/runtime/resumable-space.test.ts`, existing runtime install/tool tests, and RuntimeDialog/DownloaderDialog regressions passed.
- Global lint and typecheck passed. No native ABI rebuild, installed-app mutation, external CDN, paid provider or live tool install was run by this reviewer. Parent runs the real native CPU/tool probes and final packaged checks.
- Final return/event race regression: `npm test -- tests/integration/runtime/download-cache-status.test.ts tests/unit/backend/download.test.ts tests/unit/frontend/DownloaderDialog.test.tsx`: 3 files, 40 tests passed. Final global lint/typecheck both exited 0 after this product fix.
