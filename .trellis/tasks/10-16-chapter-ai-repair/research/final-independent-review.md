# Full-scope independent source/static/unit review — 2026-10-17

Reviewer: `/root/final_review` (`trellis-check`), independent of the product
implementation owners. Continued the existing tree after quota interruption;
did not recreate implementations or recursively delegate. Product files were
not changed by this reviewer. Runtime build, native desktop and paid-service
verification are owned separately by `/root/runtime_verify`.

## Context and reviewed boundaries

Read the complete saved hook output, task manifests and parent PRD/design/plan;
read the child implementation handoffs, coordination notes, original sanitized
name diagnostics and the earlier independent repair report. Inspected the
current changed source/contracts/specs and the latest provider-dependency and
native fixture changes. The earlier repair safety review is retained as
independent evidence; the current full suite additionally executes all 66
repair integration cases.

- Shared/API contracts: persisted `textConcurrency` defaults to 2, accepts
  integers 1–16, and legacy profiles remain readable. The transport limiter
  applies by service profile to all text calls, including names/corrections;
  queued cancellation removes the waiter before POST and deadlines start after
  admission. Worker cleanup settles concurrent work and releases slots.
- Chapters: normal plans are reused for short and long projects. Explicit
  planning bootstraps without recursion; custom analysis consumes normal
  chapter batches. Complete context includes crossing cues; target ownership
  remains unique. Hidden subdivisions and the former 30-minute review bypass
  are removed; over-capacity work fails explicitly. General translation/review
  retain complete independent chapters and merge out-of-order assessments into
  the latest current report; scoped content and global style remain atomic.
- Latest dependency guard: `normalPlan` registers a reused or newly created
  plan's actual provider as a lease dependency, including explicit plan profiles
  absent from `options.chapterProfileId`. Public IPC save/removal is blocked
  while style/custom analysis consumes that plan. `assertChapterPlanCurrent`
  checks current state/identity/revision/source before style publication;
  custom drafts carry the normal-plan dependency through a WeakMap and check it
  again at publication. Seven current tests cover both operations' public
  save/remove rejection, stale/replaced plan retention and names exemption.
- Names: one entire chronological timeline request, no normal-plan acquisition
  or chapter-specific context. Script-aware literal boundaries allow the
  reproduced CJK-adjacent Latin/mixed-script aliases while preserving exact
  case/field/word-fragment/Unicode checks. Global recurrence and strict atomic
  apply/undo remain authoritative. One bounded visible correction uses trusted
  ordinals and the same payload; transport/cancel failures do not regenerate.
  Original readonly response replays and their snapshot-provenance caveat are
  documented separately; this reviewer made zero paid requests.
- Repair: prior deep review's resolved mapping/overlap/silence/atomicity issues
  and final-consistency lifecycle contract were read against the current
  orchestration. Required pending coverage is checked independently of risk
  threshold, with no extra repair round/content mutation. New eligible findings
  with budget left return to actual repair; failure/cancel/nonprogress cannot
  claim complete grades. The final full run includes the 66 repair regressions.
- Renderer: one processing stream action plus one completed reopening action;
  operation/phase/round remain separate from stream bytes. Progress consumes
  job/run/chapter associations, all queued/active request rows and real counts.
  Names have no fictional chapter counter. Chapter help exempts recognition
  and names; service concurrency replaces the competing visible job setting.
- Minimum-window follow-up: reviewed the `150px` summary flex basis and scoped
  `.workspace-results .processing-progress .processing-strip {position:static}`.
  This keeps the new expanded summary from becoming a sticky overlay in the
  existing small results pane, without resetting persisted pane allocations.
  The native test checks center-point hit testing for both actions at 1440x960
  and 1050x700, keyboard focus/End, scrollability and every request row, saving
  geometry and screenshots. Actual final execution/images are runtime
  verifier evidence, not a claim of this source/static review.
- Independently reviewed runtime fixture refinements: CPU success is scoped to
  the runtime dialog's device card to avoid duplicate text. Concurrent repair
  audit checks use chapter identity rather than request arrival order, assert
  exactly two requests per owning chapter, exact old full context/target IDs,
  retained context-only new cues and suspicion evidence. Assertions are not
  weakened to totals alone.
