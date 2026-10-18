# Official 0.1.5 CI progress resize assertion

Date: 2026-10-18. Owner: ci_progress_fix. Independent reviewer: release_check.

## First failure retained

GitHub Actions run `39049675537`, attempt 1, release commit `c9c2e9a` failed only `chapter-ai-progress.spec.ts:78`: the stream viewer action's immediate minimum-window center hit-test returned false. The first log remains `.native-smoke/official-release/attempt1-build.log`; the extracted error context and native screenshot remain alongside it. A copy of that screenshot is `evidence/ci-progress-first-failure.png`. CI reported 936 passing unit tests and 51 passing / 11 explicitly gated skipped / 1 failing desktop tests. This failure is not relabeled as a pass.

## Diagnosis and change boundary

The unchanged focused native test passed once locally. A temporary diagnostic loop then held the existing two concurrent review streams and alternated the real Electron window between 1440×960 and 1050×700 twenty times. Immediately after each native `setSize`, it sampled the button, viewport, results clipping rectangle and scroll offset, then sampled five animation frames. All ten transitions to minimum size reproduced a false immediate hit-test:

| Sample | Actual renderer viewport | Button top | Button bottom | Direct center hit | Results scrollTop |
| --- | --- | --- | --- | --- | --- |
| Immediate minimum resize | 1034×661 | 664.09375 | 687.6875 | false | 0 |
| First animation frame | 1034×661 | 664.09375 | 687.6875 | false | 0 |
| Fifth animation frame | 1034×661 | 580.40625 | 604 | true | 0 |

Full diagnostic data is preserved in `evidence/ci-progress-resize-samples.json` and `.native-smoke/official-release/progress-resize-diagnostic/chapter-ai-progress-native-74e74-eaming-chapter-stay-visible/resize-samples.json`. The temporary loop was removed from the final test.

The viewport changes before `useWorkspaceLayout`'s ResizeObserver-driven pane allocation settles. `toBeVisible(rows)` does not establish that allocation has finished. Existing end-of-size cleanup already resets the outer results scroll offset; the diagnostic confirms the reproduced failure occurs with zero scrolling. The independent reviewer's extracted CI screenshot shows the settled action visible at minimum size, consistent with the diagnostic. No persistent product overflow was established, so renderer code and CSS remain unchanged.

Only `tests/e2e/chapter-ai-progress.spec.ts` changes executable behavior: await renderer dimensions matching the native content size, then use bounded Playwright polling for the exact original unscrolled bounds/center-hit predicate. A persistent offscreen or covered action still fails. There is no force click, action scrolling, CSS injection, viewport emulation or reduced assertion. All request-row focus/scrolling, single viewer counts, request counts and restart persistence assertions remain. Geometry now includes results bounds/scroll offset and is written from `finally` on failure as well as success.

## Verification

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test -- tests/unit/frontend/ProcessingProgress.test.tsx tests/unit/frontend/useWorkspaceLayout.test.tsx`: 2 files / 10 tests passed under the Electron ABI wrapper.
- `npm run build`: passed; existing dependency annotation warnings only.
- Unchanged baseline: `npx playwright test tests/e2e/chapter-ai-progress.spec.ts --output=.native-smoke/official-release/progress-before --reporter=list`: 1 passed.
- Diagnostic native loop: focused case passed, with the ten transient failures explicitly captured in the diagnostic artifact.
- `npx playwright test tests/e2e/chapter-ai-progress.spec.ts --repeat-each=5 --output=.native-smoke/official-release/progress-fixed --reporter=list`: 5 passed (1.1 minutes), no retries/failures. Each repetition retains both native-size screenshots and complete action/request geometry. A final cleanup-only follow-up guarantees that diagnostic I/O failure cannot skip app/fixture disposal; its recheck is recorded below.

All service traffic used the existing loopback HTTP fixture. No paid AI, installed client replacement, Git ref changes, commits or publication were performed by this teammate. The leader retains responsibility for GitHub CI rerun and official release publication after independent acceptance.

## Independent final CI-fix acceptance — release_resume_check, 2026-10-18

Reviewed the final test-only executable diff, frontend resize-readiness contract, retained first CI failure and twenty-transition diagnostic. No remaining findings. The exact original unscrolled bounds/center-hit predicate remains authoritative; polling is bounded by the existing 15-second Playwright expectation timeout. Request visibility/focus/scroll, request counts and restart assertions remain intact. Nested finally blocks guarantee app and loopback fixture disposal even if diagnostic writing fails. No product code changes or weakened accessibility assertions were introduced.

The earlier cleanup-final run is confirmed by progress-final/.last-run.json (passed; no failedTests), modified at 2026-10-18 00:45:40 local, with final geometry at minimum native size showing both actions directly hit-testable and resultsScrollTop=0. After session resumption, independently reran npm run lint and npm run typecheck: both passed. Independently ran npx playwright test tests/e2e/chapter-ai-progress.spec.ts --output=.native-smoke/official-release/progress-resume-independent --reporter=list: 1 passed in 13.1 seconds. This is local fixture-backed Electron evidence, not a substitute for the new release workflow run. No additional product/test edits, full-suite reruns, paid-service requests, Git mutations or publication were performed by this reviewer. Ready for leader commit/push and a fresh full release workflow.
