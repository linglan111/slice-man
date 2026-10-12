# Loop implementation plan

1. After approval, load shared review/reprocessing and backend transactional/error/type specs; register input, metadata, result and progress schemas across shared/main/preload.
2. Add all/range validation and the user-approved whole-cue expansion policy, half-open current-cue scope resolution, fresh eligibility and category/expanded-overlap planning; cover ignored-high/pending-low and mixed-grade routes.
3. Extract internal manual draft/review primitives without changing public guards. Implement one loop lease, whole-round commit, service preflight, ownership cleanup and cancellation checks.
4. Add ignore identity preservation, context-dependency rechecks, style/profile conflict protection and interrupted metadata recovery.
5. Integrate App busy/run progress and compact SubtitleList controls with all/range mode, validated start/end seconds, effective-scope display and scope-aware terminal wording. Preserve right-panel accessibility when range inputs are expanded.
6. Add deterministic integration tests: new IDs across rounds, convergence/cap, zero translation source-only, missing services, mixed atomic failure, cancels in each phase/commit boundary, no inter-round unlock, conflicts, silent ASR, ignore expiration, restart/legacy compatibility.
7. Add native Electron E2E using provider fixtures for loop/cap/cancel, fixed-range reruns across fresh cue IDs, preservation outside approved effective scope and default/minimum control geometry; retain full manual reprocessing/review/import/export tests. Integration cases include reversed/out-of-media bounds, decimal conversion, exact touching boundaries, empty scope, contextual neighbour evidence and outside-only high risks.
8. Update shared review/reprocessing spec and README; run lint/type/unit/build/full Electron gate and independent delegated review.

Validation: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`. Use existing unit script to handle native Node/Electron SQLite ABI; do not weaken assertions or replace native tests with renderer-only evidence. Provider fixtures prove mechanics; real-service/native skips are separately reported.

Risk/rollback: primitive extraction and strict persisted schemas must change coherently; keep manual operation tests green before expanding loop cases. No release branch push.