- Live native receipt evidence now watches only temporary UUID-prefixed partial
  recognition receipts in the isolated seeded job, instead of treating the
  earlier full-recognition root receipt as fresh repair evidence. The watcher
  reads synchronously on create/change and closes in `finally`; nonempty observed receipt count
  and exact CPU/non-GPU flags are asserted. A missed file notification cannot
  produce a false passing receipt assertion. No original-user paths or receipt
  contents are persisted, only sanitized backend flags/counts. This late
  fixture-only refinement was independently inspected. An opt-in zero-AI native
  precheck exercises full recognition plus partial recognition with translation
  disabled, observes these same fresh receipts and requires zero diagnostics;
  this validates the observer before spending paid requests. Static gates were
  run again afterward.

The changed shared AI chapter/name/reprocessing and frontend workspace specs
describe these executable contracts. Unrelated user AGENTS/workflow/index and
seeking-helper edits were preserved. No broad staging, commit or archive was
performed.

## Findings (fixed)

- File: `tests/unit/backend/chapter-workflows.test.ts`, provider-dependency IPC
  fixture. The new tests invoked `registerIpc` without its `download`
  collaborator; disposal unconditionally calls `services.download.cancel()`.
  Both tests therefore failed after their business assertions with a TypeError.
  Added only `download: { cancel: vi.fn() }` to that fixture. The public
  save/removal `JOB_BUSY`, old-output retention and generated-output assertions
  are unchanged. `/root/runtime_verify` independently checked and accepted this
  one-line mechanical fix against `src/main/ipc/index.ts:427`.

## Findings (not fixed)

No remaining concrete source defect identified in the reviewed scope. No
product decision, module-boundary change or speculative patch was introduced.

Project acceptance still requires the separate final build/native desktop and
authorized actual-service reports. Static and mocked-provider checks do not
establish linguistic/acoustic accuracy, GPU execution or clean installation.
The latest native geometry assertions were reviewed as source here; their
runtime screenshots/results must remain attributed to the runtime verifier.

## Verification actually executed by this reviewer

1. Initial `npm run lint`: passed, exit 0.
2. Initial `npm run typecheck`: passed, exit 0.
3. First `npm test`: **84 passed / 1 failed files; 933 passed / 2 failed tests**,
   29.32s. Both failures were the fixture disposal error above. This initial
   run is not reported as a pass.
4. After the one-line fixture fix, `npm test`: **85 files / 935 tests passed**,
   29.33s, exit 0, using `scripts/test-unit.cjs` and Electron's SQLite ABI.
   Includes the seven latest provider-dependency tests and all 66 repair
   integration cases; no rebuild for ordinary Node was performed.
5. Final `npm run lint`: passed, exit 0.
6. Final `npm run typecheck`: passed, exit 0.

Late native-fixture preflight (after the checks above): the runtime owner added
`chapter-provider-dependency.spec.ts`. Independent source review confirmed it
holds an actual style request after explicit normal planning, rejects public
profile save/removal, and checks retained plan/profile and style success. A
subsequent typecheck caught the new assertion's `stages.design` typo (the stage
is `style`), and it was returned to its owner for correction. The owner changed
only this assertion to `stages.style`. The final independently executed
post-fix `npm run lint` and `npm run typecheck` both passed, exit 0, including
the native provider dependency case and final synchronous receipt observer /
zero-AI native precheck fixture. No unit/integration source changed after the
935-test passing run; repeated full unit execution was not necessary for these
E2E-only refinements.

No build, Playwright/E2E, paid request, production-data mutation or commit was
executed by this reviewer. No further product changes are requested before the
runtime verifier's final stable build/live run.

## Final fixture-only follow-up acceptance

After runtime verification, independently reviewed the last fixture deltas
without repeating build/native/paid calls or the unchanged 935-unit suite:

- `seedCpu` now writes the mandatory `message` required by runtime `stateSchema`.
  The seed still verifies pinned runtime/model size and SHA-256 before copying
  them into isolated userData; it does not fabricate inference success. Both
  full and partial CPU execution must succeed and supply real receipts.
