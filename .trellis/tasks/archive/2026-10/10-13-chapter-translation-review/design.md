# Design boundary

## Dependencies
Depends on ai-streaming-diagnostics typed request context, file lifecycle and SQLite request logging. Do not integrate defaults until the streaming foundation tests pass.

## Ownership
Shared normal/custom plan schemas, trusted source planner, Job plan/review-run metadata, default translation and >30min chapter checking orchestration, global evidence and original-only/repair integration.

Follow ../10-13-ai-chapters-resumable-tools/design.md for contract, data flow, capacity, failure/publication, compatibility and cleanup rules. Parent coordinates shared App/JobService/IPC/schema files; do not overwrite other workers. A material design change returns to parent planning review.

## Evidence
Load curated specs/research in implement.jsonl/check.jsonl, with child-side loading if native injection is absent. No newly passing test claim is made during planning.
