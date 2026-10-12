# Execution plan

Status: approved2026-10-11; implementation in progress.

1. Load curated implement/check contexts and before-dev specs. Preserve unrelated workspace edits.
2. Add strict request-local aggregate wire schema/budget/normalization helpers. Preserve canonical window construction and hash semantics.
3. Replace serial generation inside `reviewDraft` with aggregate initial generation, bounded trusted correction and atomic validation/publication; expose honest phases/cancel.
4. Update integration/E2E mock providers alongside wire contract. Add 31/65/1027, disjoint group, output errors/correction limits, budgets, cancellation and old-report preservation cases.
5. Renderer ownership: review-presentation and service/standards behavior only. Coordinate App/SubtitleList integration with operation-workspace owner; do not concurrently edit those files.
6. Verify missing/dangling profile, unchecked counts and standards native geometry/focus. Re-run all manual and automatic review/repair regressions.
7. Update executable shared review contract and README guide. Run lint/typecheck/unit/build, then delegated full Electron review after all children integrate.

Risks: canonical evidence widening, output truncation, stale report publication, inconsistent loop semantics, fixtures masking request count. Roll back aggregation and mocks together; never weaken evidence validation to pass fixtures.
