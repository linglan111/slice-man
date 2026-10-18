# Grounded whole-timeline person names

## Goal
Fix NAMES_EVIDENCE while retaining one full chronological timeline analysis independent of full-text chapter splitting. Keep grounded global identity context and recurrence.

## Source requirements
Parent ../10-16-chapter-ai-repair/prd.md owns the complete request. This child owns R2 and the names exception in R3-R5. Parent acceptance A2/A3/A5/A6 applies to its relevant scope.

## Requirements and acceptance
Reproduce NAMES_EVIDENCE, distinguish observed aliases/recommendations, keep strict field-specific literal grounding and global two-cue recurrence, and visibly correct recoverable output at most once for the whole request. Preserve explicit capacity errors; never split/truncate names by chapter.
Verify wrong-field/case/boundary aliases, correction/terminal retention, global identity/ambiguity safety and apply/undo/staleness/restart. With absent/stale/custom/multiple normal plans, send one whole-timeline name request without chapter generation or plan mutation; chapter-only edits leave the payload and name applicability unchanged. Honor API-service concurrency as one request.
Retain existing safety/compatibility and unrelated workspace edits. Record actual evidence; do not claim unrun checks.

## Dependencies
Independent of chapter core. Own names prompt/grounding/correction and focused tests; coordinate shared limiter and job-service edits. Never depend on normalPlan or chapter candidate aggregation.

## Out of scope
Other children's deliverables except explicit integration; unrelated cleanup or new providers.
