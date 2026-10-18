# Chapter-scoped automatic subtitle repair loop

## Goal
Chapter missing checks, fresh ASR/enabled translation, full-context old/new adjudication, explicit unchanged-result invalidation, bounded loops and final reassessment.

## Source requirements
Parent ../10-16-chapter-ai-repair/prd.md owns the complete request. This child owns R3-R7. Parent acceptance A1-A6 applies to its relevant scope.

## Requirements and acceptance
Chapter missing checks, fresh ASR/enabled translation, full-context old/new adjudication, explicit unchanged-result invalidation, bounded loops and final reassessment.
Verify observable outcomes: Multi-round/chapter evidence; complete targets/timing/text; fixed range/expanded overlaps; source-only; ignore/threshold; converge/cap; every phase cancel/fail; atomic rounds.
After the last reassessment, additionally check all required surviving missing/recheck cues (fixed scope plus run-affected dependencies and expanded-ASR/new cues), regardless of threshold, by full-context chapter batch. Successful termination requires current explicit suspicion grades including none. This assessment-only phase does not add repair rounds or mutate content. Re-read persisted coverage; UI badges and restart data must agree. Failure/cancel retains pending states and cannot claim consistency or fabricate none grades.
Retain existing safety/compatibility and unrelated workspace edits. Record actual evidence; do not claim unrun checks.

## Dependencies
After core contracts. Own repair contracts/planning/adjudication/orchestration/tests; coordinate shared job-service edits.

## Out of scope
Other children's deliverables except explicit integration; unrelated cleanup or new providers.
