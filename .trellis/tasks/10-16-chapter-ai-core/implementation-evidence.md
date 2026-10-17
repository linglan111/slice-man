# Core implementation handoff

## Boundary
The behavior gap was hidden intra-chapter subdivisions, duration-gated/serial review, whole-timeline style, and job-local concurrency. Core owns backend chapter/provider orchestration, shared contracts and focused tests. Names, recognition behavior, repair-loop orchestration and renderer are other teammates' responsibilities. Existing unrelated worktree changes were retained; no commit was made.

## Implemented
- API-service textConcurrency is parsed/persisted with legacy default 2 and bounds 1–16. Profile JSON persistence needs no database column migration. Shared transport slots cover every text request, including names and corrections; queued cancellation performs no POST and queued time does not consume network deadlines.
- Complete canonical normal chapters are reused for every applicable operation, including short videos. Normal analysis bootstraps deterministically without recursion; custom analysis batches existing normal chapters and never replaces them.
- Translation/review/style send one full-context request per owning chapter per successful phase, with explicit targets. Removed the old boundedChapterPieces subdivision helper; oversized chapters fail explicitly.
- Chapters run concurrently under service caps. General translation/review retain complete published chapters; selected translation and style publish atomically. Review merges only owned targets into the latest report, filters obsolete IDs, and retains independent out-of-order assessments.
- Style uses earliest nonempty chapter global settings and merges chapter-owned validated emphasis without an extra synthesis call.
- Added chapterContext and rebindChapterPlan pure helpers so repair can reuse run boundaries for ASR drafts with no paid replanning. reviewDraft/draftTranslations accept optional repair workContext to preserve run/phase/round.
- Added validated AiWorkProgress, queued/running/completed/failed/cancelled chapter progress and live run/chapter associations. Live cache/IPC capacity is 128, allowing all configured concurrent calls.

## Files
Product: src/shared/{ai-work-contracts.ts,contracts.ts,ipc-validation.ts,provider-diagnostics-contracts.ts}; src/main/services/providers/lib/{text-concurrency.ts,text-request.ts,text-provider.ts,live-streams.ts}; src/main/services/jobs/lib/{chapter-work.ts,chapters.ts,review-request.ts,job-service.ts}. JobService edits exclude analyzeNames and repairLoop, which are teammate-owned.
Tests: tests/unit/backend/{chapter-workflows,text-concurrency,live-streams,provider-streaming,store}.test.ts; tests/integration/backend/chapter-diagnostics.test.ts. Limited non-repair updates in reprocessing.test.ts replace old intra-chapter split fixture with explicit two-chapter selection and adapt validated-progress cancellation matching; repair teammate owns subsequent edits.

## Validation
- npm run typecheck: passed.
- Scoped ESLint for all listed product/tests plus shared JobService/reprocessing: passed.
- Chapter/review focused set: 64/64 passed (chapter-workflows, chapters, review-request).
- HTTP/provider/diagnostics/storage/limiter/live set: 94/94 passed (provider-streaming, chapter-diagnostics, chapter-workflows, store, text-concurrency, live-streams).
- Earlier full Electron-ABI run: 865 passed / 10 failed. Core failures were corrected and focused suites rerun. Latest reprocessing run had 3 repair-owned failures from changed required fresh-ASR semantics (two expected one transcription but got two; translation-only test expected no recognition readiness). Repair teammate notified and owns these expectations.
- Tests prove complete 302-cue context for sparse targets, no subdivision, capacity-before-call, 3-chapter out-of-order merge, deterministic style aggregation, custom/normal separation, SQLite restart/defaulting, actual local HTTP service-slot sharing with names and pre-POST queue cancellation. Local HTTP is a fixture, not actual paid-provider or acoustic validation.

## Remaining integration
Leader/verification owns integrated build, independent review, complete unit/Electron E2E and authorized paid services. No core product edits are pending. Full suite report `.native-smoke/chapter-ai-20261017/core-intermediate-test-results.json` is a preserved intermediate failure-discovery artifact and must not be treated as final acceptance evidence. Latest small correctness fix retains all validated planning request IDs for atomic publication, rather than only the final chapter request.
