# Independent release readiness review — 2026-10-18

Reviewer: `release_check`, independent of the guide, README and product implementers. This review owns release-policy inspection, final documentation accuracy and proportionate static/native verification. No source implementation, Git mutation, workflow dispatch, publication or paid-provider call was performed.

## Release policy and remote evidence

- Read `.github/workflows/release.yml`, `scripts/release.cjs`, `scripts/release.test.cjs`, package scripts and `docs/releasing.md` against the current source. The workflow publishes only `linglan111/slice-man` at `refs/heads/release`, on a push or an explicitly selected release-branch manual run. Main/development pushes do not publish.
- The workflow does **not** increment a version. `releaseContext` requires stable numeric major.minor.patch and equal versions in `package.json`, lockfile root and lockfile `packages[""]`. All three final values are now `0.1.5`; dependency versions are unchanged.
- Read-only `git ls-remote --heads --tags origin` found main, release and `v0.1.4` all at `e50d46d23932d77e49e0711f174c74323161e1b4`; no `v0.1.5` tag. GitHub public REST found only stable published `v0.1.4`, published `2026-10-11T09:20:12Z`, with installer `Slice-Man-Setup-0.1.4.exe` (186135264 bytes) and `SHA256SUMS.txt`, both uploaded with SHA-256 digests. Therefore stable `0.1.5` is the appropriate next version. Reusing `0.1.4` would deliberately skip publication.
- At audit start, working branch HEAD was `bf8702d` and `git rev-list --left-right --count e50d46d...HEAD` returned `0 27`: it includes the remote baseline and 27 local commits. Preserve that history when integrating main/release; publishing only the last docs commit would omit earlier functionality. Leader owns fetch/integration and exact scoped staging; unrelated AGENTS/workflow/spec indexes/platform/bootstrap/seeking-helper files are excluded unless separately authorized.
- `plan` first runs release-policy tests. A new version then runs Windows dependency/resource/fixture preparation, lint, typecheck, the full Electron-ABI unit/integration suite, full desktop suite, NSIS build and packaged startup check. A matching installer/checksum artifact is uploaded before `publish`. Publishing uses the `production-release` environment, creates a fixed commit tag and draft, checks server-side asset size/digest, then exposes the stable release. Existing tags/assets are never overwritten. Network/fixture availability, CI regressions and any configured environment gate remain real remote prerequisites.
- `gh` was absent from PATH and three common Windows install locations. Read-only public REST via `Invoke-RestMethod` works without credentials. Most recent observed release run `38128045803` succeeded at the old SHA; its main-branch companion `38128043351` skipped. These old runs do not verify the new release. Leader must inspect the new run, exact tested SHA/tag and both published assets after push.

## Final guide and documentation review

Reviewed final `FeatureGuide.tsx`, its existing traversal assertions, README, linked English workflow guide, guide spec and `docs/releases/v0.1.5.md` against shared schemas, chapter planning/scheduling, repair and layout code paths.

- Copy correctly places integer 1–16/default 2 text concurrency in API service settings, removes the old 30-minute review bypass and 1–3 job-setting guidance, explains complete chapter requests and capacity failure, and exempts speech recognition and whole-timeline names.
- Repair explains fresh recognition and enabled translation for every eligible target, old/new contextual audit, atomic round publication, reassessment, final pending-assessment closure without another round, honest cap/failure/cancel outcomes and source-only zero translation.
- Guide remains six informational steps with unchanged Modal/navigation/focus/startup behavior. It describes the temporary operation divider and capped automatic fitting, upper-left help, lower-left settings, explicit name apply/undo and request progress accurately. The guide spec is synchronized.
- README/English usage distinguish current functionality, data disclosure, logs versus ephemeral reasoning, no-clobber exports, manual download continuation and verification boundaries. Historical 935-test/53-desktop evidence is not presented as a new docs-era rerun. All local Markdown targets in README/usage exist.
- Initial documentation finding: `docs/releasing.md` still described current/first release `0.1.4` after the chosen `0.1.5` update. The documentation owner fixed this with leader authorization: current version now defers to Latest Release, packaging paths/asset names explicitly illustrate 0.1.5, and the obsolete first-release assertion is removed. Independently re-read the final diff and complete changed paragraphs; the policy, safe output paths and version description now agree. No remaining documentation finding.

## Verification performed on final guide/product tree

| Command/check | Result |
| --- | --- |
| `npm run lint` | PASS, exit 0 |
| `npm run typecheck` | PASS, exit 0 |
| `node --test scripts/release.test.cjs` | PASS, 12 release-policy/checksum cases, zero failures/skips |
| `npm test -- tests/unit/frontend/FeatureGuide.test.tsx tests/unit/frontend/AppFeatureGuide.test.tsx tests/unit/frontend/useWorkspaceLayout.test.tsx tests/unit/frontend/WorkspaceSettings.test.tsx` | PASS, 4 files / 20 tests, Electron wrapper |
| `npm run build` | PASS; only upstream Zod annotation warnings removed by Rollup |
| `npx playwright test tests/e2e/onboarding.spec.ts tests/e2e/operation-workspace.spec.ts tests/e2e/pane-resizing.spec.ts` | PASS, 8 tests / 39.3 s, zero failures/retries/skips |
| README/usage local Markdown links and scoped `git diff --check` | PASS |

The 8 desktop cases cover six-step guide geometry at native 1920x1080, 1440x960 and 1050x700, native focus containment, four persisted dismissal modes/restart, saved content/active mocked review noninterference, all operation controls with local scrolling/capped fit, pointer/keyboard divider bounds and restart/reset. They use real Electron/preload/IPC/SQLite and isolated local HTTP fixtures, not paid AI or acoustic accuracy evidence.

An additional isolated real Electron launch inspected all six steps at native minimum 1050x700 (actual content area 1034x661), scrolled each last paragraph into view and checked footer bounds. No step needed content overflow at this size; the longest step 4 body was 388 px and footer ended at 592 px. Independently viewed both step-4 and step-5 screenshots: readable text and reachable footer actions, no clipping. Evidence: `../evidence/release-guide-geometry.json`, `../evidence/release-guide-step4-1050x700.png`, `../evidence/release-guide-step5-1050x700.png`.

Guide implementer separately reports 11 guide/App tests and 12 release-policy tests passing in `guide-update.md`. The 20 unit, 12 release-policy and 8 desktop results above are this reviewer's independent execution. Earlier 935 unit/integration and 53 desktop passes are baseline evidence in `leader-acceptance.md`; no broad/native/paid suite was repeated here.

## Disposition

No product-code or guide behavior defects found. The outdated release-process prose was fixed by its documentation owner and independently accepted after a read-only final diff review; no findings remain. No checks were repeated for that prose-only final change. Local checks pass; final remote Actions build/package smoke/publication and artifact verification remain leader-owned acceptance work and are not claimed complete by this report.
