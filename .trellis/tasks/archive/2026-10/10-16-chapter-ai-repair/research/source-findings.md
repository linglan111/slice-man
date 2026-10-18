# Pre-implementation source findings

Product refinement: the user explicitly excludes person-name checking from full-text chapter splitting, alongside recognition. Keep existing whole-timeline name transport and global recurrence; repair NAMES_EVIDENCE without per-chapter candidates or chapter-plan dependency. Any earlier whole-AI/chapter-name design is superseded by this exception.

Branch: codex/ai-chapters-resumable-tools. Existing unrelated worktree changes remain intact.

- App.tsx:90 first active stream; :302 hides round/phase; :347 duplicate heading button.
- person-names.ts:54-82 exact field aliases, two-cue recurrence, first unsupported alias rejects all (:72). person-name-request.ts already prohibits invented aliases. job-service.ts:656-770 global 2000-target request with no correction. Screenshot cannot establish the exact bad alias; reproduce before claiming its cause.
- normalPlan :379 reuses compatible plans, deterministic up to 20 minutes, AI beyond. translate :1144 uses chapter workers, but chapterTranslation :1288 splits 150-cue/96KiB pieces with neighboringContext. draftTranslations :1359 has serial groups/transient new-ID coverage.
- chapter-work.ts clamps concurrency at three, consuming per-job chapterConcurrency. ProfileEditor/profileInputSchema have no service limit. Live snapshots lack chapterId, unlike persisted diagnostics.
- reviewDraft :1691 bypasses chapters up to 30 minutes; larger chapters are serial/adaptively subdivided. Keep local evidence validators while adding entire chapter transport context.
- repair-loop.ts category-only ASR/translation routing conflicts with new fresh-evidence requirement. job-service.ts:2293+ has no old/new adjudicator. Preserve lease, overlap expansion, freshness and retention.
- designStyle :2470+ whole timeline must also be migrated. Custom planning needs nonrecursive normal-plan bootstrap.
- Existing live suites/helpers: ai-stream-live, responses-live, chapter-project-live; already support isolated user data, request ledgers and disabled reasoning traces. Native testing must retain Electron SQLite ABI.
- Shared subtitle-review-reprocessing spec contains superseded global one-shot/category routing; update changed semantics while preserving independent safety rules.

No product source was edited during planning.

## Actual name diagnostic follow-up
Independent verification inspected both original failed name answers readonly with zero paid requests. The reported aliases are exact substrings, with no sampled case/field/absent-literal error. All rejected boundaries are Latin edges adjacent to Han/Hiragana in ja -> zh-CN content, including mixed Katakana-leading/Latin-ending names. The broad continuation class containing every Unicode letter mistakes natural CJK adjacency for a partial Latin word. This is an actual matcher bug; the earlier tentative assumption that the validator was correct for these cases is retracted. Names owner is implementing a script-aware fix with positive mixed-script and negative word-fragment/Unicode safety regressions. Canonical-name correction remains a separate robustness improvement. Sanitized evidence is research/original-names-diagnostic.json; raw names/subtitles/reasoning are excluded. Current job update precedes failed requests but diagnostics lack an inspected revision, so original-snapshot equivalence is a recorded limitation.
