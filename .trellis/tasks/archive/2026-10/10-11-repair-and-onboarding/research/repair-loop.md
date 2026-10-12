# Research: Bounded automatic subtitle repair

- Query: Design a main-owned, cancellable loop that repairs current AI findings at or above a selected risk grade, routes source/timing to recognition and translation to retranslation, and stops at a user-selected round limit.
- Scope: internal; planning only, no product edits or task activation.
- Date: 2026-10-11
- Parent: `.trellis/tasks/10-11-repair-and-onboarding`
- Child deliverable: `.trellis/tasks/10-11-risk-repair-loop`

## Findings

### Existing contracts and relevant files

| File / anchor | Current responsibility |
| --- | --- |
| `src/main/services/jobs/lib/job-service.ts:86` | One global active JobService operation, identified by job ID and AbortController. |
| `src/main/services/jobs/lib/job-service.ts:231` | Public editable-timeline guard rejects active work and stale revisions. |
| `src/main/services/jobs/lib/job-service.ts:318` | Job cancellation and application-wide cancellation abort the active controller. |
| `src/main/services/jobs/lib/job-service.ts:343` | Generic media-stage wrapper acquires/releases the active controller and writes terminal stage state. |
| `src/main/services/jobs/lib/job-service.ts:702` | Translation draft helper preserves timing/IDs and resolves provider/key before provider calls. |
| `src/main/services/jobs/lib/job-service.ts:739` | Partial translation drafts every selected batch before one content publication. |
| `src/main/services/jobs/lib/job-service.ts:780` | Partial recognition expands/crops ranges, drafts fresh cue IDs, optionally translates, cleans owned files, then publishes atomically. |
| `src/main/services/jobs/lib/job-service.ts:931` | AI review independently owns a controller and only publishes a complete validated report. |
| `src/main/services/jobs/lib/job-service.ts:1125` | Ignore/restore uses job-busy, report-ID, finding-ID and provider guards. |
| `src/main/services/jobs/lib/reprocessing.ts:20` | Trusted main-side reprocess planning; recognition recursively includes every overlapping cue. |
| `src/main/services/jobs/lib/reprocessing.ts:91` | Cue fingerprints include active text and timing; source-only omits inactive translation. |
| `src/main/services/jobs/lib/reprocessing.ts:102` | Provider fingerprint includes protocol, mode, URL and model. |
| `src/main/services/jobs/lib/reprocessing.ts:105` | Refresh recomputes canonical context groups and marks dependent assessments/findings stale. |
| `src/main/services/jobs/lib/reprocessing.ts:189` | Whole-timeline chronological windows, bounded neighbours, stable context-group hashes. |
| `src/shared/reprocessing-contracts.ts:50` | Finding/report/assessment schemas, including ignored/recheck and optional legacy metadata. |
| `src/shared/review-rubric.ts:12` | Fixed numeric risk rank for none/low/medium/high; reusable for cumulative thresholds. |
| `src/shared/contracts.ts:160` | Content options currently trigger revision/invalidation through updateOptions. |
| `src/shared/contracts.ts:198` | Job and stage schema; all persisted jobs are parsed strictly. |
| `src/shared/contracts.ts:292` | Progress events currently accept media stages plus install/review. |
| `src/shared/ipc-validation.ts:32` | Preload progress validation; unregistered event stages are dropped. |
| `src/shared/ipc-validation.ts:49` | Per-channel output validators must register any new endpoint. |
| `src/main/ipc/index.ts:246` / `src/preload/index.ts:59` | Thin validated IPC and typed API for partial operations/review. |
| `src/main/db/store.ts:44` | Startup converts persisted running media stages to interrupted. |
| `src/main/db/store.ts:69` / `:92` | Read/write refreshes applicability; JSON Job payload is transactionally saved. |
| `src/main/db/store.ts:232` | Provider changes invalidate review and may increment media revision. |
| `src/renderer/src/App.tsx:69` | Progress subscription applies Job snapshots; review progress is currently component-local. |
| `src/renderer/src/App.tsx:198` | Processing strip provides existing Cancel action. |
| `src/renderer/src/components/SubtitleList.tsx:45` | Compact proofreading/review controls and grade selector. |
| `src/renderer/src/lib/review-presentation.ts:9` | Current grades remain distinct from legacy/unreviewed/stale; existing filters are exact grades, not cumulative thresholds. |

### Why a renderer loop or chaining public operations is unsafe

`stage` creates a new controller (`job-service.ts:355`) and releases it in `finally` (`:401`). Review does the same (`:954`, `:1122`). Chaining these public methods exposes unlocked gaps, cannot keep cancellation latched across rounds, and public `planReprocess` calls the busy guard. An internal loop must not invoke public methods while holding the global lock or temporarily clear `active` to bypass their guards.

