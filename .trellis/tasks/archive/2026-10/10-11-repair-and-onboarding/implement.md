# Execution plan

Status: in progress. User approved the updated complete summary on 2026-10-11; time-range whole-cue boundary policy is confirmed. Branch: `codex/subtitle-repair-onboarding`.

1. Activate the approved task and create `codex/subtitle-repair-onboarding`; preserve all unrelated dirty files.
2. Load before-dev shared/backend/frontend specs. Implement and validate the loop's shared contracts and main-owned atomic primitives first.
3. Integrate compact right-panel all/range UI/progress/cancel; finish targeted loop unit/integration tests, including fixed interval reruns and approved boundary preservation.
4. Add guide component/preferences independently, then integrate into App after loop UI edits settle. Match guide copy to implemented controls.
5. Add genuine first-run/restart/keyboard tests and update existing fixtures/helper through explicit seen preference/real UI dismissal.
6. Update README usage and executable review/repair contracts. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` with native rebuild as required by existing scripts.
7. Delegate independent full regression review and Electron E2E to subagents; fixes must rerun affected checks. Cover default/minimum layout and retained manual/import/export flows.
8. Record concrete evidence and gated skips, complete Trellis checks/journal, and report results. No release/version bump/publication in this task.

High-risk files: shared strict schemas, `job-service.ts` primitive extraction, provider/style write guards, startup metadata conversion, App startup/dialog integration and shared E2E launch helper. Rollback changes coherently across IPC layers; never leave a new channel without validation.

## Added scope execution (approved2026-10-11)

R9–R11 have converged artifacts and research. User explicitly approved the latest final summary on2026-10-11; activate children and dispatch sequenced product implementation.

1. Implement review-reliability aggregate wire transport/correction/budgets and pure presentation classification; rerun loop main tests. Operation-workspace owns App/SubtitleList integration; other workers hand off dedicated components/hooks.
2. Once shared review/main files settle, implement person-name strict IPC, grounded matcher, atomic apply/last-batch undo and isolated tests. No paid provider/user database changes.
3. Operation-workspace implements toolbar/two-column panels/lower-left settings, measured sizing and native fit, integrating review/name UI with sole ownership. Refresh first-run guide/docs to final labels.
4. Run lint/typecheck/full unit/integration/build; delegate independent final review and complete native E2E again for all five children, including real available CPU/GPU/import/export flows and explicit gated skips.
5. Save evidence and updated specs. Before any commit present concrete commit plan and obtain the separate required phase3.4 confirmation; preserve unrelated dirty files. No push/release/version bump.

## Final execution state2026-10-12

All five children implemented; delegated backend/shared review and full native regression passed after self-fixed findings. Final gates: lint/typecheck/build;60files574unit/integration;37nativepass3externalgateskip0fail. Specs/docs synchronized. No required implementation remains; only Phase3.4 one-shot commit confirmation then scoped work commits/archive/journal. Do not push or release.
