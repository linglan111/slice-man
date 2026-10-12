# Subtitle review reliability and single-request analysis

## Goal
Make AI review available with actionable service setup, classify all unchecked subtitles correctly, and inspect the user's complete selected set in one JSON request rather than serial small requests.

## Confirmed evidence
Read-only local project metadata: first video has 269 cues and no reviewProfileId; second has 1027 cues with an existing review profile, and no completed report. No source text, API key or personal database mutation was used.
`SubtitleList.tsx` disables review when reviewProfileId is absent; `review-presentation.ts` unreviewed branch omits pending IDs; rubric help is rendered at the top of the independently scrolled subtitle list. `reviewWindows` uses at most 30-cue/24k-character batches with bounded neighbour context; main sends requests sequentially. Response already is strict JSON. REVIEW_EVIDENCE rejects unsupported adjacent evidence rather than a valid review.

## Requirements
- V1: Review action exposes/selects missing service with actionable feedback instead of an unexplained disabled control; existing jobs can use available text review profiles.
- V2: Include never-reviewed cues in the existing pending count/filter and add an explicit unchecked filter for that subset; keep current none, stale/legacy and current findings semantically distinct. Do not change automatic-loop qualifying findings by changing presentation counts.
- V3: Review all selected targets (all cues if no selection) in one bounded provider request, returning structured JSON with complete coverage. Do not silently partition the selection back into serial requests.
- V4: Keep canonical 30-cue context/dependency groups while aggregating transport. Validate every target against its original group, not the combined table. On malformed JSON/coverage/evidence permit at most one visible, complete-selection corrective generation; do not fabricate evidence or convert invalid findings to all-clear.
- V5: Show request phase/wait/progress/cancel; preflight explicit payload limits and explain oversize selection instead of provider truncation or unbounded retries.
- V6: Standards opens visibly regardless of list scroll, with accessible dismissal and native small-window coverage.

## Acceptance criteria
- [x] Missing profile path is actionable, stale profile references handled, and first saved project can reach review setup.
- [x] Fresh 269/1027-cue fixtures count all unreviewed cues in pending; current none and ignored findings remain semantically distinct.
- [x] A selected set crossing former 30-cue boundaries uses one request, validates every selected ID and preserves same chronological neighbour/evidence semantics.
- [x] Insufficient evidence regression has actionable bounded recovery/failure, cancellation and no partial report publication.
- [x] Native scroll-bottom standards opening and minimum/default geometry pass; loop rechecks share the revised review implementation.
- [x] 31/65/1027-target anonymous fixtures use exactly one successful mock HTTP request, preserve canonical groups, and reject fictional adjacency across disjoint selections.
- [x] Application limits of 2000 targets / 512 KiB complete UTF-8 prompt (including bounded correction reserve) reject before generation, with no silent batching. Truncation/cancel/auth/timeout do not trigger content correction.

## Out of scope
Streaming per-cue progress, new provider capability settings, global dialogue dependencies, arbitrary automatic service selection, real paid-provider benchmarks, and guaranteed speed/quality/model capacity.

## Dependencies
Uses existing loop extraction/lease and report schema. Coordinate main review implementation only after the current loop worker finishes; loop convergence/regressions must rerun after this child changes analysis. Frontend overlaps the layout child; sequence App/SubtitleList edits.

## Planning status

Latest combined final-planning-summary.md explicitly approved by user on2026-10-11 (批准). Child activated on codex/subtitle-repair-onboarding; implementation in progress. See task.json approval record.

## Final validation2026-10-12

Approved behavior implemented and independently reviewed. Global lint/typecheck/build passed; full unit/integration60files574pass; final native40total37pass/3explicitexternalgateskip/0fail. See parent evidence/final-added-e2e-review.md and final-unit.log. Implementation is not an AI accuracy guarantee. Task remains active pending required commit confirmation and bookkeeping; no release/version change.
