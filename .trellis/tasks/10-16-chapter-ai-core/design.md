# Design

Names are excluded from chapter orchestration: do not route analyzeNames through normalPlan, chapter ownership or candidate aggregation. Reuse only the API-service limiter for its one whole-timeline request. Recognition is also excluded from chapter splitting.

Parent ../10-16-chapter-ai-repair/design.md is the shared technical contract.

First. Own shared contracts/profile storage/core orchestration. Stabilize before dependent work.

Canonical chapter reuse/full context, provider concurrency persistence and scheduling, translation/review/style, nonrecursive chapter bootstrap.

Use canonical chapter ownership/full-context payloads, immutable worker drafts, bounded service scheduling, strict coverage/evidence validation and last-moment freshness/abort checks. Preserve parent publication guarantees and legacy storage. Add child-specific findings before material design changes.
