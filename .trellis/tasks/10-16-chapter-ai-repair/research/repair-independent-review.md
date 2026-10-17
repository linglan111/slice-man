# Independent repair safety review — 2026-10-17

Reviewer: `/root/repair_check`, independent of `/root/repair_resume` implementation. No product or test files were edited by the reviewer. Findings were sent to the implementation owner and leader; the owner supplied the fixes below before the reviewer re-read the stable implementation and ran checks.

## Reviewed scope

- `src/main/services/jobs/lib/job-service.ts`: repair orchestration, ASR/translation drafts, chapter audits, final consistency and freshness/publication guards.
- `src/main/services/jobs/lib/repair-loop.ts`: candidate eligibility and explicit unchanged-result assessment invalidation.
- `src/main/services/jobs/lib/repair-adjudication.ts`: prompt, strict per-target mappings, acoustic association, silence, text validation, cross-chapter merge/conflict validation.
- `src/shared/reprocessing-contracts.ts`: adjudication/final-consistency phases.
- `tests/integration/backend/reprocessing.test.ts` and `tests/e2e/repair-loop.spec.ts`: behavioral regression assertions. E2E source reviewed; execution remains owned by verification teammate.

## Findings resolved by implementation owner

1. A target could reference unrelated fresh speech anywhere inside a merged effective interval. Retiming that fresh ID onto a different target also bypassed the original temporal-OR-acoustic guard. Fresh IDs now require original fresh-source/target overlap and audited-output/fresh-source overlap; old outputs still require target overlap. Negative tests cover distant old/fresh mappings and both retiming directions.
2. Exclusive chapter ownership of a fresh cue spanning two chapters made a legitimate A+B merge unrepresentable and could retain duplicate B speech. Fresh evidence is now available in every affected chapter. Equal shared output IDs are published once only when every field agrees; disagreement rejects the entire round. Tests cover successful shared merge, conflicting shared values and a different-ID M+B duplication.
3. Per-chapter validation alone did not catch newly introduced overlap across chapter outputs. Global merge validation now rejects mixed old/fresh or enlarged/invented overlap while preserving original old-old and native fresh-fresh overlap. Positive and negative tests exercise these distinctions.
4. Interval-wide silence admission prevented an explicitly silent B from being removed beside spoken A in the same ASR interval. After the leader's explicit decision, silence admission now uses target-level timestamp evidence across all fresh cues. Only an explicit empty replacement mapping may remove a target with no associated fresh cue; omitted mappings and empty mappings with associated evidence still fail. The implementation does not claim timestamp absence proves acoustic silence.
5. The shared segment schema accepts empty source strings. Audited outputs could therefore retain valid IDs/times while erasing visible source-only content. Audits now require nonempty source text; enabled translations must also be nonempty and non-stale. Silence uses explicit empty mappings. Negative tests cover both project modes and stale translated output.
6. Post-round assessment previously swept unrelated pre-existing outside-scope recheck cues into paid requests. Required coverage now follows the requested scope, old/new effective targets and newly invalidated previously-current dependencies. A regression preserves an unrelated outside pending cue without checking it.

## Final consistency acceptance

Read actual code paths: initial chapter plan is established once and its boundaries rebound after ASR; all qualifying targets receive fresh recognition and enabled translation; chapter audit results are gathered before one round content transaction. Original targets and replacements are explicitly invalidated even when audited output is unchanged. Abort/revision/options/plan/provider/key guards run before publication, with one continuous operation lease.

Final consistency re-reads persisted assessments, checks all required missing/recheck cues independent of threshold, preserves the last repair round, performs no content mutation, and verifies persisted current-grade coverage before success. Integration cases inject a surviving pending dependency after the last reassessment and verify success, provider failure, cancellation and persistent non-progress. Failure never fabricates a none grade or claims completion. Fixed range, expanded fresh-cue grading, ignored findings, caps, source-only zero translation, prior-round retention and neighbour preservation are also exercised by the focused suite.

## Independently executed verification

- `npm run lint` — passed, exit 0, after stable owner handoff.
- `npm run typecheck` — passed, exit 0, after stable owner handoff.
- `npm test -- tests/integration/backend/reprocessing.test.ts` — passed, 1 file / 65 tests, 29.88 seconds, using the project's Electron ABI wrapper.

## Additional leader finding resolved

After the initial checks above, the leader identified and this reviewer confirmed a termination edge: if final consistency creates a newly eligible scoped finding while repair rounds remain, the existing branch reports `max_rounds` success instead of returning to the repair loop. The owner added the conditional return to the ordinary repair loop. The new regression starts with complete none assessments, injects a scoped pending B during final consistency, grades it medium, then verifies exactly one actual repair round, one media revision, fresh ASR/translation, untouched A/C and final `no_eligible` success with budget remaining. Final consistency itself spends no round. This reviewer re-read the stable guard and test; final independent execution is recorded below.

Final stable rerun:
- `npm run lint` — passed, exit 0.
- `npm run typecheck` — passed, exit 0.
- `npm test -- tests/integration/backend/reprocessing.test.ts` — passed, 1 file / 66 tests, 25.48 seconds, Electron ABI wrapper, exit 0.

No remaining concrete repair defect identified after the final stable reread and rerun.

This is not final project acceptance: complete unit/build/desktop E2E and authorized real-provider/native recognition evidence remain owned by the verification teammate. The reviewer made no paid calls and did not execute the new final-consistency Electron cases. Linguistic/acoustic accuracy is outside what deterministic fixtures establish.

Safety tradeoff: ambiguous or newly mixed overlapping audit output is rejected atomically, preserving the previous round; the reviewer does not claim every semantically plausible mixed old/new overlap will be accepted.
