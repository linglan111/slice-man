# Implementation coordination

User approved the updated plan on 2026-10-17 and requires leader-only main orchestration. The replacement AGENTS.md explicitly assigns implementation, tests and independent review to non-recursive teammates. No main-session product edits or test execution.

## Ownership
- core (Trellis implement): shared/backend chapter context and batching, profile textConcurrency, service limiter, translation/review/style/bootstrap, backend core tests. Does not edit analyzeNames or repairLoop.
- names (Trellis implement): analyzeNames only in shared job-service, name libraries/request/correction, focused names unit/integration/E2E and surgical names fixture branches in helpers.ts.
- progress (Trellis implement): renderer/styles/frontend tests and non-names/non-repair progress E2E; consumes shared contracts from core. Names fixture branches in helpers.ts reserved for names worker.
- repair (next slot): repairLoop and repair libraries/contracts plus repair-loop E2E, after shared contract readiness.
- Independent final check: a fresh Trellis check teammate who did not implement the checked scope, including full validation and explicit acceptance coverage.

## Stable interfaces
Profile textConcurrency: default 2, integer 1–16; transport-wide limiter handles names without chapter dependency. ProgressEvent.work: AiWorkProgress with runId/operation/phase/round/maxRounds/start/counts and request entries. Live snapshots optional runId/chapterId. Shared chapterContext supplies full chapter evidence; rebindChapterPlan preserves repair boundaries with fresh source membership; ChapterProgress models complete queued/active/terminal chapter work.

## Gate notes
Names retains a global whole-timeline request and strict evidence. Exact original alias reproduction remains distinct from code-level failure mechanism. One processing stream action; after completion a separate single action may preserve viewer reopening. Final repair consistency checks drain required pending assessments without extra repair rounds/content mutations.

## Live test access
Names worker located a prior ignored secure bridge pattern under .native-smoke/ui-refinement-20261015/run-project-live-secure.cjs. It must not be rerun unchanged. It uses a readonly original DB and Electron-memory credential decryption with isolated user data. Adapt and serialize actual paid calls only after integrated readiness; never modify/terminate the user's installed app or leak credentials/reasoning into evidence.

## Pre-existing scope
Known dirty tracked files before implementation: .trellis/spec/backend/index.md, frontend/index.md, shared/index.md and tests/e2e/seeking-helpers.ts. Numerous untracked platform/runtime/Trellis/bootstrap/old-task files were already present. Preserve and exclude unrelated edits from task commits; do not blanket git add.

## Intermediate evidence (not final acceptance)
- Names teammate: 60 focused unit/integration cases, typecheck and scoped lint pass. Implementation evidence in sibling names/research/implementation-evidence.md; desktop E2E and exact original alias/live service reproduction pending integration.
- Core teammate: first focused chapter/review run 58/58 and typecheck pass; adding broader concurrency/context/persistence tests and running full unit discovery while other implementations continue. Not yet a stable final full-suite result.
- Progress teammate: frontend 245/245 and lint pass; shared-backend/repair integration and native E2E remain pending. No paid calls have been made at this checkpoint.

## Quota interruption and resume
The user explicitly requested continuation after quota interruption on 2026-10-17. Approval, paid-service test authorization and leader-only responsibilities remain valid; no repeat planning gate. At interruption, repair implementation/testing and independent repair review had not completed. A prior verifier had passed an interim native build/progress E2E and privately replayed both original complete failed name responses with the fixed matcher (8/8 and 7/7 candidates); final full regression/live checks were not complete. Original broad matcher-correct assumption was disproved and replaced by the actual CJK-adjacency diagnosis in source-findings.md.

Fresh teammates repair_resume (repair implementation/focused tests), repair_check (independent deep repair safety) and verification_resume (whole-scope integration review, serialized build/full E2E and actual services) resume the current tree/evidence instead of recreating work. New user edits to AGENTS.md and .trellis/workflow.md are unrelated to this task's product commit and must be preserved. The real-service cumulative request ledger must be checked before any rerun; initial bounded allowance remains 30 upstream calls across attempts, not 30 per test process.

