# Loop design

## Architecture

Add validated `jobs.repairLoop` input (jobId/revision/low|medium|high/maxRounds 1–20/scope all or range startMs/endMs), optional bounded Job repairRun metadata and validated repair progress. Thin main IPC/preload exposes the API. Acquire exactly one main private lease/controller before the first await and release only in outer finally after terminal state; never chain public operations or expose skipBusy.

Extract trusted internal draft/review primitives shared by public manual wrappers and the loop. Place pure eligibility/routing logic in a focused jobs/lib module. Enforce content/style revision and relevant provider identity at every publication; reject conflicting writes or terminate without overwriting them.

## Data flow and atomic boundaries

1. Refresh current report and review only missing/stale/new canonical assessments with their bounded contexts. Preflight review identity/key; no cues means no eligible content.
2. Resolve scope against the current chronology, then select current compatible pending findings by inclusive rank, deduplicate cue IDs and route qualifying issue types. Ignored/stale/legacy data is never direct eligibility. A ranged run keeps the original absolute interval fixed and recalculates cue overlap after every commit; never freeze old cue IDs or silently expand future eligibility to the entire job.
3. Build recognition ranges from current revision, recursively expand overlaps and exclude the entire effective coverage from translation-only IDs. Preflight only services required by this round, including translation before translated ASR.
4. Draft recognition with fresh IDs, combine retained chronology, translate new cues and remaining translation-only targets if enabled, validate final content/styles/limits and clean owned files.
5. Check abort/lease/revision/provider identity immediately before one transactional publication; increment media revision once for the complete round. Preserve unaffected style/content and historical exports; invalidate derived state.
6. Reassess all invalidated dependents/new IDs against the published chronology, then rebuild eligibility. Recheck after the last round even if the cap is reached. Do not cache cue IDs/revisions across commits.

Repair publication and complete review-report publication are separate atomic boundaries. A failed/cancelled draft publishes nothing from that round; earlier completed rounds remain. Failure/cancel during post-commit review keeps the repaired content and historical report stale. Cancellation arriving after a commit cannot undo it; record committed rounds accurately and stop further requests.

## Ignore identity

Inherit ignored only from a previously current finding matching cue, canonical rule, content fingerprint, context group, provider identity/fingerprint, rubric and mode. Reason text/new finding ID are not stable identity. New ASR IDs or changed context invalidate suppression. Ignore excludes a finding from selection, not its cue from necessary overlap replacement.

## State and compatibility

Bounded optional repairRun: run ID, requested scope, threshold/max, phase, current/committed rounds, affected/remaining counts, start/end timestamps, state and terminal reason, safe error details. Never store keys/prompts/audio or unlimited history. Update run metadata without media revision changes. Startup running => interrupted, no resumption. Legacy jobs have no repairRun and still parse.

States running/succeeded/cancelled/failed/interrupted; reasons no_eligible/max_rounds/user_cancelled/error/interrupted. Remaining count is only authoritative after a current completed assessment; otherwise display incomplete/unknown. A cap with remaining issues is distinct from convergence. UI includes persisted running metadata in busy checks and matches project/run IDs on progress.

## UI and constraints

Compact right-proofreading header controls: all/range selector, threshold, max rounds, start, phase/round summary; existing Cancel available throughout. Only range mode shows editable start/end seconds, using existing validation/format helpers. Default medium/3, maximum 1–20 rounds. Do not reuse exact-grade browsing selection as loop target authority. Metadata retains latest configuration without content-option invalidation. Review remains textual evidence, not proof of audio accuracy.

## Approved range boundary

User accepted existing complete-cue/recursive-overlap ASR expansion. Current `reprocessing.ts:20–80` uses half-open overlap and whole-cue expansion; `ReprocessingPanel.tsx` shows actual versus typed bounds. Reuse these rules and clearly show requested/effective scope. Crossing cues/overlap neighbours outside typed times may be replaced; content outside the effective scope stays unchanged. Strict splitting/clipping at typed bounds is out of scope.

Range review targets only missing/stale in-scope assessments (plus approved effective repair coverage and changed dependents where needed); neighbouring dialogue remains bounded context, not an implicit outside repair request. Terminal remaining counts/all-clear wording apply only to the requested scope. No intersecting subtitle cues returns zero eligible targets without triggering unsolicited speech recognition.
