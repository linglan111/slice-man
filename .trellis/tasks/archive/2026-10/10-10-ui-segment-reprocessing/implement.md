# Execution Plan

## Preconditions
- [x] User consented to task creation/planning.
- [x] Repository evidence gathered and product decisions recorded.
- [x] Complex-task PRD/design/implementation artifacts and real context manifests prepared.
- [x] Presented the full plan; user explicitly approved implementation with "可以".
- [x] Started task and branch `codex/ui-segment-reprocessing` after approval.

## Ordered Milestones and Ownership
1. **Main coordinator:** record baseline uncommitted state; preserve all existing work; load Phase 2 context. Dispatch Trellis implement with this active task, full approved plan and curated context. Tell each worker it is not alone and must not revert other edits. Use sequential or nonoverlapping ownership; shared App/contracts/store changes must have one owner.
2. **Contracts/import/optional translation owner:** extend schemas/preload/IPC/import/download callback; persist import choice with legacy compatibility; gate every translation path; wire source-only display/export. Own shared contracts plus import and translation pipeline modules, and compatibility tests.
3. **Range/review backend owner:** implement shared target planning, reusable crop recognition, atomic partial translation/recognition publication, validated text review, persisted report applicability/acknowledgment and profile invalidation. Coordinate shared contracts with the previous owner; no simultaneous edits to the same modules.
4. **Frontend/native identity owner:** after contracts stabilize, refine App/components/styles, import mode selection, collapsible sidebar, toolbar/range panel, review filters/repair flow, independent scroll/inline editing, SVG/icon assets, native menu and packaging icon integration.
5. **Trellis check agent:** review the integrated task against all ACs; self-fix scoped drift, missing meaningful tests, lint/type failures. Run relevant checks once; repeat only after new changes/failures.
6. **Main coordinator:** inspect evidence/screenshots, summarize tested behavior and material limitations, update specs for new executable contracts, follow commit/finish-work gates. Do not mix unrelated preexisting edits into task-specific commits.

## Validation Commands
Use the repository's actual npm scripts and Electron-native runner; do not switch SQLite ABI with ordinary Node rebuilds.
- `npm run typecheck`
- `npm run lint`
- `npm test -- <targeted-new-and-affected-test-files>` via scripts/test-unit.cjs, with the exact file set determined by implementation.
- `npm run build`
- `npx playwright test <task-e2e-files-and-affected-regressions>` after build.
- `npm run test:native` if native startup/store paths change.
- Task-specific packaged build in an isolated dist subdirectory plus existing package smoke tooling against that directory. Inspect ICO/executable/installer resources; run installer smoke if installer identity changes.

## Meaningful Tests
- Legacy option/report parse, both import paths, canceled import and original-only generation with zero translation calls.
- Original-only windowed/native fullscreen text and ASS/SRT/VTT/burn-in with previously stored translations; mode toggles preserve stored content.
- Selected/nonadjacent/time/gap/overlap/edge expansion; server/UI plan parity; unknown IDs/revision/busy/media-bound rejection.
- Real cropped audio: offset applied once, local/cloud later intervals/chunks, delayed audio, CPU/GPU fallback, fresh IDs, silent target and unaffected text/emphasis retention.
- Atomic combined request: translation failure or cancel after ASR leaves old target content; malformed/missing translation output fails safely; exports reflect only committed edits.
- AI review batch coverage/context/strict findings, no audio/translation requests, cancellation/failure/unknown IDs, report restart, ignored findings, per-cue stale/recheck and material provider changes.
- Real isolated Electron workflow: import mode, source-only generation/export, both scope modes, review navigation and repair, batch actions and translation-enabled variant.
- Layout at actual 1440x960 and 1050x700 windows, collapsed/expanded sidebar, long inline forms, banners and portrait video. Assert document scroll stays fixed while local scrolling works; save screenshots.
- Native menu absent after Alt; native controls and standard editing shortcuts work; actual packaged icon identity.
- Affected regression set: inline subtitle CRUD/follow, live captions/fullscreen, full recognize-again, seeking, profile invalidation, online import and export preferences/publication.

## Evidence and Review Gates
- Save screenshots, command results and native/media/package evidence under this task's `evidence/`.
- Distinguish deterministic provider fixtures from real provider/hardware evidence; do not claim acoustic verification or universal recognition accuracy.
- After each milestone verify its data contract before changing the next layer. A discovered material product-scope change returns to planning and requires review of the changed plan.
- Completion requires all applicable ACs checked, real UI evidence reviewed and required checks passing; absent external resources are a limitation to resolve/report, not a passing result.

## Risky Files and Rollback Points
Shared schemas/defaults, App orchestration, provider dependency invalidation, JobService recognition publication, MediaService crop offsets, caption/compiler content selection, download import callback, main window and builder settings. Keep each milestone reversible in a task-specific diff; never delete the user's data/runtime/output to test a rollback.

## Authorized Review Refinement (2026-10-11)
- Backend/shared owner: canonical versioned rubric/rule map; strict all-target assessments and evidence references; chronological full/targeted context parity; efficient context dependencies; legacy/report/CRUD/replacement invalidation and scoped tests. Publish typed contract to renderer and E2E owners before their dependent edits.
- Renderer owner: graded badges, compact filter/counts, select/repair current grade, truthful unreviewed/legacy/stale states and frontend tests. Preserve the previously validated fixed editor layout.
- Desktop owner: migrate deterministic review fixtures to the new strict rule/assessment format; full four-grade workflow/context/grade-filter and minimum-layout evidence. Own all build/E2E scheduling; main repackages only after final build.
- Trellis check: final full-scope review of both original approved task and R10/AC11/AC12; meaningful context-dependency, complete-coverage and fixed-level tests. Prior package/check reports remain valid only for the pre-refinement build and will be superseded.
- Main: document exact rubric/contracts, refresh user-facing explanation, final package identity/smoke, commit plan and mandatory final one-shot commit confirmation.