## Second quota resume / final gates
The user again requested continuation after quota interruption. Current implementation includes final-consistency newly-eligible continuation, independent repair66-case clearance, minimum-window150px summary plus scoped non-sticky progress, and the latest explicit normal-plan provider lease/freshness protection. Previous full native run recorded48pass/4fixture-fail/7skip; targeted refinements are retained rather than replacing that first evidence. Original whole-name replies still ground8/8+7/7 privately without paid requests.

Fresh final_review independently reviewed the full current source/specs and ran85files/935unit-integration tests successfully after repairing a one-line missing download.cancel fixture collaborator. Public dependency guards, stale/replaced plan retention and names exemption have seven new tests. Runtime_verify independently accepted that fixture fix and owns the final current build, native reruns, real CPU recognition and bounded actual AI services. First935 run's two disposal failures and all earlier desktop fixture failures remain recorded. No final acceptance or task completion is claimed before runtime evidence.

## Actual-service gate and final full desktop rerun
Runtime verification has now completed actual configured Responses service names, chapter planning, two-chapter translation/review/style and full repair with real local CPU recognition. Cumulative ledger ends at19/30, observed upstream concurrency2. Public JFK native recognition returned one cue; explicitly manual two-cue subdivision preserves its normalized words/punctuation, and manually seeded medium assessments guarantee repair execution. These are plumbing fixtures, not claims of native word alignment or model-detected initial suspicion.

The first repair attempt was truncated by the proxy's artificial8192-output-token override. Independent readonly inspection proved zero committed rounds, original cues/previously published translations and seeded assessments retained. After independently reviewed zero-AI identity preflight, continuation reused the same isolated job/profile/port and cumulative ledger with no output-token override. It published all six new requests, obtained two fresh CPU receipts, committed one round, persisted current medium grades on both surviving cues, and passed restart/SRT export. Outcome is honestly max_rounds with remainingCount2, not all-clear. The failed attempt and all prior diagnostics remain intact.

The source reviewer is auditing sanitized actual-service artifacts while runtime_verify runs one final complete native desktop suite with all paid opt-ins/credentials cleared. Final leader acceptance and commit/archival gate remain pending that result. Main session has only coordinated, reviewed evidence and maintained task/spec documents; implementation, tests and independent review remain teammate-owned.

Final complete native suite settled:63 discovered,53 passed,10 explicit opt-in skips,0 failures/flaky,324.91s,exit0. Paid count before/after remains19. Independent reviewer checked original Playwright JSON/log, all skip reasons, actual SQLite/ledger/screenshots and final static gates; no remaining concrete finding. Leader accepted the full deliverable within recorded CPU/provider/manual-fixture limits. All work and evidence is concrete; only the workflow's one-shot commit/archival confirmation is pending. Scoped paths and exclusions are in research/commit-plan.md. No git staging/commit/push/archive has occurred.

## User-requested resize and package follow-up
The user requested a small operation-panel height divider before packaging, with capped auto-fit every time a different operation opens and temporary manual height afterward; the user will validate the package. Original operation_resize landed App/hook/CSS/focused-test changes before another quota interruption. On explicit resume, resize_finish completed this existing delta and focused checks; resize_review independently accepted the product delta and ran12 hook/divider cases plus lint/typecheck. Stale test-only no-divider/direct-parent assumptions are narrowly updated, including operation-workspace, pane-resizing and WorkspaceSettings. The previous935/53full results remain the prior AI-feature baseline, not a claim of a complete post-resize rerun.

package_preview owns the serialized installer build after leader release: CLI metadata0.1.5-preview.10 and fresh dist/verification-0.1.5-preview.10-20261017. No package.json version edit, no overwrite/termination/installation of the user's running F:/Soft/Slice Man client, no additional paid requests or broad suite. Installer checks cover current bundle/version/hash. Task remains open for user manual validation and separately pending Git confirmation.
