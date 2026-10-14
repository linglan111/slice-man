# Implementation plan

1. Require approved parent plan; read parent PRD/design/implement and curated child contexts.
2. Honor dependencies: None. Establish the typed stream observer/context and diagnostics persistence API before chapter orchestration integrates it.
3. Implement only the ownership boundary, coordinate shared edits and retain foreign changes.
4. Verify: Delayed and malformed SSE adapters, UTF8 boundaries, terminal-vs-EOF, header/idle/overall timing, heartbeat, no duplicate paid replay, cancel/backpressure, partial-file persistence, SQL migration and restart, legacy provider protocols.
5. Run appropriate unit/integration checks and lint/typecheck; report exact changed files and evidence to parent.
6. Parent performs integrated native regression/review, scoped commit and packaging; do not push/release/install or run conflicting Electron fixtures concurrently.

Detailed ordered parent execution: ../10-13-ai-chapters-resumable-tools/implement.md.
