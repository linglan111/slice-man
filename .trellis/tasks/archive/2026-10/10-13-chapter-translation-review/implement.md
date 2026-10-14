# Implementation plan

1. Require approved parent plan; read parent PRD/design/implement and curated child contexts.
2. Honor dependencies: Depends on ai-streaming-diagnostics typed request context, file lifecycle and SQLite request logging. Do not integrate defaults until the streaming foundation tests pass.
3. Implement only the ownership boundary, coordinate shared edits and retain foreign changes.
4. Verify: 20min hard cap/30min strict gate, ordinary partition vs custom gaps, legacy loads, selected targets, cross-boundary original evidence, completed chapter retention/resume, missing/duplicate IDs, provider/source/key changes, concurrency and scoped atomic failure.
5. Run appropriate unit/integration checks and lint/typecheck; report exact changed files and evidence to parent.
6. Parent performs integrated native regression/review, scoped commit and packaging; do not push/release/install or run conflicting Electron fixtures concurrently.

Detailed ordered parent execution: ../10-13-ai-chapters-resumable-tools/implement.md.