- Native/actual userData now resolves to short timestamped directories under
  this workspace's `.native-smoke/cai-native-*` / `cai-actual-*`. These paths
  avoid Whisper's Windows narrow-path limit after UUID prefixes are added,
  retain isolation from installed-client data, and perform no recursive delete,
  move, overwrite of the installed application or production database mutation.
- The shared synchronous receipt observer still accepts only new partial-ASR
  receipt filenames in that isolated job. The diagnostic assertion now reports
  structured failure code/message when the zero-AI precheck fails, rather than
  concealing it behind a boolean. Real precheck execution and its earlier
  failures are runtime-owner evidence; this reviewer does not relabel them as
  first-attempt passes.
- Reviewed the final actual-service test and readonly secure bridge. It creates
  synthetic mixed-script name captions and the public JFK speech fixture;
  original private subtitles are not uploaded. The production database is
  opened readonly/fileMustExist only to locate a configured service and decrypt
  its key in Electron memory. Isolated bridge Local State contains only the
  protected OS-crypt metadata. The real key is passed through the child
  environment, removed from the test's environment before app launch, never
  supplied to renderer/CLI arguments or written into profiles. The isolated app
  receives only a nonsecret loopback key. Traces/video/failure screenshots are
  disabled; deliberate output screenshot uses the synthetic/public test job.
- The proxy ledger resides outside disposable Playwright output, preserves all
  prior reservations, requires an exclusive `wx` lock and enforces cumulative
  `limit:30`. Each request reserves/fsyncs/renames the ledger before upstream
  fetch, so concurrent chapter calls cannot exceed 30 or erase interrupted
  attempts. The proxy preserves raw Responses SSE and records sanitized counts,
  statuses and model metadata, not prompt/body/reasoning/credentials. Sequential
  actual operation assertions stop the suite on failure; no fallback mock is
  substituted for a failed paid result.

Latest independently executed `npm run lint` and `npm run typecheck`: both
passed, exit 0, after these final fixture changes. No concrete fixture,
isolation, budget or evidence flaw identified. Final actual-service outcomes
remain pending the runtime verifier's report and are not implied by this
acceptance.

## Two-interval fixture and paid names checkpoint review

Independently accepted the next fixture-only delta before any paid continuation:

- The public 11-second JFK sample can produce one native Base cue. The new
  helper splits that cue's recognized words into two halves, preserves every
  word/punctuation token in order and asserts normalized transcript equality.
  It normalizes whitespace; it does not claim byte-identical original spacing.
  Midpoint boundaries have a deliberate 20ms positive gap so partial ASR makes
  two independent interval calls. Both precheck and actual-service evidence
  explicitly mark the division manual and exclude native/aligned timing claims.
  This is fixture preparation through public edit/add IPC, not production ASR
  output correction or a production-code change.
- Read the saved `native-precheck-twointervals-output/.../
  native-precheck-evidence.json`: nativeCueCount1, contextCueCount2,
  manualSubdivision=true, **two distinct fresh CPU receipts**, both
  gpuExecutionVerified=false, aiRequests0. This is the runtime owner's actual
  7.7-second precheck evidence; this reviewer only inspected the saved result.
  The previous one-receipt precheck artifact remains available and is not
  silently replaced by the stronger two-interval result.
- The first paid attempt stopped after names and chapter planning because the
  public native fixture had only one cue. Resuming skips only the already
  verified names operation; planning/translation/review/style/repair for the
  public sample remain actual calls. The checkpoint comes from readonly
  extraction of the first attempt's isolated database, not the production DB.
- Independently opened that isolated SQLite DB readonly through Python's SQLite
  API (no native-test rerun): current name report has exactly one candidate and
  no chapter plan. The extraction script explicitly checks the mixed source
  alias and Latin alias adjacent to Han before writing sanitized evidence.
  Its names diagnostic `3467867b-e59d-4486-903a-3c1cda9d831c` is **published**
  and exactly matches cumulative ledger request1. The current ledger still
  contains request1 names and request2 chapters, both published, **count2 /
  limit30**; no reset or replacement budget was introduced. The secure runner
  supplies the specific existing sanitized checkpoint path, and the shared
  locked pre-dispatch cumulative reservation mechanism remains unchanged.
