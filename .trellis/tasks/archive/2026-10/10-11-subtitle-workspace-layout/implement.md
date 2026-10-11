# Execution Plan

1. Obtain explicit approval of the final planning summary; curate context manifests and activate with task.py start.
2. Dispatch a Trellis implementer owning renderer layout/components/styles and directly related regression tests. Inject or load planning artifacts and curated specs. Preserve all other changes.
3. Reorganize preview/proofreading columns and introduce persistent secondary-content disclosure beneath preview. Resolve sizing, overflow and toolbar defects across supported window sizes.
4. Add meaningful disclosure/persistence and geometry/action reachability regressions. Update older E2E setup paths to deliberately expand settings when needed, retaining behavioral assertions.
   - After revised planning approval, add pointer/keyboard pane separators, bounded layout preferences and reset. Cover sidebar width, column allocation, lower-settings height and preview inline-form height. Test persistence, invalid stored values, pointer cancellation and window/state reclamping.
   - Apply the user's exact-name correction to native/document/workspace labels and assert actual Electron titles/header before and after import/restart.
5. Run npm run lint, npm run typecheck, npm test and npm run build. Fix failures before independent regression.
6. Dispatch a separate Trellis check subagent for full-scope review and a separate E2E worker for the complete available Electron suite and visual evidence. Clearly assign ownership to avoid concurrent test/native-artifact writes.
7. Review findings, repair defects, and rerun affected checks. Record test counts, optional skips and exact limitations; inspect final layout evidence.
8. Update relevant frontend contracts/specs for the final layout and scrolling rules. Follow finish-work and Git conventions, with scoped staging only and no unrelated changes.

## Validation

- npm run lint
- npm run typecheck
- npm test
- npm run build
- npm run test:e2e (one process; Electron native ABI retained)
- Layout matrix: 1050x700, 1440x960, 1920x1080; expanded/collapsed sidebar and secondary region; portrait/landscape media; banners, review summaries, selected cues, long inline drafts, partial forms.
- Resize matrix: pointer/keyboard in each divider axis, extreme drags, viewport shrink/grow, restart and reset; preserve readable common controls and usable video/list/form minima.

## Risks

Many existing E2E tests assume always-visible settings. Update intentional disclosure setup without weakening provider/export assertions. Full native E2E takes longer than unit tests and some live-network/provider/hardware tests have explicit gates. Do not claim skipped features were actually validated.

## Completed Execution

- [x] Approved task, original layout plan and revised resize plan; curated implement/check context and isolated task branch.
- [x] Left preview/right full-height proofreading, persistent collapsible secondary controls, local scrolling and fixed common actions.
- [x] Four pointer/keyboard separators, bounded persisted dimensions, welcome/project reset and passive viewport clamps.
- [x] Exact `Slice Man` native/document/workspace names, including actual import/restart assertions.
- [x] Independent source review and native reproductions; repaired computed video-floor mismatch, simultaneous form clipping, welcome sizing/reset and late playback-error measurement.
- [x] Lint, TypeScript, build and all 49 unit/integration files / 446 tests passed.
- [x] Final complete real Electron suite: 25 passed, 3 explicitly gated skips, zero failures/flaky tests, 181.686 seconds; affected-test rerun also passed.
- [x] Final screenshots inspected and frontend contracts synchronized. See `verification.md` and `research/` reports for evidence and limitations.
- [x] Phase 3.4 one-shot commit-plan confirmation and scoped work commit `3492c81`; final archive/journal bookkeeping follows this handoff.
