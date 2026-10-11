# Independent Regression Review

Reviewed frozen task source on 2026-10-11. Ownership: this report only; no product/test changes while the separate Electron E2E worker runs. Known preexisting Trellis/tooling and spec-index changes were excluded from product scope.

## Verification

- `npm run lint`: pass, zero errors/warnings.
- `npm run typecheck`: pass.
- `npm test`: pass, **48 files / 440 tests**, 19.72 seconds. The Electron ABI unit runner was retained; no native dependency rebuild.
- `git diff --check`: pass; Git's LF/CRLF notices are not whitespace errors.
- Build / Electron E2E: owned by the separate worker, not executed or claimed by this reviewer.

## Findings (fixed)

None. Product/test source was explicitly frozen by the coordinating agent; fixes are being coordinated before final regression.

## Findings (not fixed)

### F1 — P2: Normal preview minimum omits 30px of the CSS video floor

- Files: `src/renderer/src/hooks/useWorkspaceLayout.ts:54`, `src/renderer/src/styles/editor-layout.css:46`, `:42-43`.
- Evidence: without an inline form the hook reserves `fixedHeight + 130`, but above the compact breakpoint CSS requires a **160px** video. Heading, toolbar and hint cannot shrink, and the preview clips overflow.
- Reproduction: translated project, expanded secondary controls, native 1440x960 or 1920x1080, no inline form; focus the preview/settings separator and press **Home** (minimum preview / maximum settings), or drag it upward to its limit. The video's enforced minimum leaves about 30px of fixed content outside the preview clip. This can hide the bottom preview action row/hint even though controls remain within the document viewport.
- Test gap: `tests/e2e/pane-resizing.spec.ts:83-133` checks preview action positions against `innerWidth/innerHeight`, not the preview panel's visible bounds. `fixedWorkspace` in `subtitle-workspace.spec.ts:88-157` similarly does not assert preview toolbar containment. Therefore a passing fixed-document test does not prove these actions are clickable.
- Recommendation: derive the active video minimum from measured/computed CSS or one shared renderer contract; add action/ancestor clipping containment and hit-target assertions at both secondary limits. Native reproduction requested from the worker through the coordinator.

### F2 — P2: Two simultaneously reachable inline forms are budgeted as one

- Files: `src/renderer/src/App.tsx:56`, `:144`, `:149-164`, `:203-204`; `src/renderer/src/hooks/useWorkspaceLayout.ts:54-60`; `src/renderer/src/styles/editor-layout.css:86-87`.
- Evidence: opening partial repair does not close the edit target; opening a preview edit/add does not close partial repair. Both forms render, while the hook receives only a Boolean and reserves one 85px form viewport. The CSS independently requires at least 85px for **each** mounted form.
- Reproduction: minimum native window, expanded settings; click Add preview subtitle and retain a draft, then click Recognize segment (or reverse the order). Drag the secondary separator to minimum preview and/or inline separator to maximum video. The second local form adds at least 85px plus margins to an allocation budgeting one form; the enclosing preview clips overflow.
- Test gap: the resize/layout E2E tests explicitly cancel the editor before opening repair. No coexistence regression verifies both draft and execution/cancel actions remain reachable.
- Recommendation: preserve both drafts and budget the actual mounted forms, or explicitly define a safe exclusive-mode interaction that does not silently discard unsaved text. This requires coordination because changing mode ownership is a judgment call. Native reproduction requested.

### F3 — P3: Welcome/loading view uses stale width and cannot reset its draggable sidebar

- Files: `src/renderer/src/hooks/useWorkspaceLayout.ts:15-18`, `:47-50`; `src/renderer/src/App.tsx:186`.
- Evidence: measurement returns before updating root width when job/grid/preview refs are absent. The initial width stays 1440, so a fresh 1050 window uses the noncompact 216px navigation default rather than 184px until a project loads. Sidebar adjustment is exposed on the welcome view, but the reset action is conditional on a job.
- Recommendation: measure root width independently of job refs, and make reset reachable wherever layout adjustment is exposed. Low severity: supported minimum width still accommodates the bounded 300px maximum.

## Additional Dynamic-State Coverage Required

Playback failure **arriving after** a minimum preview allocation deserves a native probe. `useWorkspaceLayout.ts:33-35` observes only children present when the effect is established; the effect has no playback-error dependency. `App.tsx:199` can insert an error paragraph and reload button while the video/panel are already at their CSS floors, so existing observed node sizes may remain unchanged and `fixedHeight` can stay stale. The worker should inject failure after an extreme drag and assert reload and preview actions remain inside the clip. This is a concrete code path requiring validation, not claimed here as a native reproduction.

The complete regression should also check blank/loading navigation adjustment/reset, actual pointer cancellation/hidden-handle cleanup, and native hit targets rather than only bounding boxes. Existing unit divider tests cover pointer cancel, lost capture, Escape and unmount; the native suite covers Escape and settings/navigation handle visibility.

