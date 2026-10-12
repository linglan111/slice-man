# Range repair planning addendum

User addition (2026-10-11): automatic repair must allow a selected time range for repeated repair of a chosen passage. Planning only; no product implementation.

## Repository evidence

- `src/shared/reprocessing-contracts.ts:20`: discriminated selection/range target; integer nonnegative ms. Main adds start-before-end and media-duration validation.
- `src/main/services/jobs/lib/reprocessing.ts:20`: range eligibility uses half-open overlap, so touching-only cues are excluded. Recognition recursively expands intervals over complete intersecting/overlapping cues; translation keeps cue IDs/time/source.
- `src/renderer/src/components/ReprocessingPanel.tsx`: reusable seconds inputs/validateCueTimes and main-computed actual-scope presentation. No need to invent a new time parser.
- `.trellis/spec/shared/subtitle-review-reprocessing.md`: existing whole-cue expansion contract, bounded review context and unaffected-content preservation.

## Recommended mechanics

Explicit all/range scope; fixed absolute requested times across rounds; select current cues each round because ASR generates new IDs. Filter risk eligibility by scope before routing. Scoped stale/missing review still receives chronological outside neighbours as evidence, but those neighbours are not repair targets solely because supplied. Terminal remaining counts refer to the selected scope. Invalid bounds fail before provider work; zero intersecting cues is no eligible targets, not an unsolicited ASR request.

## Product decision resolved

The user answered 接受 to the recommendation: reuse existing complete-cue/recursive-overlap ASR boundary expansion and display requested/effective scope. Crossing/overlapping cues can extend past requested bounds; content outside effective coverage remains unchanged. Strict typed-bound splitting/clipping/merge is out of scope. This answer resolves the boundary choice, while the updated complete planning summary still requires implementation approval.

## Tests

All/range selection; seconds conversion; start/end/media validation; exact boundaries; no cues; current IDs after multiple rounds; rerun same range; outside-only high risk; neighbour evidence without outside target promotion; affected overlap policy; scoped cap/remaining wording; expanded controls at native minimum window size.
