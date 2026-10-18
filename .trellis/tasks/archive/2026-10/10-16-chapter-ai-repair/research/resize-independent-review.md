# Independent operation-height review

Date: 2026-10-17. Reviewer: resize_review (independent of resize_finish).

## Scope and result

Product review passes with no blocking product findings. Scope is the approved packaging follow-up only: App operation identity/divider/content wrapper, useWorkspaceLayout, operation-workspace CSS, focused layout tests and necessary superseded assertion updates. Other accepted AI changes in the shared working tree were not re-reviewed or modified.

Verified source behavior:

- Operation identity distinguishes generation/style/export/names/chapters, partial recognition/translation and individual preview editors. Job/identity changes clear temporary manual allocation before paint.
- Natural measurement includes content plus card padding/borders. Automatic allocation is capped at 45% of middle-column height and the measured preview chrome plus 110px media floor. Manual allocation can exceed the automatic cap within the preview safety bound.
- Resize/mutation measurements preserve manual height. Operation change, close/reopen and layout reset return to automatic fitting. Temporary operation values never enter persisted layout preferences.
- The divider occupies the existing gutter and reuses PaneDivider pointer capture, cancellation, axis-aware arrows, Shift, Home/End and accessible separator values. Closing removes the card/divider and lets the preview flex into the released space.
- The flow-root content wrapper keeps natural height measurable while the outer card scrolls. Existing sidebar/column/results allocation remains intact.
- The frontend operation-workspace spec has been updated for the approved temporary divider and capped fitting contract.

## Findings (fixed)

- File: tests/e2e/operation-workspace.spec.ts
  - Issue: Old zero-height-divider and always-unscrolled expectations contradicted the new approved capped layout. Bounds were checked against the unbounded inner form instead of its actual scrolling card.
  - Fix: Implementer updated the separator assertion, 45% automatic cap assertion and local-scroll/hit-test helper. Independently inspected the narrow diff; no product changes were needed.
- Files: tests/unit/frontend/WorkspaceSettings.test.tsx and tests/e2e/pane-resizing.spec.ts
  - Issue: The opened-operation test still assumed the operation's direct parent was the card despite the new measurement wrapper; both files asserted absence of an obsolete divider label.
  - Fix: After the leader expanded ownership narrowly, the implementer changed the card lookup to closest('.workspace-operation-card'), checked the new divider immediately before that card and checked the new divider after opening a preview editor. Independently inspected the final test-only diff and accepted it. The owner reports WorkspaceSettings passed 3/3 under the Electron ABI wrapper.

## Findings (not fixed)

- None. No product changes were required from independent review; all concrete test drift findings were corrected by the implementer and re-inspected.

## Verification

- Lint: PASS, independently ran `npm run lint` (exit 0).
- TypeCheck: PASS, independently ran `npm run typecheck` (exit 0).
- Tests: PASS, independently ran `npm test -- tests/unit/frontend/useWorkspaceLayout.test.tsx tests/unit/frontend/PaneDivider.test.tsx`: 2 files, 12 tests passed under the Electron ABI wrapper.
- Additional owner verification: `npm test -- tests/unit/frontend/WorkspaceSettings.test.tsx`: 1 file, 3 tests passed after the final structural assertion update. No redundant rerun was requested by the leader.
- Coverage includes natural fit/cap/media floor, content-change manual retention, cancelled manual drag, operation switches, close/reopen/reset, unchanged persistence and existing separator keyboard/cancel lifecycle.
- No broad regression, paid provider request or installer execution was performed for this delta. Prior 935-unit/53-desktop-pass/10-skip evidence belongs to the pre-follow-up baseline and is not claimed for the new layout. Native installed-build interaction remains the user's requested manual validation.
- Packaging execution is a separate teammate responsibility; the read-only artifact review below does not claim a clean installation.

## Read-only package verification

After packaging, independently inspected the installer and extracted ASAR entries in memory using the installed @electron/asar API. Did not launch any application, installer or additional test.

- Installer: `F:/Code/slice man/dist/verification-0.1.5-preview.10-20261017/Slice Man Setup 0.1.5-preview.10.exe`.
- Size independently measured: 186,186,498 bytes.
- SHA-256 independently recomputed: `F1DBA283E527007C06CAD34E6D2B890654E2DA12C3225268F3FEA79F26A685C6`, matching the packaging report.
- Installer file/product versions both read as `0.1.5-preview.10`; packaged package.json independently extracted and also reads `0.1.5-preview.10`.
- app.asar SHA-256 independently recomputed: `5ED01934F1385D8C1BBD03BF9009A39499DBBD60587C3D73824D6CD521A282F5`.
- Enumerated all 5 current out/ files and independently compared their bytes to matching ASAR entries: all equal (main, preload, renderer HTML, renderer JS and CSS). Computed hashes match the packager's package-verification.json and package-preview10.md table.
- Read the packager's JSON/log evidence: isolated packaged host version `0.1.5-preview.10`, Electron 42.11.11/ABI146, dedicated preview user-data directory, native profile/runtime IPC success and required resources. These startup results are teammate evidence, not a second launch by this reviewer.
- Recomputed the existing `F:/Soft/Slice Man/Slice Man.exe` SHA-256: `1BA170A6C021F433E5A23581A7D25F2B0060E62FBF6AF52FC9165A8700E1A2A1`, matching the recorded before/after value.

Artifact review passes. No remaining findings; installer/manual interaction acceptance remains with the user as requested.
