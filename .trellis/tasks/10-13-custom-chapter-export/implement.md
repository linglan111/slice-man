# Implementation plan

1. Require approved parent plan; read parent PRD/design/implement and curated child contexts.
2. Honor dependencies: Depends on ai-streaming-diagnostics for all new AI calls and chapter-translation-review for shared normal/custom plan contracts, source fingerprint and planner. Do not create a second planner or parallel copy of chapter schema.
3. Implement only the ownership boundary, coordinate shared edits and retain foreign changes.
4. Verify: Criteria create/edit/copy/delete/empty-library restart, source/range stale guards, single-close/minimum-window controls, selected native seek/export, actual FFmpeg audio offsets/subtitle clipping/rebase/durations/codecs, duplicate/reserved/existing filenames and completed clip retention.
5. Run appropriate unit/integration checks and lint/typecheck; report exact changed files and evidence to parent.
6. Parent performs integrated native regression/review, scoped commit and packaging; do not push/release/install or run conflicting Electron fixtures concurrently.

Detailed ordered parent execution: ../10-13-ai-chapters-resumable-tools/implement.md.
