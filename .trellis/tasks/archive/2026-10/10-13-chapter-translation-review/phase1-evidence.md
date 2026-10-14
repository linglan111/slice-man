# Phase 1 implementation evidence

Date: 2026-10-13. Parent implementation approved. Default workflow integration remains blocked on the streaming foundation tests, as required by the approved dependency.

## Implemented
- `src/shared/chapter-contracts.ts`: strict optional/versioned chapter plans, normal/custom constraints, trusted criterion snapshot, public planner/edit inputs and incremental review-run metadata.
- `src/shared/contracts.ts`: additive Job `chapterPlan`, `customChapterPlan`, `reviewRun`; optional `chapterProfileId`/`chapterConcurrency` settings. Omission preserves legacy typed fixtures; execution uses concurrency default 2.
- `src/main/services/jobs/lib/chapters.ts`: source/review fingerprints, freshness, anchors, deterministic coverage, grounded response and exact start-time target ownership. Normal plans require full duration coverage; custom plans allow gaps/empty success. A long topic is explicitly subdivided at the hard 20-minute cap. Source cues are unchanged.
- `src/main/db/store.ts`: load/save freshness, restart interruption of review runs and material provider staleness. Existing separate diagnostics work is preserved.

## API coordination
- `planChapters(input: PlanChaptersInput, trustedCriterion?: ChapterCriterionSnapshot): Promise<Job>` planned service method. Public input `{jobId,revision,kind,profileId?,criterionId?}`; main resolves the criterion snapshot `{id,revision,name,instructions}`. Normal rejects criterion data. Explicit custom requires it.
- `updateChapters(input: UpdateChaptersInput): Job` planned service method. Input `{jobId,revision,planId,planRevision,chapters}`. Plan `revision` is separate from content `revision`; entries live in `chapters`.
- Optional final `JobService` constructor diagnostics repository injection approved by parent; no per-fixture repository construction.
- Pure exports: `chapterSourceFingerprint`, `chapterReviewFingerprint`, `refreshChapters`, `validateChapterPlan`, `chapterAnchors`, `coverageChapters`, `newCoveragePlan`, `createChapterRequest`, `groundChapterResponse`, `chapterTargets`.

## Verification
- `npx vitest run tests/unit/backend/chapters.test.ts`: 5 tests passed.
- Targeted eslint for the new chapter contracts/planner/test: passed.
- `npm run typecheck`: no chapter-owned errors; incomplete concurrent tool work currently reports missing `clearDownloadCache` methods and two frontend fixtures missing that API. Parent owns integration resolution.
- No paid calls, native rebuild/Electron launches, git commits, installer changes or task activation by this child.

## Phase 2 remaining
After A foundation passes: service methods, diagnostic contexts for text operations, content-based long-video planning/default chapter translation, bounded work units/concurrency, whole-chapter retention, scoped atomic translation, strict >30-minute incremental review/resume, original canonical evidence and repair prerequisite stop semantics. Parent owns IPC/preload/renderer wiring and integrated checks.
