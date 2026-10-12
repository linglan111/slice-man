# Bounded automatic subtitle repair

## Goal

Replace repeated manual grade selection, repair and rechecking with one bounded, visible and cancellable operation.

## Background

User confirmed category-based routing. Parent research `../10-11-repair-and-onboarding/research/repair-loop.md` documents locking (`job-service.ts:86`, `:231`), partial atomic operations (`:739`, `:780`), review freshness (`:931`), recursive ASR overlap expansion (`reprocessing.ts:20`), fixed risk ranks (`review-rubric.ts:12`) and preload progress validation (`ipc-validation.ts:32`).

## Requirements

- L1: Select inclusive low/medium/high threshold; proposed default medium. Select maximum 1–20 committed repair rounds; proposed default 3. Browsing filters remain exact-grade filters.
- L2: Main refreshes applicability and analyzes missing/stale assessments before routing. Only current compatible pending canonical findings meeting the threshold are candidates; ignored-high plus pending-low must not trigger a medium repair.
- L3: Route only qualifying findings: source/timing to ASR, translation-only to retranslation. If both qualify on one cue, ASR wins. Remove all expanded ASR overlap IDs from translation-only work; translated projects also translate newly recognized cues. Source-only mode never resolves translation configuration or calls translation.
- L4: One lease/controller owns analysis, all repair rounds and reassessment. Each round drafts all recognition plus remaining translation work, validates/cleans/checks identity, and commits once. No unlocked inter-round gaps or partial mixed-round publication.
- L5: Recheck every invalidated context dependency and new cue ID after each commit, including formerly none neighbours. Rebuild the next plan from the published timeline/report, never cached old IDs. Reassess after the last allowed repair before reporting the cap.
- L6: Preserve ignored status only for identical current cue/rule/content/context/provider/rubric/mode identity; changed content or context expires that ignore. An ignored finding is not immutable cue content: overlapping ASR may replace its cue.
- L7: Preflight required review/ASR/translation services before drafting; translation-only work must not require ASR. Stop on conflict rather than automatically retrying. Guard style/profile mutation conflicts through main enforcement or strict commit identity checks.
- L8: Optional top-level last-run metadata persists without media revision changes. Restart marks running work interrupted without resuming. Progress and terminal states expose phase, committed rounds, affected/remaining counts and final reason; incomplete reassessment has unknown current remaining count.
- L9: Compact right-panel controls and existing Cancel remain usable at default/minimum windows. Keep metadata/preferences out of media-content options.
- L10: Offer all subtitles or a fixed absolute start/end range. Validate 0 <= startMs < endMs <= media duration in main; renderer uses existing seconds-to-ms validation. Every round filters current cues by half-open overlap (`cue.start < end && cue.end > start`) before finding eligibility. Review bounded neighbouring dialogue for context; range-external suspicion alone cannot become a repair target. User accepted existing whole-cue/recursive-overlap ASR expansion: display requested/effective bounds and preserve content outside effective coverage.

## Acceptance criteria

- [x] AC-L1 (L1): Main rejects zero/negative/fractional/NaN/out-of-range rounds; medium selects medium/high but never none/low.
- [x] AC-L2 (L2–L3): Stale/legacy/ignored reports cannot supply fresh targets; mixed-grade routing and recursively expanded overlaps are correct; source-only makes zero translation calls.
- [x] AC-L3 (L4, L7): Cancellation/error during ASR or translation leaves the whole current round uncommitted; prior rounds survive. No concurrent edit can silently overwrite content/style/provider changes.
- [x] AC-L4 (L5–L6): New IDs and dependent neighbours are reviewed; unchanged ignores persist and changed-context ignores expire. Empty successful ASR is handled without erroneous NO_SEGMENTS review.
- [x] AC-L5 (L5, L8): No-eligible/cap/cancel/error/interrupted are distinct. Post-commit recheck failure retains repaired content and stale historical report, never claims all-clear.
- [x] AC-L6 (L8–L9): Optional metadata reads old jobs, restart does not resume, progress survives remount/project switching, and no stale event overwrites another run.
- [x] AC-L7: Targeted integration race tests plus native Electron loop/convergence/cap/cancel/geometry tests pass; manual partial repair/review regressions remain intact.
- [x] AC-L8 (L10): All/range modes, decimal times, invalid bounds, exact touching boundaries, no intersecting cues, fresh IDs and rerunning the same interval are covered. Scoped summaries/counts do not imply project-wide clearance; out-of-scope content is preserved according to the approved ASR boundary policy.

## Out of scope

Background loops, automatic provider/model changes, direct AI-generated replacement text, guaranteed convergence, persistent unlimited run history, whole-run undo, and release publication.

## Planning status

User approved the updated parent summary including time-range boundary and defaults/limits on 2026-10-11. Implementation is complete and under independent full native regression; later added R9–R11 scope remains a separate planning gate.

## Dependencies

This child has no implementation dependency on the guide. Establish shared loop contracts before UI integration. The guide's final copy and shared App integration depend on these scope rules/control labels being stable; sequence App edits with the sibling rather than relying on task-tree order.

## Final validation2026-10-12

Approved behavior implemented and independently reviewed. Global lint/typecheck/build passed; full unit/integration60files574pass; final native40total37pass/3explicitexternalgateskip/0fail. See parent evidence/final-added-e2e-review.md and final-unit.log. Implementation is not an AI accuracy guarantee. Task remains active pending required commit confirmation and bookkeeping; no release/version change.
