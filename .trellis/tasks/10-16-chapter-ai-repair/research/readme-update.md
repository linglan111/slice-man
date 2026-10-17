# Current product documentation update — 2026-10-18

## Owned scope

- Rewrote `README.md` in Chinese around product capabilities, installation, a usable first-run sequence, shared chapters/concurrency, review/repair/names, data/export constraints, development and release workflow.
- Rewrote the linked `docs/usage.en.md` to remove contradictory historical workflow descriptions and retain more detailed English instructions.
- Added the leader-requested short `docs/releases/v0.1.5.md`; `scripts/release.cjs` loads the versioned notes automatically.
- Updated the leader-authorized stale current-release statements in `docs/releasing.md` to defer to Latest Release, use explicitly illustrative 0.1.5 command paths, and remove the obsolete first-release 0.1.4 assertion.
- This teammate did not change application source, FeatureGuide, screenshots, package versions, release configuration or other contributors' files. No Git staging, commits, pushes, build, test-suite execution, packaging or service calls were performed.

## Facts checked against current source

| Documentation contract | Source inspected |
| --- | --- |
| Local models, text protocols and profile concurrency default 2 / range 1–16 | `src/shared/contracts.ts`, `src/shared/ipc-validation.ts`, `src/renderer/src/components/ProfileEditor.tsx` |
| Same-profile shared text limit, including names; speech remains separate | `src/main/services/providers/lib/text-concurrency.ts`, relevant JobService call sites |
| Reusable normal chapters, short coverage plan, complete chapter transport, explicit capacity rejection | `normalPlan`, `chapterTranslation`, `reviewDraft` in `src/main/services/jobs/lib/job-service.ts`; `chapter-work.ts`, `chapters.ts`, `review-request.ts` |
| Recognition/name exemption, whole-timeline evidence and bounded correction | `analyzeNames` in JobService, `person-name-request.ts`, `person-names.ts`, shared person-name spec |
| Fresh ASR and enabled translation, old/new audit, atomic round, recheck/final-consistency/cap outcomes | `repairLoop` in JobService, `repair-loop.ts`, `RepairLoopControls.tsx`, current task PRD/design |
| Visible phases, rounds, queue and concurrent entries | `ProcessingProgress.tsx`, `ChapterPanel.tsx`, `App.tsx` |
| Automatic 45% cap, minimum video space, temporary manual height and persisted other dimensions | `useWorkspaceLayout.ts`, `layout-preferences.ts` |
| First-run entry availability and guide location | `App.tsx`: generation/style settings exist only with an imported job, while API services/local engine remain available before import; upper-left utility guide button |
| Formats, codec/resolution and link settings | Shared export/download contracts, existing owning service documentation |
| Answer files, ephemeral reasoning and log retention | `provider-diagnostics.ts`, `live-streams.ts`, shared chapter/artifact spec |
| npm commands, resource preparation, Electron SQLite ABI | `package.json`, `scripts/test-unit.cjs`, native runtime testing spec, development guide |
| Unsigned Windows x64 NSIS, release-only publishing and versioned notes | `electron-builder.yml`, `.github/workflows/release.yml`, `scripts/release.cjs` |

## Verification performed

- A read-only Python check passed for all three public Markdown files: UTF-8 decoding, balanced fenced code blocks, all **10 local file/image links**, and all **24 `npm run` references** against the current package scripts.
- The same check rejected known stale phrases: the 30-minute review bypass, the old 1–3 limit, the prohibition on operation-height dragging, and category-only recognition/retranslation repair routing. None remain.
- `git diff --check -- README.md docs/usage.en.md docs/releases/v0.1.5.md` passed. Git printed only the repository's usual LF-to-CRLF conversion notices.
- Read the resulting documentation and source-based first-run sequence; corrected an early draft that instructed opening generation settings before importing a project.
- Kept the version-independent `/releases/latest` download link. Existing public repository URL patterns were retained; no network availability check was performed.
- After the independent reviewer identified the stale release guide, the authorized narrow fix passed a final check of **4 public documents, 10 local links and 27 npm script references**, UTF-8/fence validation and scoped `git diff --check`. No additional tests were requested or run.

## Evidence boundaries and follow-up

The old README's dated 771-test claim was removed rather than replaced with a misleading current aggregate. The task's 935-test / 53-desktop baseline predates the height increment; the layout's focused checks remain separate in leader evidence. Public docs now defer verification to the source/build's actual reports. Release notes describe CI checks without claiming the pending 0.1.5 Actions run has already succeeded.

The existing workspace image remains an overview; no new screenshot or visual-rendering claim was added. Windows 10, clean-machine installation/upgrade, all-provider compatibility, universal GPU support and linguistic accuracy are not inferred from prior checks. Independent review and final Git/release operations remain with the leader and the separately assigned reviewer.
