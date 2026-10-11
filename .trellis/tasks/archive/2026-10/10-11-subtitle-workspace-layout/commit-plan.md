# Scoped Commit Plan

Proposed commits (in order):

1. `feat: refine resizable subtitle workspace and application naming`
   Includes the final product layout, exact naming, meaningful unit/native regressions and synchronized frontend contracts.

   - `.trellis/spec/frontend/css-design.md`
   - `.trellis/spec/frontend/live-subtitle-preview.md`
   - `src/main/index.ts`
   - `src/renderer/index.html`
   - `src/renderer/src/App.tsx`
   - `src/renderer/src/components/PaneDivider.tsx`
   - `src/renderer/src/components/SecondaryControls.tsx`
   - `src/renderer/src/hooks/useWorkspaceLayout.ts`
   - `src/renderer/src/lib/layout-preferences.ts`
   - `src/renderer/src/styles/components.css`
   - `src/renderer/src/styles/editor-layout.css`
   - `src/renderer/src/styles/review-grades.css`
   - `src/renderer/src/styles/workspace.css`
   - `tests/e2e/contextual-review.spec.ts`
   - `tests/e2e/deepseek-live.spec.ts`
   - `tests/e2e/desktop.spec.ts`
   - `tests/e2e/download-settings.spec.ts`
   - `tests/e2e/export-original-web-codecs.spec.ts`
   - `tests/e2e/export-settings.spec.ts`
   - `tests/e2e/gpu-native.spec.ts`
   - `tests/e2e/helpers.ts`
   - `tests/e2e/inline-subtitles.spec.ts`
   - `tests/e2e/live-captions.spec.ts`
   - `tests/e2e/pane-resizing.spec.ts`
   - `tests/e2e/recognition-reset.spec.ts`
   - `tests/e2e/seeking.spec.ts`
   - `tests/e2e/subtitle-workspace.spec.ts`
   - `tests/unit/frontend/AppInlineSubtitles.test.tsx`
   - `tests/unit/frontend/AppRecognitionReset.test.tsx`
   - `tests/unit/frontend/PaneDivider.test.tsx`
   - `tests/unit/frontend/SecondaryControls.test.tsx`
   - `tests/unit/frontend/app-fixtures.ts`
   - `tests/unit/frontend/layout-preferences.test.ts`
   - `tests/unit/frontend/useWorkspaceLayout.test.tsx`

2. `chore(task): archive subtitle-workspace-layout`
   - Current task planning/research/verification/evidence only, moved under `.trellis/tasks/archive/2026-10/`; performed by `task.py archive` after the work commit.
   - Local ignored logs and generated test profiles/runtime/media/cache remain available but are not added by overriding ignore rules. The task evidence `.gitignore` preserves failure traces/screenshots/context for archive.

3. `chore: record journal`
   - `.trellis/workspace/jing/journal-1.md` and `.trellis/workspace/jing/index.md`; performed by `add_session.py`, referencing the work commit.

Unrecognized dirty files (NOT in any commit; proposed exclusion):

- `.trellis/spec/backend/index.md`
- `.trellis/spec/frontend/index.md`
- `.trellis/spec/shared/index.md`
- `tests/e2e/seeking-helpers.ts`
- `.agents/`
- `.claude/`
- `.codex/`
- `.dsh/`
- `.trellis/.gitignore`
- `.trellis/.template-hashes.json`
- `.trellis/.version`
- `.trellis/agents/`
- `.trellis/config.yaml`
- `.trellis/scripts/`
- `.trellis/spec/backend/export-preferences.md`
- `.trellis/spec/backend/online-download.md`
- `.trellis/spec/shared/media-streaming.md`
- `.trellis/spec/shared/native-runtime-testing.md`
- `.trellis/tasks/00-bootstrap-guidelines/`
- `.trellis/tasks/10-07-video-translation-subtitles/`
- `.trellis/workspace/index.md`
- `docs/development-environment.md`

`tests/e2e/seeking-helpers.ts` reports dirty but has no content diff; it is not included in the work commit. All other excluded paths existed before this task. No amend or push is planned.

All implementation/review/native verification is complete. The only pending confirmation is this batched commit/archive/journal plan, required by `.trellis/workflow.md` Phase 3.4 step 5: "Present the plan once, ask for one-shot confirmation".

Execution: user replied `行` on 2026-10-11. The approved 34-file work commit is `3492c81fee44123caa1aafd048861731e2304e4d`; archive/journal are performed next. Existing recent-history identity `Codex <codex@local.invalid>` is supplied only for these operations, without changing global/repository Git configuration.
