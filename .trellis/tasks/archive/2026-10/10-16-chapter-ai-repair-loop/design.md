# Design

Parent ../10-16-chapter-ai-repair/design.md is the shared technical contract.

After core contracts. Own repair contracts/planning/adjudication/orchestration/tests; coordinate shared job-service edits.

Chapter missing checks, fresh ASR/enabled translation, full-context old/new adjudication, explicit unchanged-result invalidation, bounded loops and final reassessment.

Use canonical chapter ownership/full-context payloads, immutable worker drafts, bounded service scheduling, strict coverage/evidence validation and last-moment freshness/abort checks. Preserve parent publication guarantees and legacy storage. Add child-specific findings before material design changes.

Final consistency is a separate assessment-only phase after final reassessment. Re-read stored state, batch all required missing/recheck cues by chapter, then verify persisted complete current-grade coverage under the same operation lease. No post-check repair invalidation, extra repair round or threshold filtering is permitted. Failure, cancellation, stale publication or unchanged pending coverage remains explicitly incomplete rather than silently succeeding or looping indefinitely.