Recommended smallest durable boundary: a public `jobs.repairLoop(input)` validates input/revision, acquires exactly one private operation lease/controller synchronously before the first await, and owns it until the terminal state has been persisted. Extract reusable internal review and recognition drafting/publication primitives from the current public wrappers. Private primitives accept a trusted owner/signal and never acquire/release a second controller. Public manual operations retain their current behaviour and guards. Avoid a generic public `skipBusy` flag or client-supplied lease.

Use the existing `jobs.cancel(jobId)` and `cancelAll()` unchanged. Check abort before every async phase, immediately before content/report publication, and between rounds. Aborted work must not start another provider request or emit a later success. Ownership cleanup belongs to the sole outer finally.

### Fresh eligibility and threshold semantics

Do not use renderer filter IDs, report state alone, or old `riskLevel` labels as targets. Main reads the current Job and refreshes review applicability. A target must have an assessment with `status=current`, compatible rubric/profile/provider/mode/context fingerprint, and at least one corresponding `pending` canonical finding at or above the threshold. None, missing levels, legacy reports, orphan findings, ignored findings and recheck findings are not repair targets.

Recommended threshold values are low/medium/high, excluding none because absence of suspicion is not a repair target. Compare `REVIEW_RISK_RANK[finding.riskLevel] >= thresholdRank`. Deduplicate cue IDs. Using the assessment maximum alone would incorrectly repair a cue whose high issue was ignored but which still has an unrelated low pending issue.

Recommended category routing applies to threshold-eligible pending findings: source/timing IDs go to recognition; translation-only eligible IDs go to retranslation. Recognition wins when the same cue has eligible findings of both types. A lower-grade source issue alongside an eligible translation issue does not force recognition. This detail should appear in the reviewed design; the user confirmed category routing but did not explicitly specify this mixed-grade edge case.

Before selecting targets, review every missing/legacy/stale assessment using canonical current timeline windows. Reuse fully current assessments to avoid an unnecessary initial whole-project API call. After each repair, re-evaluate all invalidated/new/unreviewed current cue IDs, including formerly none neighbours. A full-project rescan is a simpler correctness fallback, but adds calls and can unexpectedly rejudge already-current content; do not silently call an affected-only cue recheck complete if its context dependents remain stale.

If there are no cues after successful silent recognition, complete with no remaining subtitle targets without calling review's existing `NO_SEGMENTS` path. Describe this as removal of old cues after no detected speech, not proof of correctness.

### One atomic repair round and mixed-category overlap

Recommended publication unit is one whole repair round, followed by a separate atomic review report. A round contains all selected recognition ranges plus eligible translation-only cues. Reuse/extract existing recognition draft logic (crop offset normalization, fresh IDs, local/cloud handling, cleanup, translation) rather than duplicating it in a second implementation.

1. Resolve recognition against the current snapshot before work. Its expanded `plan.segmentIds` may include translation-only IDs or ignored/unflagged overlapping cues. Expansion is necessary to avoid partial overlapping-cue replacement; report the effective affected count and document that overlapping cues may also be replaced.
2. Remove all expanded recognition IDs from translation-only IDs, not only the initial source/timing IDs. Never submit a translation plan containing an ID that recognition is about to replace.
3. Draft recognition into fresh IDs without committing; assemble retained plus drafted chronology. If project translation is enabled, translate newly recognized cues and remaining translation-only cues against that combined chronology. Original-language mode never resolves or invokes any translation provider.
4. Validate the final timeline/style references and segment limit. Complete cleanup of operation-owned temporary files before publication. Recheck input identity, abort, current revision and service fingerprints immediately before one save.
5. Publish the full draft once: increment revision once, preserve unaffected content/styles/historical outputs, remove emphasis binding to replaced cues, invalidate derived preview/export state, refresh review/remap historical findings as existing recognition does.
6. Re-evaluate affected context using the **published** snapshot, then rebuild the next round from the new report and current IDs. Do not cache plans, ID sets or revisions across commits.

This protects a mixed round against recognition succeeding while an independent translation-only batch fails. Existing manual combined recognition/translation atomicity remains intact. Previous completed rounds survive a later failed/cancelled round. A post-commit cancellation cannot undo that commit; the outer loop may terminate cancelled with the completed-round count recorded, without claiming old content was retained. Cancel/error during re-review retains the committed repaired content and the previous report marked stale, never reinstalls that report as applicable to the new cues.

### Preflight, revision and service guards

