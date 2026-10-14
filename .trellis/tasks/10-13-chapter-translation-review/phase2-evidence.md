# Phase 2 implementation and focused verification

Date: 2026-10-14. Parent approved the complete plan. Streaming foundation passed before workflow integration verification.

## Implemented interfaces
- `JobService(..., diagnostics?: ProviderDiagnosticsRepository)` optional final injection preserves old fixtures.
- `planChapters(input, trustedCriterion?)`, `updateChapters(input)` use source-bound, revisioned normal/custom plans. Explicit custom generation requires main-resolved criterion snapshot.
- `runChapterExport<T>(jobId, revision, executor(snapshot, signal, assertFresh))` shares the existing sole controller, validates actual source identity, and gives D a pre-publication freshness callback.
- `assertIdle()` guards log clearing; `waitForIdle()` lets shutdown wait for operation finalization before SQLite closes.

## Workflows
- Automatic <=20min translation uses deterministic free coverage. Long translation creates/reuses content chapters, hard-cap20min, default2 workers/configurable1-3, bounded150-target/96KiB pieces, deduplicated context and chapter title/summary. One coordinator publishes completed chapters in chronological order and retains them on later failure. Selected/partial/combined/repair translation remains all-target atomic.
- Strict duration>30min chapter checking partitions selected targets by cue-start ownership, builds each request from original global canonical windows/ordinals, saves only complete chapters, and persists remaining/failed coverage. Compatible cancelled/failed/interrupted runs resume unfinished chapters. Duplicate/missing IDs never produce none grades. Short checking remains one logical request plus at most one corrective generation.
- Names retains one full global timeline. Names/review/plans/style/translation wire diagnostics include run/job/chapter/count and visible receive progress. Invalid operation JSON is logged as validation failure. Validated request publication and Job save use one SQLite transaction, so log-storage failure rolls back content too.
- Material provider/source/settings staleness and credential replacement invalidate partial-run resumability without erasing completed subtitle content. Restart interrupts active run states without provider calls.

## Files
`src/shared/chapter-contracts.ts`, chapter fields in `src/shared/contracts.ts`, `src/main/services/jobs/lib/{chapters,chapter-work,job-service}.ts`, `src/main/db/store.ts`; new `tests/unit/backend/{chapters,chapter-workflows}.test.ts`, `tests/integration/backend/chapter-diagnostics.test.ts`. Existing pipeline/reprocessing tests updated only where old30-cue batching was superseded; existing Store migration assertion now follows bundled MIGRATIONS.length.

## Checks
- `npx vitest run tests/unit/backend/chapters.test.ts tests/unit/backend/chapter-workflows.test.ts`:23 tests passed.
- Six-file focused run (chapters5 + chapter-workflows18 + actualstream/SQLite chapter-diagnostics6 + reprocessing50 + pipeline22 + store15):115 passed, one historical user_version=1 assertion failed after additive migration3. Corrected assertion to MIGRATIONS.length; Store15 recheck passed. All116 unique cases now verified. Prior pipeline batching and reprocessing batching fixture assertions were explicitly updated to chapters and dense pieces while preserving retention/atomicity expectations; both suites passed.
- Targeted ESLint for all owned product/test files passed. Global typecheck passed after core integration; parent owns final cross-agent typecheck.
- Actual local SSE and real SQLite tests prove diagnostics publication, strict JSON failure logging, storage rollback, restart coverage, global names, style, and translation traces. Existing integration suites use actual bundled FFmpeg. No paid model calls, external publication, installed-user-DB changes, git commit or packaging by this child.

## Review/follow-up ownership
B files released to D for independent cross-review. Parent handles typed IPC/preload/App integration, partial-run visible coverage, full suite/native Electron regression, final docs/specs/commit/package. B cross-reviews D criteria/export/UI after release.
