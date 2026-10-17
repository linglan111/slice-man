# Reusable chapter batches and API concurrency

Scope exception: recognition and person-name checking do not use full-text chapter splitting. Names retain one whole-timeline request; the shared API limiter may apply without any chapter planning dependency. Help text and tests must reflect both exceptions.

## Goal
Canonical chapter reuse/full context, provider concurrency persistence and scheduling, translation/review/style, nonrecursive chapter bootstrap.

## Source requirements
Parent ../10-16-chapter-ai-repair/prd.md owns the complete request. This child owns R3-R5. Parent acceptance A1-A6 applies to its relevant scope.

## Requirements and acceptance
Canonical chapter reuse/full context, provider concurrency persistence and scheduling, translation/review/style, nonrecursive chapter bootstrap.
Verify observable outcomes: Request payload/count assertions; overlapping workers within service caps; reuse/invalidation; out-of-order merge; legacy profiles; failure/cancel.
Retain existing safety/compatibility and unrelated workspace edits. Record actual evidence; do not claim unrun checks.

## Dependencies
First. Own shared contracts/profile storage/core orchestration. Stabilize before dependent work.

## Out of scope
Other children's deliverables except explicit integration; unrelated cleanup or new providers.
