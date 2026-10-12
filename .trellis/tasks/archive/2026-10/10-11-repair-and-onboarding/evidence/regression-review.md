# Independent regression review — approved R1–R8

Reviewed on 2026-10-11 in the actual Windows Electron application. Scope: automatic risk repair, fixed time range, and first-run/repeatable feature guide. R9–R11 are planning artifacts only and were deliberately excluded from implementation and completion claims. No commits, publication, task archival, live paid API calls, or native SQLite ABI changes were performed.

## Findings fixed

1. **Fresh ASR cues outside a requested range were not reassessed.** `src/main/services/jobs/lib/job-service.ts` now sends all newly produced cues from the expanded recognition coverage for reassessment, alongside scoped missing assessments and invalidated existing dependents. This does not widen the fixed requested range or promote outside findings into the next round's eligibility/counts. Added an integration case with three replacement cues, two outside medium findings, and one clean scoped cue. All three receive current assessments; only the scoped original cue is repaired once. The shared review/reprocessing spec records this contract.
2. **A transient stale preview rectangle could place clickable bilingual captions over the player controls after shrinking the preview pane.** `LiveVideoPreview.tsx` now clamps overlay width/height in CSS synchronously while ResizeObserver refreshes the measured rectangle. The existing 64 px caption control clearance remains. A native Electron regression temporarily shrinks the player and measures both rectangles in one synchronous evaluation before observer delivery; captions must still clear the video control row by at least 63 px. The existing geometry/control-hit checks were preserved, and the frontend preview spec was synchronized.
3. **The native extreme-drag fixture moved the pointer roughly 5,000 px beyond the viewport, sometimes losing the final mouseup.** The pane-resizing test now drags to a real viewport edge and explicitly asserts the actual ARIA value reaches the current minimum/maximum. Persistence, reset, keyboard, geometry, and translated inline tools remain covered. No product drag code was weakened or changed for this fixture issue.
4. **Three historical retry workflow tests could select a cue before the initial job activation effect finished.** `AppSubtitleWorkflow.test.tsx` now waits for activation, uses awaited user interactions, and asserts both the checkbox and selection mode before execution/retry. Exact reused scopes and call counts remain asserted; no product workflow behavior was changed for this fixture race.

## Code-path audit

- A repair run holds one job operation lease/controller across preflight, all rounds, and post-commit reassessments. Draft ASR and translation results publish once per complete successful content round; failures/cancellation before publication preserve the previous committed content. Review/report publication has its own guarded boundary. Revision, provider, option, and style changes cannot silently interleave with active work.
- The absolute requested half-open range is fixed for the run. Each round resolves current cue IDs; whole-cue/overlapping ASR coverage is shown as effective intervals. Outside contextual dependents and fresh replacement cues can be reassessed without becoming repair targets merely because of context coverage.
- Pending current canonical findings determine eligibility and processing category; source/timing repair wins over translation for covered cues. Translation preflight occurs before ASR mutation for mixed/translated cases. Source-only mode does not resolve or call a translation provider.
- Ignored findings carry forward only under the current cue/rule/evidence/provider/rubric identity. Cancellation, failed reassessment, unknown remaining counts, round caps, and interrupted-on-restart reporting are represented without automatic resumption.
- Shared request schemas/preload validation reject invalid ranges, risks, and loop counts. Renderer metadata/progress ordering cannot revive a completed run from an older event. Compact controls retain usable list height at the minimum native window.
- Guide startup waits for successful initialization and yields to blocking/error dialogs and active actions. First-run dismissal persists; manual help restarts at step one, traps keyboard focus, supports Escape, and returns focus to the trigger. Unavailable storage is handled, and guide activity does not mutate jobs/profiles or call AI.

## Final verification

| Gate | Final result | Evidence |
| --- | --- | --- |
| `npm run lint` | Pass | [lint.log](lint.log) |
| `npm run typecheck` | Pass | [typecheck.log](typecheck.log) |
| `npm test` | **54 files, 497 tests passed** | [unit.log](unit.log) |
| `npm run build` | Pass; existing dependency PURE-annotation warnings only | [build.log](build.log) |
| Full `npx playwright test`, one worker, production Electron build | **35 total: 32 passed, 3 explicitly skipped, 0 failed**; 3.5 min | [full-e2e.log](full-e2e.log) |
| Final inline/guide/loop native tests, including the new synchronous shrink assertion and guide screenshots | **9 passed, 0 skipped/failed** | [affected-e2e.log](affected-e2e.log) |
| Extra default-loop screenshot run | **1 passed** | [loop-screen-e2e.log](loop-screen-e2e.log) |

The final unit run includes the expanded fresh-cue regression and stabilized retry tests. The full native run includes the corrected viewport drag and original caption geometry checks. The subsequent 9-case native run includes the newly added synchronous pre-ResizeObserver assertion, plus the same guide and range-loop paths. These additional runs overlap the full suite; they are not counted as additional unique suite tests. Initial failure totals were superseded by the final results above.

Full native coverage includes imports, local/URL choices, API failure/retry/cancel, actual CPU runtime installation/inference, actual CUDA inference and explicit CPU selection, downloads and persisted settings/rollback, native playback/seeking/fullscreen, inline CRUD/lyric follow, review invalidation, range-loop convergence/fresh IDs/caps/cancellation, guide dismissal/restart/manual access during active review, pane resizing/persistence/reset, recognition reset, single instance, and real FFmpeg subtitle/video exports. Export cases cover MP4/MKV, original/H264/H265, AV1/VP9/VP8, resolution/quality matrices, subtitle pixels, no upscaling, destination protection, and preserving bytes on cancellation. Small/standard/large windows and portrait/landscape media passed.

Actual GPU evidence: NVIDIA GeForce RTX 5070, Whisper 1.8.3 base model; verified CUDA0 receipt and a separate explicit CPU receipt. [gpu-native-result.json](gpu-native-result.json) records integrity hashes and the actual backend results. Cloud AI responses in ordinary tests use the isolated loopback fixture, so these results establish wiring, transactional behavior, and error handling rather than live model judgment quality.

### Explicitly skipped gates

1. `download-real.spec.ts`: **authorized real YouTube and Bilibili complete download/probe/import/decoded playback via production Electron UI** — `APP_REAL_DOWNLOAD_E2E=1` was not enabled. Ordinary actual download/probe/import/playback tests passed with the isolated fixture.
2. `deepseek-live.spec.ts`: **live DeepSeek text translation/style over actual local Whisper and real desktop media export** — requires `APP_LIVE_DEEPSEEK=1` and a session-only user API key; neither live gate was enabled.
3. `deepseek-live.spec.ts`: **live DeepSeek compatibility-only Responses and Anthropic desktop probes with exact auth forwarding** — same explicit live gate/key requirement.

No remaining defect was identified within reviewed R1–R8. The user's newer AI evidence/unchecked-filter/batch-review requests, operation-panel layout requests, and person-name tooling belong to planned R9–R11; this report does not claim they are implemented or resolved. Live paid model quality and authorized external video-site behavior remain unverified under the intentionally disabled gates above.

## Screenshots

- [Guide at standard native window](guide-default.png)
- [Guide at minimum native window](guide-minimum.png)
- [Fixed-range repair at standard window](repair-range-default.png)
- [Fixed-range repair with inline editing at minimum window](repair-range-minimum.png)
- [Cancelled repair report](repair-cancelled.png)

The minimum-window guide and repair screenshots were visually inspected: the guide's text/footer fit, repair controls remain reachable, and preview/proofreading remain independently bounded. Subsequent R10 planning may change the layout further.
