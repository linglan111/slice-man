# chapter-translation-review

## Goal and scope
Implement parent R2, R3, R4 and chapter contracts in R7 after final parent planning approval.

## Dependencies
Depends on ai-streaming-diagnostics typed request context, file lifecycle and SQLite request logging. Do not integrate defaults until the streaming foundation tests pass.

## Requirements and acceptance
Shared normal/custom plan schemas, trusted source planner, Job plan/review-run metadata, default translation and >30min chapter checking orchestration, global evidence and original-only/repair integration.
Required verification: 20min hard cap/30min strict gate, ordinary partition vs custom gaps, legacy loads, selected targets, cross-boundary original evidence, completed chapter retention/resume, missing/duplicate IDs, provider/source/key changes, concurrency and scoped atomic failure.

Authoritative full requirements: ../10-13-ai-chapters-resumable-tools/prd.md. Preserve its user decisions, compatibility, no paid/external action limits and all applicable acceptance checks.

## Status
Planning only; final parent summary requires subsequent implementation approval. No product code has been changed.
