# Final integrated Trellis check

Reviewer: dispatched `trellis-check`, 2026-10-11. Scope: all original requirements and acceptance criteria plus the approved contextual four-grade refinement R10/AC11/AC12. This supersedes the pre-refinement `check-report.md` for code/spec quality. Final packaging and packaged smoke remain coordinator-owned.

## Findings (fixed)

- `src/renderer/src/styles/editor-layout.css` and `review-grades.css`: the strengthened 1050x700 native-window case combined a graded report, selected high cue, banner and partial-processing panel. Its 75px list extended beyond its own panel and the viewport (initial bottom 701.47; first compact fix still 672.78 versus viewport 661 and panel bottom 649). Removed the forced full-width current-position row, compacted local controls, reserved the actual 230px graded proofreading budget, and reduced minimum-window banner/stage/panel spacing. Preserved the video-stage 110px and editor/processing/list 75px minima. Final geometry is list top 565.78 / bottom 640.78 within panel bottom 649; video content 108px within its 110px stage; processing panel 83.625px with local scrolling. No test thresholds were relaxed or clipping used as a fix.
- `src/renderer/src/components/ReviewRubricHelp.tsx`: expose the shared rubric version as `标准版本：v1` derived from `REVIEW_RUBRIC_VERSION`, and describe none as `无 · 未发现明显疑点`. The rules/examples still come directly from the shared rubric. Updated assertions in `tests/unit/frontend/SubtitleReviewGrades.test.tsx` passed.
- Desktop-test owner strengthened `tests/e2e/contextual-review.spec.ts` to check parent bounds as well as viewport bounds, selected-grade and pending controls, shared help/version and access to the last rule through local scrolling. Migrated an obsolete source-only batch-button selector to the approved compact filter/select/repair flow; no production fallback was added for the old selector.
- `.trellis/spec/frontend/css-design.md`: recorded the actual control budget and required graded/selected/pending/banner minimum-window combinations. Coordinator synchronized the shared review/reprocessing and live-preview contracts, including primary active-text timing thresholds.
- Original reviewer fixes remain covered: scope-preserving failed-partial retry in `App.tsx`; both inline editors and processing panels retain a usable local viewport; original-only and translated failures cannot silently route a retained-cue repair through full generation. See the prior report for the original fix evidence.

## Findings (not fixed)

- Accepted product limit: review uses text/timestamps and cannot prove acoustic correctness or identify missing speech in an empty subtitle interval. Successful silent ASR may remove an old cue while retaining its captured-range suspicion as a recheck reminder. Users can locate/play or rerun that range; text recheck needs existing cues. No new audio-review interface was invented.
- Fixed rules/context reduce inconsistency but model rule selection and semantic evidence can still vary. Main validates IDs, exact coverage, closed rules, supplied neighbouring evidence and measurable timing prerequisites; it cannot mechanically prove every linguistic contradiction or omission. Deterministic fixtures verify contracts and interaction, not live-provider linguistic accuracy.
- `src/main/services/jobs/lib/reprocessing.ts` retains the old findings-only `validateReview` helper for one legacy validation test. It has no production review call path; production uses `validateAssessments`. Coordinator explicitly chose to leave unrelated cleanup for later. No runtime ambiguity or failing quality rule was found.

## Cross-layer review

- Shared `contextual-review-v1` owns 13 closed rule IDs, fixed low/medium/high mappings, examples and exclusions. Main accepts only target assessments and rule/reason/evidence, derives the maximum severity, and accepts none only from an explicit empty issue array. Missing, duplicate, foreign or malformed targets fail the entire scan. Model-supplied grades/categories/scores/patches are rejected.
- Canonical windows sort the full timeline and partition at 30 cues / 24k serialized characters, with up to two contiguous neighbours on each side within 8k. A selected recheck shrinks graded targets while retaining the same full-window context. Context hashes include core IDs, supplied IDs/fingerprints, mode and rubric version; inserts, removals, replacements, edits and partition changes invalidate dependent assessments, including prior none results. Unrelated context groups remain usable.
- Source contextual medium rules need target plus nearby evidence; sustained high breakdown needs at least two neighbours within two positions. High timing requires at least 20 non-whitespace Unicode code points of primary active text and <=500ms duration or >=45 characters/second. These are conservative application rules, not an industry timing standard or audio-alignment claim.
- Store refresh and profile invalidation retain honest current/recheck/legacy/unreviewed states. Provider/model, project mode and rubric changes stale all applicable assessment states. Fresh ASR IDs never inherit an old current grade. Renderer grade counts/filtering use only current assessments; ignored/stale/ungraded content is not inferred as none.
- Review calls the independent text provider only, with no audio or translation request. Draft all windows, validate complete coverage, recheck cancellation/revision/provider, then publish one metadata save. Failure/cancellation retains the old report. Scoped merges preserve unaffected valid or stale groups, and metadata changes preserve media revision/export validity.
- Original end-to-end translation mode remains explicit from both imports through schemas/preload/IPC/download/storage. All translation entry points guard original-only mode; live/native fullscreen and every caption/compiler/export path select source text in that mode even when stored translations exist.
- Partial recognition/translation retains main-side scope/revision/busy/source guards, real crop offsets, fresh IDs, draft combined work and owned cleanup before atomic publication. Failed combined work retains prior target content; translation-only retains IDs/source/timing; untouched cues/styles and historical outputs remain intact.
- Native menu suppression, accessible sidebar/icon identity and package resources are unchanged by the refinement. Their actual native/icon/export evidence remains applicable; final UI packaging must use the new build.

