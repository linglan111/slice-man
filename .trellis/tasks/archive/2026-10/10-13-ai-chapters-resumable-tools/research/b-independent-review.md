# Independent B workflow and integration review — 2026-10-14

Reviewer previously implemented D and was reassigned by the parent to review the separate B workflow. B confirmed its files were released before these changes. This is not an independent review of D.

## Findings fixed

1. **Completed concurrent translation could be lost (high).** Full translation used an ordered coordinator that held a later chapter's fully validated output in memory until every earlier chapter completed. A slow earlier chapter failing or being cancelled discarded the fast completed later chapter, causing an unnecessary paid repeat on retry. Added an explicit ready-publication mode for incremental whole translation only. Each callback still commits synchronously with the latest revision, and canonical cue order remains unchanged. Scoped/combined/repair drafting retains its all-target atomic publication and ordered collection. Progress counts completed chapters rather than the source index.
   - Regression: slow first chapter fails after the second completes; second chapter remains translated.
   - Regression: cancellation after second chapter is saved; second remains, while work completed after cancellation cannot publish.
2. **Partial-check coverage text was misleading (medium).** The right card only counted chapters, used the same continuation message for stale records, and did not state cue coverage. Extracted `ChapterReviewStatus` with completed/pending/failed cue counts and chapter counts. Stale records explicitly describe old coverage and require a fresh check; compatible failed/cancelled/interrupted runs resume their stored full target IDs, independent of current selection.
   - Two component tests cover exact coverage and stored-scope resume plus stale-state honesty.

## Audited without additional findings
- Long review processes chapters sequentially, publishes only complete validated chapters and merges drafts under the original full timeline. It therefore has no equivalent out-of-order retention issue.
- Dense review pieces use original canonical groups/ordinals and strictly validate complete target coverage. Chapter failure leaves uncompleted targets pending/failed rather than synthesizing none.
- Review compatibility checks plan/source/translation/provider/rubric/scope; content changes stale runs and credential replacement stales unfinished runs.
- Source-only translation rejection, bounded chapter requests, profile busy guards and typed main/preload validation remain intact.
- Chapter review failures propagate into repair prerequisites; the loop cannot use an assumed all-clear after incomplete analysis.

## Evidence and follow-up
Initial focused workflow/stream-SQLite/UI suite passed 28 tests in 3 files after these fixes. Scoped ESLint passed. Expanded B regression passed 98 tests across 6 files: chapters, chapter workflows, actual streamed chapter diagnostics/SQLite, reprocessing, store and chapter-review UI. Final TypeScript verification passed after the coverage component integration. Native UI/e2e belongs to the parent and is not claimed here.

Separate parent-requested native layout follow-up: the minimum-window ChapterPanel footer was below the operation-card viewport. Its body now uses bounded flex allocation and local chapter-list scrolling, reserving the footer. Parent must rerun native three-size checks; a CSS change alone is not evidence of fit.