## Data Flow and Existing Functions

- No changes to main/preload/shared contracts/database schemas. Millisecond timing, revision guards, cancellation, provider routing, style saving and export IPC signatures remain intact.
- `SubtitleList` and all callbacks retain their behavior while moving to the right. CRUD, selected/grade repair, review/ignore/recheck, seek/follow and list drafts remain outside the secondary disclosure.
- `SecondaryControls` uses a native button with expanded/controls semantics and a `hidden` content container. Children remain mounted, so toggling preserves local style drafts; unit tests verify this. Explicit preference persists independently from job data, sidebar collapse and dimension storage. Project changes remount the wrapper as designed.
- Generation/retry, source/translation/bilingual choices, profile/runtime links, styles and output history remain present inside the local settings scroller. Global import/profile/runtime/downloader/export-settings actions and header exports remain accessible without expanding secondary controls.
- Divider roles, axis-aware arrows, Shift increments, Home/End and value descriptions are present. Pointer capture is released on completion/cancel/unmount; cancellation restores the pre-drag preferences; commits persist ratios independently from Job data. Malformed stored preference shape and nonfinite fields recover to defaults.
- Existing E2E changes are primarily intentional disclosure setup and current-task evidence paths; old provider/export assertions were retained. New layout tests exercise native sizes, portrait/landscape, long names/text, review summaries, selected actions, both sidebar/disclosure states, local scroll, invalid form timing and editor/repair reachability, but the findings above expose untested combinations.

## Spec Synchronization

`frontend/css-design.md` still describes the older compact 230px proofreading reservation. Replace that obsolete rule with full-height right-panel scroll ownership, measured pane limits, independent disclosure/dimension preferences and clipping-aware regression assertions after repairs. The coordinator owns final spec synchronization.

## Recommendation

Do not mark the UI quality gate complete until F1/F2 and dynamic playback failure are resolved or disproved with native geometry/hit-target evidence, and the full available E2E result is recorded with explicit live-provider/download/GPU gates. Unit/lint/typecheck success alone does not establish end-to-end or visual correctness.

## Final Repair Recheck

The initial findings above are retained as the audit history. This section supersedes their open-code disposition after the implementer repair handoff.

### Findings (fixed by coordinated implementer)

- **F1 resolved in source:** `useWorkspaceLayout` now measures the active `.video-stage` computed `min-height` and uses it in secondary/inline limits. Wide, compact and inline CSS floors no longer disagree with a hardcoded 130px budget. The native resize assertions now check preview action bounds against their clipping panel and `elementFromPoint` hit targets.
- **F2 resolved in source:** scoped repair temporarily hides the existing mounted preview-editor wrapper; `[hidden]` is explicitly removed from flex layout. Closing repair reveals the same editor instance and unsaved fields. Returning to the same preview cue/new draft preserves its instance rather than constructing a fresh target. List editing can coexist with repair in the other column. The captured revision is retained: successful repair cannot silently rebase a preexisting draft against the new timeline; existing backend stale-revision protection remains authoritative.
- **F3 resolved in source:** root width updates without populated grid refs, and the reset button is available on the welcome/loading shell. Unit and native test setup cover a fresh 1050px shell, sidebar adjustment and reset.
- **Dynamic failed-video observation resolved in source:** a preview direct-child `MutationObserver` reconnects the `ResizeObserver` to the current children and measures immediately when error/reload controls appear or disappear. Both observers disconnect on cleanup. A focused hook regression covers insertion, removal, observation ownership and unmount cleanup; native late-error-at-minimum-allocation probes are present.

### Final Verification Executed by This Reviewer

- Lint: **pass**, zero errors/warnings.
- TypeCheck: **pass**.
- Full unit/integration suite: **49 files / 446 tests passed**, 20.70 seconds.
- Diff whitespace check: **pass**.
- Re-read renderer repair paths, unchanged divider/disclosure persistence, and the coordinator's `frontend/css-design.md` / `frontend/live-subtitle-preview.md` updates. Their final contracts agree with the implementation, and the obsolete 230px compact-panel reservation has been replaced.
- No product or test edits by this reviewer; this report remains the only owned write.

### Remaining Findings / Native Handoff

No remaining concrete product defect found in the repaired source. A test-only selector typo was reported to the coordinator: the native `previewHints` selector used `.error-text`, but the product error paragraph uses `.error-message`. The worker corrected that selector, so both the error paragraph containment and reload/button hit targets are covered in native assertions.

The user's final branding correction was independently checked in `src/main/index.ts:76`, `src/renderer/index.html:2` and `src/renderer/src/App.tsx:194`: native title, document title and visible workspace eyebrow are exactly `Slice Man`. These are three string changes with no behavior/API change. The updated PRD authorizes the correction, the design/spec contracts remain consistent, and whitespace validation passed. Native tests assert the titles/eyebrow; the coordinator was asked to repeat those assertions after import/restart to match AC7 precisely.