## Verification

- `npm test -- --maxWorkers=4`: **45 files / 421 tests passed**, after backend's 31 targeted tests had finished. This complete run includes the original regressions and contextual-rule/context-lifecycle cases.
- Renderer owner's affected frontend run: **16 files / 88 tests passed**. Following the help wording/version assertions, reviewer reran `SubtitleReviewGrades.test.tsx`: **7/7 passed**. These overlap the full suite and are not added to its distinct count. Subsequent production edits were CSS only.
- `npm run lint`: **pass**, rerun after final CSS/help changes.
- `npm run typecheck`: **pass**, rerun after final CSS/help changes.
- Desktop build: **pass**, final renderer assets `index-D2zVu9cU.css` / `index-BHqZnTWx.js` (`refinement-final-build.log`). Existing dependency annotation warnings were removed by Rollup without a build failure.
- Refinement affected Electron cases: contextual review, bounded workspace, import modes and source-only workflow all pass across coordinated batches. Final strengthened contextual and bounded-workspace cases passed **2/2** against the final build (`refinement-final-layout-contextual-e2e.log`). Across original and refinement stages there are **20 distinct affected/new E2E cases**, not 20 newly rerun after the refinement.
- Reviewer inspected final minimum selected and standards screenshots. Selected/pending/help list stays 75px and fits its parent/viewport; document scroll is zero; local processing and help scrolling work. The desktop owner also verified default/minimum windows, both sidebar states, portrait media, banners and long inline forms. Permanent geometry is in `contextual-layout-*-minimum.json` and `contextual-four-grade-workflow.json`.
- Contextual Electron evidence: 34 cues graded 30 none / 1 low / 2 medium / 1 high; cross-batch neighbour context, all four current-grade filters, high-only repair, unchanged unrelated cues, stale prior clear/flagged results after neighbour edits, unaffected groups, and legacy-ungraded distinctions. Actual Electron/preload/IPC/SQLite/FFmpeg ran against loopback deterministic provider responses, with 1 recognition / 4 review / 0 translation calls for this original-only case.
- Earlier broad native runs overlapped packaging or another broad test run and hit two 5-second process-spawn timeouts. Exact affected tests passed in isolation and the earlier complete four-worker run passed; this final 421-test four-worker run also passed. No timeout relaxation, broad process termination or production lifecycle workaround was used.

## Acceptance coverage

| Criteria | Evidence |
| --- | --- |
| AC1 identity/sidebar/menu | Shared assets; actual native/icon extraction and menu/Alt/collapse evidence; unchanged identity wiring |
| AC2 bounded editing | Final default/minimum portrait/banner/inline and graded-selected/pending/help parent geometry/screenshots |
| AC3 original-only | Both explicit imports, zero translation requests, source-only playback/fullscreen and five-format export evidence |
| AC4 compatibility | Legacy true default, stored translation preservation, mode toggles and legacy-ungraded reports |
| AC5 target boundaries/offsets | Disjoint/gap/half-open expansion tests and actual cropped/delayed audio |
| AC6 guarded partial updates | Fresh IDs, untouched cues/emphasis, translation-only invariants, revision/busy/source tests |
| AC7 atomic combined processing | ASR/translation failure/cancellation, cleanup-before-publication and one final content/stage save |
| AC8 bounded text review | Independent text service, strict all-target schema, limits, old-report retention and no audio/translation calls |
| AC9 finding lifecycle | Persisted acknowledgment, metadata guards, provider/context invalidation, scoped repair and historical reminders |
| AC10 verification | 421 full-suite pass, targeted checks and final Electron evidence; final package smoke coordinator-owned |
| AC11 all-cue contextual grades | Canonical full/selected context parity, complete target coverage, max fixed severity, real four-filter workflow |
| AC12 fixed standards/honest staleness | Shared versioned 13-rule rubric/help, evidence thresholds, none-context invalidation, legacy/current distinction |

## Gate result

**PASS — integrated code/spec/lint/type/unit/integration/desktop quality gate for the full refined scope.** Final packaging/icon/resource/native smoke against this exact final build is coordinator-owned and must be recorded before delivery. This report does not claim that an older packaged UI satisfies the refined task.

No commits, task archival, user-data mutation, installed-app replacement or user-process termination were performed by this reviewer.