Validate the review profile/key first; legacy/stale analysis requires this dependency even when no current candidates exist. Once a round's routing is known, preflight only needed recognition/model/runtime/input/audio and translation dependencies **before drafting or destructive replacement**. A translation-only project repair does not require ASR readiness. A translated recognition repair preflights translation before starting costly ASR, rather than discovering a missing translation profile afterward. Provider failure after successful preflight still aborts the draft atomically.

The JobService lock guards options/CRUD/acknowledgment but not every write path. `setStyle` (`job-service.ts:290`) currently does not reject active work, and profile save/remove IPC (`ipc/index.ts:147`) bypasses JobService. Existing revision checks protect against style changes and material recognition/translation provider changes, while review profile changes use provider fingerprints rather than revision. For this loop, retain snapshot checks at every commit and stop rather than retry on conflict. Prefer a main-side busy guard for style writes and referenced profile mutation during the operation; do not rely only on disabled renderer controls. A global profile guard is simplest and consistent with the one global job lock, but scope this choice in the design to avoid unexpected unrelated-profile UI changes.

### Ignore intent across rechecks

Current selected/full review creates new finding IDs with `status=pending` (`job-service.ts:999`); selected merge only preserves findings outside the selected IDs (`:1098`). Thus a naive initial/full re-review silently resurrects ignored findings, and could start repairing content the user excluded.

Recommended minimal compatibility change: when emitting a fresh finding, inherit ignored only from a previous **current** ignored finding with the same cue ID, canonical rule ID, context-group hash, active-content fingerprint, provider identity/fingerprint, rubric version and translation mode. Do not match reason strings or arbitrary old finding IDs; model reasons may differ. Do not carry suppression to fresh recognition IDs or changed context. Existing `refreshReview` intentionally marks changed ignored findings `recheck` (`reprocessing.ts:151`), so ignore expiration on changed context is consistent with current contracts. Preserve ignored historical entries only when useful and bounded; avoid adding an unbounded global ignore ledger for the MVP.

An ignored cue can still be affected by overlapping ASR expansion or by another eligible pending issue on the same cue. UI/help must distinguish ignored findings from immutable subtitle segments. Never promise ignored cue content cannot change if a neighbouring overlap requires replacement.

### Bounded rounds, terminal states and persistence

Recommend defaults medium / 3 rounds and an allowed input range of 1–20, awaiting final plan review. Main validates a positive integer, rejects NaN/fractions/zero/negative/out-of-range values, and enforces the finite product cap. `maxRounds` counts committed repair rounds, not initial analysis/provider batches. Always perform the final reassessment after the last allowed repair unless cancelled/failed: stop reason must distinguish no eligible findings from reaching the cap with remaining suspicion.

Persist an optional top-level `Job.repairRun` schema instead of adding preferences to media content `JobOptions`. `updateOptions` currently treats unfamiliar option changes as content edits (`job-service.ts:171`), which would invalidate revision/exports/review unnecessarily. Optional metadata preserves readability of old Job payloads without a relational migration. Suggested bounded payload: run ID, threshold, maxRounds, started/completed timestamps, state, current round, committed-round count, phase, affected/remaining counts, terminal reason, optional safe error code/message. Last-run configuration can seed the next operation. Do not store API keys, prompts, audio or unlimited round histories.

Suggested states: running/succeeded/cancelled/failed/interrupted; terminal reasons: no_eligible/max_rounds/user_cancelled/error/interrupted. Persist changes without media revision increments. On application startup, running repair metadata becomes interrupted and is **not automatically resumed** (`store.ts:44` currently only handles media stages). A new user operation uses the latest content/report/revision. Consistently account for metadata timestamps so `App.commitJob` does not drop later snapshots as stale.

Extend `ProgressEvent.stage` and `progressSchema` to include repair, or explicitly define a validated structured repair event; otherwise preload drops progress silently. Display phase and round as well as subphase progress rather than suggesting the unknown number of rounds is precise elapsed-time progress. Include job ID/run ID in UI matching so a previous project/run cannot overwrite the selected project's progress. Keep Cancel available throughout analysis, drafting, commit boundaries and reassessment. Renderer `isRunning` should include persisted running repair metadata, not only its local `busy` label and old media stages, so remounts do not enable edits during a running loop.

Terminal wording: “No unignored findings at or above medium remain in the completed AI analysis” is valid; “All subtitles are correct” is not. Cap/cancel/error summaries include completed rounds, valid remaining count when available, and whether reassessment is incomplete. The fixed text-only review cannot establish acoustic correctness.

### Implementation touch map