Final recommendation: the independent source/lint/type/unit review is clear. The end-to-end quality gate still depends on the separate worker's recorded build, targeted native clipping/failed-video/draft probes, complete available Electron suite, and explicit skip reasons. This reviewer has not executed or claimed that native result.

## Final Test-Only Adjustment Review

After the coordinator reported the first complete native run as 23 passed / 2 test-assumption failures / 3 gated skips, reviewed the worker's affected test changes independently. Product source is unchanged since the clear repair/branding review.

- **Download cancellation fixture:** only the generated 1280x720, 30-second lavfi source changes from static color to moving `testsrc2`. Actual software conversion remains required. The test still waits for a non-source converted partial file with nonzero bytes before clicking the real cancel action, asserts cancelled feedback, absence of partial directories, unchanged sentinel file bytes and unchanged imported-job count, then verifies persisted settings after restart. No timeout, cancellation guard or data-preservation assertion was removed.
- **Native backward timeline scrub:** still clicks Chromium's actual controls, with the point moved from 15% to 25% of the element to account for the progress track's insets. It now asserts `seeking === false` and actual settled `currentTime` in the edited cue's half-open `[0.5, 1.5)` interval before asserting the edited caption. Forward time remains above two seconds with the second cue caption. The later programmatic seek is not used to make the native-click assertion pass. Both observed native positions are saved as evidence. The one-second interior cue window avoids assuming element fraction equals timeline fraction.
- **Brand coverage:** a shared assertion checks native/document titles and workspace eyebrow exactly `Slice Man`, called after import and restart as well as the initial checks. This closes the AC7 gap.
- **Checks after these TypeScript test changes:** lint pass, typecheck pass, whitespace check pass. Unchanged unit/product code does not justify rerunning the already-green 49-file / 446-test suite.

No remaining source defect or weakened semantic test assertion found. Affected native tests and the final complete Electron rerun remain the worker's responsibility; their execution result must be recorded separately rather than inferred from this review.

## Final Evidence Audit

This section supersedes the earlier pending native handoff. A separate final evidence reviewer read the curated task context, reviewed the retained full-run JSON/log and inspected the final actual screenshots on 2026-10-11. Ownership was limited to this report and `research/e2e-report.md`; no product/test source or native runner was changed or launched.

- **Definitive complete result:** `evidence/full-e2e-final.json` contains 28 tests, **25 passed / 3 expected gated skips / 0 unexpected failures / 0 flaky tests**, duration **181.68573 seconds**, starting `2026-10-11T03:26:56.274Z`. All tests have one result with retry zero and no result errors; global errors are empty. Runner configuration uses one worker and zero retries. `evidence/full-e2e-final.log` independently confirms all three build stages passed and ends with 25 passed / 3 skipped.
- **External limits:** two DeepSeek live tests require the explicit live gate and a session-only key; one real YouTube/Bilibili download test requires its explicit gate and supplied URLs. Those three tests are skipped, not validated. Actual CPU and CUDA recognition did run and pass; the final GPU receipt independently verifies CUDA0 on the RTX 5070, and the separate CPU receipt records CPU execution. Deterministic loopback text/download tests do not establish live translation quality or current public-site extraction.
- **Final visual evidence:** inspected `resize-default-workspace-brand.png`, `resize-1050x700-translated-inline.png`, and `resize-1050x700-secondary-home-playback-error.png`, all written during the final full run. The visible brand is `Slice Man`; right proofreading and left preview/settings remain contained, minimum-width edit save/cancel and common actions are reachable, and the late error message/reload/native controls fit after the extreme preview allocation. No visual defect found. Transient loading indicators in default/inline captures are not used as playback evidence; separate native playback/decoded-frame tests pass.
- **AC coverage:** the final E2E report maps AC1–AC7 to the passing layout, scroll/persistence, long editor/repair, complete workflow, quality gate, four-divider and exact branding checks. The pane test checks actual native/document title before import and native/document/header values after import and restart; its visible default-width header is also checked before import. Clipping-parent/hit-target and dynamic error probes remain in the final test, not just historical targeted evidence.
- **Findings:** no remaining concrete defect or evidence inconsistency. F1/F2/F3 and dynamic failed-video observation remain resolved. The final test-only fixture/scrub repairs pass in the complete run without assertion relaxation. Earlier failures/interrupted logs remain retained as audit history, not substituted for the definitive pass.

The final independent source review plus the recorded native result satisfy the available task quality gate. Lint/typecheck and 49-file / 446-test verification retain their original executing reviewer attribution; they were not rerun by this evidence-only audit. Packaging/installation and the three external gated tests are not claimed as exercised.
