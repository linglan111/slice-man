# Integrated Trellis Check

Scope note (2026-10-11): this report verifies the original approved implementation before the user's contextual four-grade rubric refinement (R10/AC11/AC12). A new final full-scope check and package build are required after that refinement; this earlier PASS is not the final gate for the expanded behavior.

Reviewer: dispatched `trellis-check`, 2026-10-10. Scope: approved PRD/design/implementation plan and check manifest for `10-10-ui-segment-reprocessing`.

## Findings (fixed)

- `src/renderer/src/styles/editor-layout.css`: at the actual 1050x700 native window, a cancellation banner pushed the proofreading list beyond the viewport. The preview was nonshrinking while proofreading controls and list had a larger combined minimum. Changed preview to a shrinkable flex column, retained the heading/action controls, and reserved a 200px proofreading panel. A follow-up real screenshot exposed a footer-only inline editor; both editor and partial-processing panels now retain a 75px local viewport, and minimum-width inline processing temporarily omits the redundant preview heading. Test thresholds were strengthened, not relaxed.
- `src/renderer/src/App.tsx`: generic retry routed retained-cue partial failures through full generation. Original-only projects could show success without processing anything; translated projects could translate the whole timeline instead of the failed scope. Limited generic retry to initial empty-timeline generation and export failures. Retained-cue repair remains in the existing target panel, with explicit full operations available.
- `tests/unit/frontend/AppSubtitleWorkflow.test.tsx`: added three regressions proving retry of a failed partial ASR in both project modes and failed partial translation submits the same target again without invoking full recognition/translation.
- `tests/integration/backend/reprocessing.test.ts`: full lint exposed an `import()` type annotation and missing fixture return type. The backend owner corrected these while the reviewer avoided simultaneous edits; final lint and type-check passed.
- `.trellis/spec/frontend/live-subtitle-preview.md`: synchronized usable local editor/panel viewports and scope-preserving retry rules. The coordinator also synchronized its expanded component signatures and executable mode contracts.

## Findings (not fixed)

- `src/main/services/jobs/lib/job-service.ts` and `src/renderer/src/components/SubtitleList.tsx`: a successful silent target can remove the old cue while retaining its prior suspicion as a captured-range recheck reminder. The UI can locate/play and rerun that range, but text-only targeted recheck needs an existing cue; an empty timeline cannot be scanned as text. This is an acknowledged product limit, not evidence that the empty passage was acoustically verified. The coordinator explicitly accepted retaining the historical reminder rather than silently declaring it clear. No new range-based review interface was invented.

## Verification

- `npm run lint`: pass after owner fixes and final reviewer changes.
- `npm run typecheck`: pass after final reviewer changes.
- `npm test -- --maxWorkers=4`: 43 files / 397 tests pass. One additional partial-translation retry regression was then added; its complete workflow file passed 7/7. Final covered total: 398 tests. No production code changed after the full test pass except the already-verified CSS minimum shared with the processing panel.
- Initial unconstrained full run overlapped another broad native run and packaging/media work: 393/395 passed, with two 5-second child-process timeout tests failing. Those exact two files passed 13/13 in isolation; the entire suite subsequently passed with four workers. No lifecycle production workaround or timeout relaxation was applied.
- Real-media integration coverage includes actual cropped delayed audio, later/disjoint offsets, fresh IDs, GPU fallback arguments, cleanup-before-publication, combined translation failure/cancellation, committed-outcome cancellation boundaries, original-only compilation/export with stored translations, bounded review prompts/coverage, report restart/ignore/provider invalidation and replacement recheck.
- Cross-layer inspection traced both import modes through schemas/preload/IPC/download callback/storage; all translation APIs guard original-only mode, and the shared content rule feeds live/native captions and ASS/SRT/VTT/video compilation. Main recomputes revision-guarded targets and partial operations publish content plus final stage in one transaction after owned cleanup. Review metadata retains media revision/export validity and validates category/IDs/context/coverage.
- Native identity configuration uses the same generated vector/PNG/ICO family for renderer, BrowserWindow, executable and installer; coordinator inspected actual PE icon resources and ran isolated native/package smoke. Final repackaging is coordinator-owned.
- Desktop owner completed 19 distinct affected/new E2E cases across the task/regression runs. Final rebuilt layout and explicit-retry cases passed 2/2 (`final-layout-retry-e2e.log`). Strengthened assertions require both inline editor and processing panel viewport >=60px, gap target/effective scope and enabled execution visible after local scrolling, player >100px, proofreading >70px, and document scroll zero. Reviewer visually inspected refreshed minimum expanded inline and reprocessing screenshots: both retain the 75px local viewport, native player, toolbar and proofreading. Original-only real Electron workflow made 7 ASR / 3 review / 0 translation calls and wrote all five formats with unchanged source hash (`source-only-workflow.json`).

## Gate result

Integrated code/spec/lint/type/unit/integration/desktop quality check: **PASS**. Final packaged build and smoke after the CSS changes are coordinator-owned and must be appended to the task evidence before final delivery. Previously inspected PE icon resources remain the same identity; do not substitute an older packaged UI build for final smoke.

## Acceptance coverage

| Criteria | Evidence |
| --- | --- |
| AC1 identity/sidebar/menu | Shared icon assets, main menu suppression, native icon extraction; real Electron Alt/shortcut/collapse evidence |
| AC2 bounded editing | Actual 1440x960 and 1050x700 portrait/banner/inline screenshots; local editor/panel and document geometry assertions |
| AC3 original-only | Zero-translation generation/repair, explicit import modes, source-only live/native helpers/compiler, actual export workflow |
| AC4 compatibility | Legacy true default, mode toggles preserve stored text, source-only display ignores stored translations |
| AC5 target/offset | Recursive half-open expansion, nonadjacent/gap/edge tests, server plans, actual cropped delayed audio |
| AC6 guarded partial updates | Fresh IDs, unaffected cues/emphasis/export retention, busy/revision/input identity/cancellation guards |
| AC7 atomic combined work | Draft-only batches, translation error/cancel retention, owned cleanup before one successful publication |
| AC8 text-only review | Bounded cue/text/context batches, cumulative coverage, strict output, independent text service and retained prior report on failure |
| AC9 finding lifecycle | Persisted report/ignore, cue/provider fingerprints, fresh-ID recheck remapping, guarded acknowledgment and quick scope repair |
| AC10 verification | Unit/integration pass; final desktop/package evidence belongs to the coordinator and desktop-test owner |

All tests use isolated data and anonymous media. Deterministic HTTP/provider results establish workflow correctness, not acoustic/linguistic accuracy. No commits, task archival, installed-app replacement or user-process termination were performed by this reviewer.
