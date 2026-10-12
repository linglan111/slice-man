# Single-request review design

Status: approved2026-10-11; implementation in progress. Research: parent `research/review-one-shot.md`.

## Boundaries and flow
Keep public review IPC, persisted assessments and canonical context-group hashes compatible. Implement aggregation in private `reviewDraft`, shared by manual review and loop reassessment. One main lease owns preparation, initial request, optional correction, validation and atomic publication.

Create canonical windows from the full timeline, retain those containing selected targets, and deduplicate their complete contexts. Request-local numeric aliases are original full-timeline ordinals; disjoint selections retain gaps. Send `cues`, per-window `groups:{targets,context}`, mode and canonical rubric in one generation. No selection means all current cues; neighbours are evidence only.

The strict compact wire JSON is `{"a":[[ordinal,[[ruleId,reason,[evidenceOrdinals]]]]]}`; explicit empty issues represents evaluated none. Zod rejects invalid tuple lengths/enums/counts, duplicate/unknown/context-only target aliases, omitted targets and invalid evidence. Normalize to existing UUID assessments; validate separately with each target's original canonical group. Combined input does not permit cross-group evidence or widen persisted dependencies.

## Budgets, correction and errors
Preflight at most 2000 selected targets and 512 KiB complete serialized UTF-8 prompt including rubric/context/group table and bounded correction reserve. Retain existing per-cue/context budgets. These are application bounds, not guaranteed provider token fit. Oversize selection requires smaller explicit selection; no serial fallback.

Initial prompt explicitly teaches all contextual evidence requirements. Allow one complete-selection corrective generation only for JSON/schema/ID/coverage/evidence failures; trusted diagnostics contain bounded aliases/rules/allowed-neighbour counts, not raw provider output. Show correction 1/1. Do not synthesize evidence, alter grades or silently drop invalid results. After failure retain previous report. No content retry for truncation, cancellation, refusal, auth, timeout/network/rate, preflight budget or stale revision/provider. Existing bounded transport retries remain separate.

Show preparing N / waiting for complete JSON / validating / correcting 1/1 / final validated coverage. Waiting is indeterminate because no per-cue results exist until validation. Check cancellation and freshness immediately before report publication.

## Renderer
AI review stays actionable when no service is selected: open explicit text-service picker/configuration instead of unexplained disabled state. Never choose an arbitrary profile. Persist explicit choice before reviewing the resulting current revision; dangling references receive the same actionable flow. Add never-assessed cues to the existing pending union and expose their own unchecked filter/count; current none, stale and ignored findings retain meaning. Presentation pending IDs do not control main automatic-loop risk eligibility. Standards uses existing accessible Modal outside the cue scroller, with focus/Escape restoration.

## Compatibility and verification
No database migration or provider-setting change. Preserve old report reads, selected/full canonical identities, context invalidation, source-only restrictions and ignored-intent identity. Update provider mocks to genuine compact wire JSON rather than add a legacy production parser for tests. Anonymous 1027-cue fixture verifies one HTTP request and complete coverage, without using personal subtitles or paid APIs. Re-run all repair-loop tests after replacing its shared review primitive.