- Latest independent `npm run lint` and `npm run typecheck`: passed, exit0,
  after these changes. No duplicate paid/native/build execution or product
  change was performed by this reviewer. The runtime owner and leader were
  notified of acceptance before further paid work; actual later outcomes remain
  the runtime owner's responsibility.

## Actual-service truncation checkpoint — independent readonly inspection

The actual run stopped at cumulative request13 after an audit returned
`TRUNCATED`. The harness had imposed `max_output_tokens:8192`; removing this
test-only override and resuming only repair is being reviewed separately. This
failure is retained, not replaced by mock success or a fresh request allowance.

Independently inspected the current cumulative ledger and failed isolated SQLite
database readonly without paid/native execution:

- Ledger **13/30**, including original published names and chapter results.
  Public sample chapter plan, both full translations, both reviews and both
  style results are published. Repair's two fresh translations and first audit
  are only validated; second audit is failed/TRUNCATED/textBytes0.
- Failed repair metadata: state failed, committedRounds0, round1, revision7.
  The saved timeline retains its two original cue IDs (no partial replacement
  IDs); each saved translation exactly matches that cue's previously published
  full-translation answer, checked by ID without logging transcript text. The
  two test-seeded pending findings remain. Thus the successful first audit and
  translation drafts did not publish half a repair round.
- These checks establish preserved content and honest failure metadata. They
  do not establish final repair success; continuation must retain the ledger,
  service identity and failed/validated diagnostic history.

### Repair-only continuation acceptance

Independently inspected the landed continuation test, proxy helper, readonly
checkpoint preparation and secure runner before authorizing the runtime owner
to continue within the same allowance:

- Actual fixtures now use `maxOutputTokens:null`; the proxy forwards the app's
  original parsed request payload without imposing the former 8192-token test
  limit. Production provider code, service model and timeout are unchanged.
- The proxy binds exactly to the checkpoint's prior loopback port63325; an
  invalid/unavailable port fails with no random-port fallback. Bind errors
  reject and release the cumulative-ledger ownership lock before any upstream
  request. Original pre-dispatch reservation, exclusive lock and limit30 remain.
- The resume checkpoint names the existing workspace-isolated userData/job,
  revision7 and same profile/model. Restoration first requires failed / zero
  committed rounds / TRUNCATED state, restores only the session loopback key,
  and verifies unchanged revision plus SHA-256 of all segments, review report
  and chapter plan. The profile retains its exact original base URL/model. The
  saved zero-AI identity-preflight artifact reports all those identities equal
  and no new requests. The reviewer read this artifact; did not rerun it.
- Readonly preparation verifies normalized original native transcript equality,
  old translations against both published answer files, the two seeded current
  medium assessments, and two published requests each for translation/review/
  style. Existing names evidence remains independently linked to ledger1 as
  previously recorded. The secure runner selects only the repair-continuation
  test when this specific checkpoint exists; completed operations are not
  reissued or claimed to have run anew.
- The continuation preserves every previous diagnostic object by ID and exact
  equality, including validated unpublished drafts and failed truncation. Newly
  produced requests must all be published, include exactly two translations
  and at least six requests overall; it cannot pass merely by accepting any
  historical state. It requires real fresh partial CPU receipts, one committed
  repair round, current explicit grades for all surviving cues, no seed finding
  IDs, persisted report/run equality after restart, matching visible badges and
  actual SRT output. The prior manual timing/seed caveats remain in evidence.
- Latest independently executed lint and typecheck both passed, exit0. No
  product changes, duplicate unit/native/build execution or paid requests were
  made by this reviewer. The runtime owner and leader were notified immediately
  after acceptance. Ledger13/30 and the failed first repair are retained; final
  repair success is still contingent on the actual continuation outcome.

## Final actual-service evidence audit — 19/30

After the runtime owner reported repair-continuation success, independently
audited the final JSON artifacts, screenshot fixture changes and actual images.
No paid request or desktop session was launched by this reviewer.