- Shared: `reprocessing-contracts.ts` new strict input/metadata schemas; `contracts.ts` Job/typed AppApi/progress; `ipc-validation.ts` endpoint result and event validation. Keep legacy optional report fields readable.
- Main: `job-service.ts` one owned loop, internal primitives, preflight/commit guards; optionally a focused new `jobs/lib/repair-loop.ts` for pure eligibility/round planning to prevent another large monolithic method; `reprocessing.ts` suppression identity/compatibility helpers if shared with manual review; `db/store.ts` interrupted recovery; `ipc/index.ts` thin endpoint and write guards.
- Preload: `index.ts` typed invoke entry and event schema integration.
- Renderer: `App.tsx` operation start, run-matched progress/terminal summaries and cancel; `SubtitleList.tsx` compact threshold/max-round entry; `review-presentation.ts` only if displaying eligibility summaries. Exact-grade browsing remains unchanged.
- Specs: extend `.trellis/spec/shared/subtitle-review-reprocessing.md` with loop ownership, round boundary, ignored inheritance, cap semantics and stale-target exclusions before final quality review.

### Meaningful tests and evidence

Existing anchors:

- `tests/integration/backend/reprocessing.test.ts:267`: combined recognition/translation failure and cancellation retain target.
- `tests/integration/backend/reprocessing.test.ts:285`: cleanup failure/cancel before publication.
- `tests/integration/backend/reprocessing.test.ts:453`: cancellation at the atomic publication boundary still preserves successful manual partial result.
- `tests/integration/backend/reprocessing.test.ts:487`: full/selected review context, retention, provider invalidation, ignore/restart lifecycle.
- `tests/unit/backend/review-assessments.test.ts:109` / `:276`: strict canonical grades/evidence and dependent context invalidation.
- `tests/unit/backend/store.test.ts`, `tests/unit/backend/ipc-check.test.ts`: strict persistence and IPC contract patterns.
- `tests/unit/frontend/SubtitleList.test.tsx`: grade/filter/repair controls.
- `tests/e2e/contextual-review.spec.ts`: real isolated Electron, deterministic review responses, fresh-ID ASR and grade/staleness flows.

Add pure tests for cumulative threshold, ignored-high/pending-low, mixed eligible categories, expanded ASR overlap exclusion, none/legacy/stale/no-active-translation handling. Integration tests should exercise one actual JobService loop with deterministic provider fixtures: initial analysis, repeated fresh IDs, convergence, cap with unresolved suspicion, missing services before ASR, complete source-only zero translation calls, atomic mixed-round failure, cancel during analysis/ASR/translation/reassessment and exactly at commit, busy state without inter-round gaps, profile/style conflicts, silent ASR, prior-round retention, ignored preservation/expiration, interruption and legacy Job loading. Use deferred promises/event callbacks to inject boundary races; timing sleeps are weaker evidence.

Electron E2E should configure medium/3, verify visible round/phase/count/cancel, perform mixed-category repair plus fresh reevaluation, stop at cap, verify invalid max settings, restart metadata, and verify other common controls remain accessible at default/minimum windows. Provider fixtures prove routing/state consistency, not AI linguistic quality or acoustic accuracy. Continue existing real-media export and optional native runtime gates; clearly report gated external-service/GPU checks.

## Related Specs

- `.trellis/workflow.md`: planning/activation gate and persisted research.
- `.trellis/spec/shared/subtitle-review-reprocessing.md`: canonical rubric, context freshness, source-only zero-translation, main-owned cancellation and atomic partial processing.
- `.trellis/spec/backend/index.md`, `api-module.md`, `type-safety.md`: thin IPC, main-relative imports, strict Zod inferred types, no non-null assertions.
- `.trellis/spec/backend/error-handling.md`: throw integrity errors inside transaction; user-safe dependency/domain failures.
- `.trellis/spec/backend/database.md`: transactional publication and structured persisted data.

## External References

None needed: this proposal reuses the installed application's existing Electron/AbortController/Zod/SQLite patterns and does not select a new dependency or rely on changing external API facts.

## Caveats / Not Found

- User approved task creation/planning and category-aware repair, not activation or implementation; no product files were edited.
- Product review should explicitly settle initial fresh-analysis policy, mixed-grade routing, max allowed round bound, ignore expiration on changed context, and one-whole-round atomicity. Defaults medium/3 and no auto-resume are reasonable proposals, not earlier confirmed user preferences.
- The request can be satisfied without automatic background loops, unattended startup jobs, new provider APIs or AI replacement text. Start remains an explicit user operation.
- Existing ASR is deterministic for unchanged audio/settings and may repeatedly produce the same suspicion. Re-review can also vary. A hard cap prevents unlimited work; do not change model/parameters automatically or promise convergence.
- No undo/history mechanism was found in the reviewed public job contracts. Completed rounds cannot be rolled back after app restart without a separate explicitly scoped feature; preserve them on cancellation and retain historical exported files.
