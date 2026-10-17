# Approved commit and official release plan

The user explicitly authorized commit/push main, merge release and GitHub packaging on 2026-10-18. This supersedes the earlier pending confirmation. Preserve unrelated paths; no force-push, tag replacement or installer upload from an untested build.

## 1. feat(ai): batch chapter workflows and audit subtitle repair

- `.trellis/spec/frontend/operation-workspace.md`
- `.trellis/spec/shared/ai-chapters-and-artifacts.md`
- `.trellis/spec/shared/person-name-review.md`
- `.trellis/spec/shared/subtitle-review-reprocessing.md`
- `.trellis/tasks/10-16-chapter-ai-core/check.jsonl`
- `.trellis/tasks/10-16-chapter-ai-core/design.md`
- `.trellis/tasks/10-16-chapter-ai-core/implement.jsonl`
- `.trellis/tasks/10-16-chapter-ai-core/implement.md`
- `.trellis/tasks/10-16-chapter-ai-core/implementation-evidence.md`
- `.trellis/tasks/10-16-chapter-ai-core/prd.md`
- `.trellis/tasks/10-16-chapter-ai-core/task.json`
- `.trellis/tasks/10-16-chapter-ai-names/check.jsonl`
- `.trellis/tasks/10-16-chapter-ai-names/design.md`
- `.trellis/tasks/10-16-chapter-ai-names/implement.jsonl`
- `.trellis/tasks/10-16-chapter-ai-names/implement.md`
- `.trellis/tasks/10-16-chapter-ai-names/prd.md`
- `.trellis/tasks/10-16-chapter-ai-names/research/implementation-evidence.md`
- `.trellis/tasks/10-16-chapter-ai-names/task.json`
- `.trellis/tasks/10-16-chapter-ai-progress/check.jsonl`
- `.trellis/tasks/10-16-chapter-ai-progress/design.md`
- `.trellis/tasks/10-16-chapter-ai-progress/implement.jsonl`
- `.trellis/tasks/10-16-chapter-ai-progress/implement.md`
- `.trellis/tasks/10-16-chapter-ai-progress/prd.md`
- `.trellis/tasks/10-16-chapter-ai-progress/research/implementation-evidence.md`
- `.trellis/tasks/10-16-chapter-ai-progress/task.json`
- `.trellis/tasks/10-16-chapter-ai-repair-loop/check.jsonl`
- `.trellis/tasks/10-16-chapter-ai-repair-loop/design.md`
- `.trellis/tasks/10-16-chapter-ai-repair-loop/implement.jsonl`
- `.trellis/tasks/10-16-chapter-ai-repair-loop/implement.md`
- `.trellis/tasks/10-16-chapter-ai-repair-loop/prd.md`
- `.trellis/tasks/10-16-chapter-ai-repair-loop/research/implementation-evidence.md`
- `.trellis/tasks/10-16-chapter-ai-repair-loop/task.json`
- `.trellis/tasks/10-16-chapter-ai-repair-loop/verification.md`
- `.trellis/tasks/10-16-chapter-ai-repair/check.jsonl`
- `.trellis/tasks/10-16-chapter-ai-repair/design.md`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/actual-failed-repair-retention.json`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/actual-final-ui-inspection.json`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/actual-names-result.json`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/actual-repair-final-status.png`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/actual-repair-final.png`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/actual-repair-result.json`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/actual-repair-startup-race.png`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/actual-services-ledger.json`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/actual-services-result.json`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/concurrent-progress-1050.png`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/concurrent-progress-1440.png`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/desktop-final-summary.json`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/progress-hit-testing.json`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/release-guide-geometry.json`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/release-guide-step4-1050x700.png`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/release-guide-step5-1050x700.png`
- `.trellis/tasks/10-16-chapter-ai-repair/evidence/runtime-verification.md`
- `.trellis/tasks/10-16-chapter-ai-repair/implement.jsonl`
- `.trellis/tasks/10-16-chapter-ai-repair/implement.md`
- `.trellis/tasks/10-16-chapter-ai-repair/prd.md`
- `.trellis/tasks/10-16-chapter-ai-repair/research/bug-retrospective.md`
- `.trellis/tasks/10-16-chapter-ai-repair/research/commit-plan.md`
- `.trellis/tasks/10-16-chapter-ai-repair/research/coordination.md`
- `.trellis/tasks/10-16-chapter-ai-repair/research/final-independent-review.md`
- `.trellis/tasks/10-16-chapter-ai-repair/research/guide-update.md`
- `.trellis/tasks/10-16-chapter-ai-repair/research/leader-acceptance.md`
- `.trellis/tasks/10-16-chapter-ai-repair/research/original-names-diagnostic.json`
- `.trellis/tasks/10-16-chapter-ai-repair/research/package-preview10.md`
- `.trellis/tasks/10-16-chapter-ai-repair/research/readme-update.md`
- `.trellis/tasks/10-16-chapter-ai-repair/research/release-readiness.md`
- `.trellis/tasks/10-16-chapter-ai-repair/research/repair-independent-review.md`
- `.trellis/tasks/10-16-chapter-ai-repair/research/resize-followup.md`
- `.trellis/tasks/10-16-chapter-ai-repair/research/resize-independent-review.md`
- `.trellis/tasks/10-16-chapter-ai-repair/research/source-findings.md`
- `.trellis/tasks/10-16-chapter-ai-repair/task.json`
- `src/main/services/jobs/lib/chapter-work.ts`
- `src/main/services/jobs/lib/chapters.ts`
- `src/main/services/jobs/lib/job-service.ts`
- `src/main/services/jobs/lib/person-name-request.ts`
- `src/main/services/jobs/lib/person-names.ts`
- `src/main/services/jobs/lib/repair-adjudication.ts`
- `src/main/services/jobs/lib/repair-loop.ts`
- `src/main/services/jobs/lib/review-request.ts`
- `src/main/services/providers/lib/live-streams.ts`
- `src/main/services/providers/lib/text-concurrency.ts`
- `src/main/services/providers/lib/text-provider.ts`
- `src/main/services/providers/lib/text-request.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/ChapterPanel.tsx`
- `src/renderer/src/components/JobSettings.tsx`
- `src/renderer/src/components/ProcessingProgress.tsx`
- `src/renderer/src/components/ProfileEditor.tsx`
- `src/renderer/src/components/ProviderLiveDialog.tsx`
- `src/renderer/src/components/RepairLoopControls.tsx`
- `src/renderer/src/hooks/useWorkspaceLayout.ts`
- `src/renderer/src/styles/chapters.css`
- `src/renderer/src/styles/operation-workspace.css`
- `src/renderer/src/styles/processing-progress.css`
- `src/shared/ai-work-contracts.ts`
- `src/shared/contracts.ts`
- `src/shared/ipc-validation.ts`
- `src/shared/provider-diagnostics-contracts.ts`
- `src/shared/reprocessing-contracts.ts`
- `tests/e2e/chapter-ai-live.spec.ts`
- `tests/e2e/chapter-ai-progress.spec.ts`
- `tests/e2e/chapter-provider-dependency.spec.ts`
- `tests/e2e/chapters-streaming.spec.ts`
- `tests/e2e/desktop.spec.ts`
- `tests/e2e/helpers.ts`
- `tests/e2e/operation-workspace.spec.ts`
- `tests/e2e/pane-resizing.spec.ts`
- `tests/e2e/person-names.spec.ts`
- `tests/e2e/repair-loop.spec.ts`
- `tests/e2e/responses-helpers.ts`
- `tests/e2e/responses-reasoning.spec.ts`
- `tests/e2e/review-one-shot.spec.ts`
- `tests/integration/backend/chapter-diagnostics.test.ts`
- `tests/integration/backend/person-names.test.ts`
- `tests/integration/backend/reprocessing.test.ts`
- `tests/unit/backend/chapter-workflows.test.ts`
- `tests/unit/backend/live-streams.test.ts`
- `tests/unit/backend/person-names.test.ts`
- `tests/unit/backend/provider-streaming.test.ts`
- `tests/unit/backend/store.test.ts`
- `tests/unit/backend/text-concurrency.test.ts`
- `tests/unit/frontend/AppAiStream.test.tsx`
- `tests/unit/frontend/ChapterPanel.test.tsx`
- `tests/unit/frontend/ProcessingProgress.test.tsx`
- `tests/unit/frontend/ProfileEditor.test.tsx`
- `tests/unit/frontend/WorkspaceSettings.test.tsx`
- `tests/unit/frontend/useWorkspaceLayout.test.tsx`

## 2. chore(release): align guides and prepare v0.1.5

- `.trellis/spec/frontend/feature-guide.md`
- `README.md`
- `docs/releases/v0.1.5.md`
- `docs/releasing.md`
- `docs/usage.en.md`
- `package-lock.json`
- `package.json`
- `src/renderer/src/components/FeatureGuide.tsx`
- `tests/unit/frontend/FeatureGuide.test.tsx`

## Integration and release

Both work commits include the existing27-commit development history by fast-forwarding main; do not cherry-pick only the last commit. Push main normally, fast-forward release to main and push it to trigger the existing workflow. Track plan/build/publish and verify stablev0.1.5 installer/checksum assets. After success, archive these4children and parent, record journal and push bookkeeping to main. No unrelated tasks are archived.

## Excluded unrelated status entries

- `.trellis/spec/backend/index.md`
- `.trellis/spec/frontend/index.md`
- `.trellis/spec/shared/index.md`
- `.trellis/workflow.md`
- `AGENTS.md`
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
- `.trellis/tasks/10-11-subtitle-workspace-layout/`
- `.trellis/workspace/index.md`
- `TODO.md`

dist/, .native-smoke/, temporary DBs, credentials and runtime caches are not committed. New official installer is generated only by the release branch workflow.