- `evidence/actual-services-ledger.json` has sequential calls1–19, limit30,
  peak concurrent upstream requests2. Exact terminal counts are **15 published,
  3 validated/unpublished, 1 failed**. Original names, planning, full translation,
  review and style records remain published. The failed repair's two translated
  drafts and first audit remain validated; call13 remains failed/TRUNCATED with
  textBytes0. Calls14–19 are all published: two fresh translations, two audits
  and two reassessment requests. The budget was not reset and paid testing has
  stopped at19.
- Independently reopened the final isolated SQLite DB readonly. All17 final-job
  diagnostic IDs/states exactly match ledger calls3–19; the earlier names/plan
  calls1–2 belong to the preserved first isolated attempt. The original failed
  diagnostic still records TRUNCATED. Persisted repair is succeeded with reason
  max_rounds, committedRounds1, remainingCount2; exactly two current medium
  assessments remain. This is a successfully bounded workflow, **not** an
  all-clear or a claim that the two linguistic findings were eliminated.
- `actual-repair-result.json` records two new actual CPU receipts, both with
  gpuExecutionVerified=false, six published new requests, persisted current
  grades after restart and a202-byte SRT. The seeded medium and manual
  two-interval timing caveats remain explicit. Receipt/SRT execution belongs
  to the runtime verifier; the reviewer verified their persisted evidence.
- Visually inspected `actual-repair-final.png`: both subtitle rows display
  current medium suspicion. Inspected `actual-repair-final-status.png`: the
  repair dialog explicitly says maximum rounds reached, one round saved and
  two medium-or-higher unignored findings remain. These agree with SQLite and
  `actual-final-ui-inspection.json` (same job, current medium2, no new requests).
  The video loading spinner in the workspace image is not video-decoding proof;
  these images establish grade/status rendering only.
- Inspected the retained `actual-repair-startup-race.png`; it contains the
  initial loading page and is correctly excluded as final-state evidence.
  Both actual test paths now wait until startup loading is gone and the exact
  expected grade-badge count exists before screenshot capture. The separate
  zero-AI capture script checks persisted state first, compares diagnostic count
  afterward and saves the corrected images without invoking AI. No failed
  screenshot or failed paid attempt was silently erased.
- Reviewed evidence contents and scanned JSON/Markdown for key/Bearer/private-key
  patterns: none found. The ledger is restricted to an explicit allowed set of
  diagnostic metadata fields; all event/index/item/part maps contain numeric
  counts, including reasoning event counters. No raw reasoning, SSE body,
  credential, private production subtitle or prompt was copied into these
  submitted evidence artifacts. The images show only public fixture captions.
- Latest independent lint and typecheck after screenshot readiness changes:
  both pass, exit0. Product source remains unchanged; the passing935-unit result
  still applies. The runtime owner is separately running the final default
  desktop regression; its result is still required for complete acceptance.

## Final full desktop regression evidence audit

Read-only compared `evidence/desktop-final-summary.json` with the original
`.native-smoke/chapter-ai-20261017/e2e-full-acceptance.json` and final log. Exact
statistics agree: **63 discovered, 53 passed, 10 skipped, 0 unexpected failures,
0 flaky**, 324912.604ms (324.91s). This was the runtime verifier's execution,
not a new reviewer test run.

Checked all ten skip annotations against the source report. They are explicit
opt-in cases: legacy live stream, the four actual chapter/native/checkpoint/
continuation cases, original-project live copy, two DeepSeek live compatibility
cases, real external downloads, and legacy Responses live. The relevant current
chapter/native/continuation behavior already has the separate actual evidence
audited above. The skips must remain disclosed; they are not ten passes and do
not establish actual other-provider or external-download compatibility.

Re-read both the saved evidence ledger and active cumulative ledger: both are
identical at **19/30**, with no ledger ownership lock remaining. Thus the full
default desktop run did not add paid calls or silently rerun gated services.

Independent review is complete: final product lint/typecheck and935 unit /
integration cases passed; final full default desktop evidence is green with
the ten explicit skips; actual configured-service/native evidence is accepted
with preserved failure history, manual fixture caveats and the honest one-round
cap/current-medium2 outcome. No remaining concrete review finding. No further
test, AI request, desktop launch, product edit, commit or archive was performed
by this reviewer in this final audit. Leader owns final user acceptance and
scoped commit handling.
