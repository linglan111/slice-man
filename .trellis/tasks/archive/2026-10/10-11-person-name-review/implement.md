# Execution plan

Status: approved2026-10-11; implementation in progress.

1. Read shared/backend/frontend curated context and final aggregate-review implementation; sequence after review changes to avoid shared/service overlap.
2. Add strict names schemas/version/bounds and all typed IPC/preload/progress layers. Pure helper owns matching, conflict detection, simultaneous replacement and undo patch validation.
3. Add analysis under existing job operation owner with profile/revision/mode/cancel guards and locally grounded counts; persist optional fresh report.
4. Add one atomic apply transaction, source/translation/derived-state invalidation, minimal emphasis patch and bounded latest-batch persistence. Add provider-free safe undo with current-value conflicts and terminal consumption.
5. Add isolated integration/store/matcher/IPC cases including malformed report, oversized/no-op batch, later edits, source-only and restart. Never test by mutating user's real projects.
6. Implement dedicated names panel; hand integration into App/SubtitleList to operation-workspace owner. Update guide/docs after labels settle.
7. Native full path with mock HTTP, corrected export, undo/restart/conflict, then original loop/review/manual regression. Delegate independent final review/full native E2E after integration.

Risks: wrong-person literal replacement, alias overlap/cascade, same-field later-edit overwrite, metadata growth, falsely current translations, style snapshot overwrite. Tests must enforce preserved content on validation failure. Roll back new Job/API fields coherently across shared/store/preload/main/UI.
