# Operation height follow-up

User-approved narrow packaging follow-up, 2026-10-17. Continued the prior operation_resize implementation without replacing the existing AI changes.

## Behavior and files

- `src/renderer/src/App.tsx`: expose the existing horizontal PaneDivider between preview/toolbar and the bottom operation card. Use distinct operation identities for generation, style, exports, names, chapters, partial recognition/translation and preview cue editors (including a new cue).
- `src/renderer/src/hooks/useWorkspaceLayout.ts`: measure natural content through an unconstrained inner wrapper. Automatic allocation caps at 45% of the middle column and the available height after preview chrome plus a 110px video floor. Manual allocation is temporary, survives content measurements and supports cancellation/reset; changing operation or job clears it. Existing saved width/results preferences remain untouched.
- `src/renderer/src/styles/operation-workspace.css`: use the measured operation allocation and retain local overflow scrolling.
- `tests/unit/frontend/useWorkspaceLayout.test.tsx`: cover natural fitting, cap/video floor, manual retention, cancellation, all operation identities, close/reopen, reset, non-persistence and existing layout behavior.
- `tests/e2e/operation-workspace.spec.ts`: replace superseded no-height-divider/unbounded-form assumptions with the new divider/cap and local-scrolling accessibility checks.
- `tests/unit/frontend/WorkspaceSettings.test.tsx` and `tests/e2e/pane-resizing.spec.ts`: with the leader's narrow ownership extension, adapt the opened-card wrapper lookup and replace the old no-divider assertion with the new divider's presence. No additional product edits.

## Validation

- `npm run lint`: passed, repeated after the E2E assertion update.
- `npm run typecheck`: passed, repeated after the E2E assertion update.
- `npm test -- tests/unit/frontend/useWorkspaceLayout.test.tsx`: passed, 6/6 tests under the Electron ABI wrapper.
- `npm test -- tests/unit/frontend/WorkspaceSettings.test.tsx`: passed, 3/3 tests after the narrow structural-assertion update.
- `git diff --check -- <the five scoped source/test files>`: passed (Git reports only existing LF/CRLF normalization notices).

No backend/schema/persisted-setting changes, paid requests, broad regression rerun, build, installer launch, commit or archival were performed by this implementation teammate. Native layout/manual acceptance remains with the user on the separately packaged installer. Independent review and packaging are coordinated by the leader.
