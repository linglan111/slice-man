# 本次提交计划（已确认并执行工作提交）

开发分支：codex/subtitle-repair-onboarding。用户已明确回复“提交”；工作提交完成（f256881、ae806d1），随后执行已批准的归档/日志，不推送。

验证：lint/typecheck/build通过；60文件574项单元/集成通过；完整Electron40项=37通过/3实网或付费条件未启用/0失败。证据：evidence/final-added-e2e-review.md、final-unit.log、final-added-full-native.log。

## 1. feat(subtitles): streamline review, repair and workspace tools

- src/main/db/store.ts
- src/main/ipc/index.ts
- src/main/services/jobs/lib/job-service.ts
- src/main/services/jobs/lib/person-names.ts
- src/main/services/jobs/lib/repair-loop.ts
- src/main/services/jobs/lib/review-request.ts
- src/preload/index.ts
- src/renderer/src/App.tsx
- src/renderer/src/components/ExportDialog.tsx
- src/renderer/src/components/ExportVideoOptions.tsx
- src/renderer/src/components/FeatureGuide.tsx
- src/renderer/src/components/LiveVideoPreview.tsx
- src/renderer/src/components/PersonNamePanel.tsx
- src/renderer/src/components/RepairLoopControls.tsx
- src/renderer/src/components/SecondaryControls.tsx
- src/renderer/src/components/StyleOperation.tsx
- src/renderer/src/components/StylePanel.tsx
- src/renderer/src/components/SubtitleList.tsx
- src/renderer/src/hooks/useWorkspaceLayout.ts
- src/renderer/src/lib/onboarding-preferences.ts
- src/renderer/src/lib/review-presentation.ts
- src/renderer/src/styles/feature-guide.css
- src/renderer/src/styles/index.css
- src/renderer/src/styles/operation-workspace.css
- src/renderer/src/styles/person-names.css
- src/renderer/src/styles/repair-loop.css
- src/shared/channels.ts
- src/shared/contracts.ts
- src/shared/ipc-validation.ts
- src/shared/person-name-contracts.ts
- src/shared/reprocessing-contracts.ts
- tests/e2e/contextual-review.spec.ts
- tests/e2e/deepseek-live.spec.ts
- tests/e2e/desktop.spec.ts
- tests/e2e/export-original-web-codecs.spec.ts
- tests/e2e/export-settings.spec.ts
- tests/e2e/gpu-native.spec.ts
- tests/e2e/helpers.ts
- tests/e2e/inline-subtitles.spec.ts
- tests/e2e/live-captions.spec.ts
- tests/e2e/onboarding.spec.ts
- tests/e2e/operation-workspace.spec.ts
- tests/e2e/pane-resizing.spec.ts
- tests/e2e/person-names.spec.ts
- tests/e2e/recognition-reset.spec.ts
- tests/e2e/repair-loop.spec.ts
- tests/e2e/review-one-shot.spec.ts
- tests/e2e/seeking.spec.ts
- tests/e2e/subtitle-workspace.spec.ts
- tests/integration/backend/person-names.test.ts
- tests/integration/backend/reprocessing.test.ts
- tests/unit/backend/ipc-check.test.ts
- tests/unit/backend/person-names.test.ts
- tests/unit/backend/review-request.test.ts
- tests/unit/backend/store.test.ts
- tests/unit/frontend/AppFeatureGuide.test.tsx
- tests/unit/frontend/AppOperations.test.tsx
- tests/unit/frontend/AppRecognitionReset.test.tsx
- tests/unit/frontend/AppRepairLoop.test.tsx
- tests/unit/frontend/AppSubtitleWorkflow.test.tsx
- tests/unit/frontend/ExportPreferences.test.tsx
- tests/unit/frontend/FeatureGuide.test.tsx
- tests/unit/frontend/PersonNamePanel.test.tsx
- tests/unit/frontend/RepairLoopControls.test.tsx
- tests/unit/frontend/SecondaryControls.test.tsx
- tests/unit/frontend/SubtitleReviewGrades.test.tsx
- tests/unit/frontend/app-fixtures.ts
- tests/unit/frontend/onboarding-preferences.test.ts
- tests/unit/frontend/review-presentation.test.ts
- tests/unit/frontend/useWorkspaceLayout.test.tsx

## 2. docs(subtitles): document batch review and reversible name edits

- README.md
- docs/usage.en.md
- .trellis/spec/frontend/live-subtitle-preview.md
- .trellis/spec/frontend/feature-guide.md
- .trellis/spec/frontend/operation-workspace.md
- .trellis/spec/shared/subtitle-review-reprocessing.md
- .trellis/spec/shared/person-name-review.md

## 不纳入本次提交的已有改动

以下路径在本任务启动时已存在，保持原样，不暂存；包括已有规范索引、Trellis配置/脚本、旧任务和单独的换行改动。

- .agents/
- .claude/
- .codex/
- .dsh/
- .trellis/.gitignore
- .trellis/.template-hashes.json
- .trellis/.version
- .trellis/agents/
- .trellis/config.yaml
- .trellis/scripts/
- .trellis/spec/backend/export-preferences.md
- .trellis/spec/backend/index.md
- .trellis/spec/backend/online-download.md
- .trellis/spec/frontend/index.md
- .trellis/spec/shared/index.md
- .trellis/spec/shared/media-streaming.md
- .trellis/spec/shared/native-runtime-testing.md
- .trellis/tasks/00-bootstrap-guidelines/
- .trellis/tasks/10-07-video-translation-subtitles/
- .trellis/tasks/10-11-subtitle-workspace-layout/
- .trellis/workspace/index.md
- tests/e2e/seeking-helpers.ts

## 工作提交之后的记账

归档本次父任务及五个子任务（PRD/设计/研究/上下文/匿名测试证据），然后记录会话。使用Trellis的独立归档/日志提交，不夹入工作提交；不纳入上列旧任务，不推送或发布，也不改变版本/release分支。

范围：
- .trellis/tasks/10-11-first-run-guide/
- .trellis/tasks/10-11-operation-workspace/
- .trellis/tasks/10-11-person-name-review/
- .trellis/tasks/10-11-repair-and-onboarding/
- .trellis/tasks/10-11-review-reliability/
- .trellis/tasks/10-11-risk-repair-loop/

## 确认

按 .trellis/workflow.md Phase3.4 step5 “Present the plan once, ask for one-shot confirmation”，请一次确认上述两次工作提交、排除项和随后归档/日志。回复“行/ok”执行；回复修改意见调整计划；“我自己来/manual”则由用户自行提交。

## 执行记录2026-10-12

- f25688192762fe1b14959d1666639a312a7931d0：功能与测试70文件。
- ae806d19e9bf49265163fbf2f12124e52fdaec43：README/规范7文件。
- 本次父任务及五个子任务的归档/日志已获用户同次授权；无推送/发布。
