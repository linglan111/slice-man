# Repair resumption verification

## Scope

Resumed the interrupted implementation without replacing the other core, names,
progress, AGENTS/workflow or seeking-helper changes. Product ownership was the
repair method, repair-loop/adjudication helpers and repair-specific tests.

## Repair evidence and guards

- All qualifying categories receive fresh ASR and enabled chapter translation,
  followed by one old/new full-context adjudication per affected chapter.
- Fresh output must retain both target-to-original-fresh and
  audited-output-to-original-fresh temporal links. A disjoint old or fresh cue
  cannot satisfy another target merely through global ID or interval membership.
- A crossing ASR merge is available to every overlapping target chapter. Shared
  output IDs must agree exactly before deduplicated atomic publication. Mixed
  old/fresh introduced overlap and broadened overlap are rejected; pre-existing
  original or native-ASR overlap is retained.
- A target may be explicitly removed when it has no overlapping fresh cue, even
  if neighbouring targets in the same effective interval have speech. Missing
  mappings and deletion of targets with linked evidence still fail. This is
  timestamp validation, not an acoustic guarantee.
- Audited source text must be nonempty. Enabled translations must be nonempty
  and current. Unchanged adjudications still invalidate assessments.
- Required final coverage includes fixed scope, replacement/expanded cues and
  newly invalidated dependencies. Unrelated outside-scope assessments already
  pending before the run do not trigger additional paid requests.
- A distinct final assessment-only check drains required pending grades without
  adding a repair round. Nonprogress, failure and cancellation stay incomplete.
  If it uncovers a newly eligible scoped cue while repair budget remains, the
  actual repair loop continues; only a consumed cap can yield max_rounds.

## Executed locally by repair_resume

- `npm test -- tests/integration/backend/reprocessing.test.ts`: final run 66
  passed in 15.77 seconds, including cross-chapter merge/conflict/duplication,
  mixed silence, scope, empty-source/stale-translation and newly eligible
  final-check continuation regressions.
- `npm run lint`: passed after the final E2E additions.
- `npm run typecheck`: passed after the final E2E additions.

The test runner is the repository Electron-ABI wrapper. Tests use actual SQLite
and FFmpeg crops with deterministic provider mocks; these results do not prove
real acoustic or linguistic accuracy.

## Independent and desktop handoff

- repair_check owns independent final diff review and the final focused rerun.
- verification_resume owns serialized build/full desktop regression and actual
  configured-service testing. No paid requests were made by repair_resume.
- Added three desktop final-consistency cases (success/failure/cancel). An
  isolated SQLite trigger marks a surviving none-grade cue pending exactly after
  final reassessment. The cases assert one additional full-context check,
  unchanged round/content/revision, honest terminal metadata, current/stale UI
  badges and persisted agreement after restart. Screenshots and JSON attachments
  are emitted through Playwright. These cases have been handed off for execution;
  their presence alone is not a passing execution claim.
