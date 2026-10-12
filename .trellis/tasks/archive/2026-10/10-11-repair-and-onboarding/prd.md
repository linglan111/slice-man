# Subtitle auto-repair and first-run guide

## Goal

Reduce repeated subtitle review/repair operations and help new users discover Slice Man's workflow. Users start one bounded, cancellable repair operation and can replay a short guide at any time.

## Background and authorization

The user requested inclusive AI-risk automatic repair with configurable maximum rounds, confirmed source/timing recognition versus translation-only retranslation, and added first-open navigation plus a repeatable `?` entry. They subsequently added time-range reruns and accepted complete-cue/recursive-overlap boundary expansion with actual-scope display. R1–R8 implementation was explicitly approved on 2026-10-11 and is under independent full regression. Later R9–R11 additions were approved after the latest combined planning summary on2026-10-11.

Research is recorded in `research/repair-loop.md` and `research/first-run-guide.md`, including exact source/test anchors. Existing manual operations release their own controllers (`job-service.ts:739`, `:780`, `:931`); a safe loop needs one main-process owner. Existing Modal and common App header supply accessible guide integration (`Modal.tsx:13`, `App.tsx:194`).

## Requirements

- R1: User-triggered automatic repair at or above low/medium/high; proposed default medium and 3 repair rounds, editable from 1 to 20. Initial/repeated analysis does not count as a repair round.
- R2: Route qualifying pending source/timing issues to recognition; qualifying translation-only issues to retranslation. Recognition wins if both qualify on a cue. Original-language projects never invoke translation.
- R3: Reassess missing/stale/new/context-dependent content before selecting the next round. Stop on no qualifying unignored findings, maximum rounds, cancellation, error or interruption, and explain the result without claiming acoustic correctness.
- R4: Keep one operation lock/controller throughout the loop. A complete repair round publishes atomically; prior committed rounds survive a later failure. Preserve ignore intent only while content/context/provider/rubric identity remains current.
- R5: First successful opening shows a six-step Chinese feature guide; dismissal/completion is remembered. A persistent common-header `?` reopens it from the beginning without importing, calling AI or changing workspace state.
- R6: Keep common proofreading and cancel controls visible in the right panel at 1440x960 and 1050x700, preserving draggable sizing and collapsible secondary controls.
- R7: Delegate final independent review and native Electron E2E regression; distinguish deterministic provider fixtures from real external/native checks and disclose gated skips.
- R8: Automatic repair supports all subtitles or an explicit start/end time range so users can rerun a chosen passage with its own threshold and round cap. Keep the requested absolute interval fixed across rounds and select fresh cue IDs by current overlap, not cached selection. User-approved ASR policy expands crossing/overlapping cues to their complete boundaries, displays requested versus effective scope, and preserves content outside that effective scope.
- R9 (added scope): Fix missing-service review entry, unreviewed counts, invisible standards and invalid evidence handling; inspect the entire selected set using one bounded structured-JSON request.
- R10 (added scope): Expose generation/style/export in the preview operation toolbar, move generation/style settings to lower-left access, use compact two-column operation forms and requested proofreading button placement.
- R11 (added scope): Detect recurring person names, suggest editable source/translated mappings, apply an explicit batch and support rollback that preserves later manual edits and explains conflicts (user-confirmed rollback policy).

## Task map

| Child | Deliverable |
| --- | --- |
| `10-11-risk-repair-loop` | Contracts, main-owned loop, compact controls, persistence and tests |
| `10-11-first-run-guide` | First-run guide, help entry, accessible replay and genuine first-run tests |
| `10-11-review-reliability` | Review setup, unchecked counts, single-request JSON and evidence handling |
| `10-11-operation-workspace` | Visible common actions, compact two-column panels and settings placement |
| `10-11-person-name-review` | Grounded name recommendations, explicit batch apply/cancel and safe rollback |

## Acceptance criteria

- [x] AC1 (R1–R4): Medium includes medium/high, configuration validation is enforced in main, rounds are bounded and every final successful repair receives reassessment.
- [x] AC2 (R2–R4): Mixed issues/overlapping recognition ranges/new cue IDs route correctly; source-only has zero translation calls; cancellation/conflicts never publish an incomplete round.
- [x] AC3 (R3–R4): Progress shows round/phase/count and final reason; a cap, cancelled reassessment or interrupted restart never displays all-clear.
- [x] AC4 (R5): Fresh user data shows navigation; close/Escape/finish survives restart; `?` works on empty/populated workspaces and with collapsed sidebar. Startup errors remain visible.
- [x] AC5 (R5–R6): Native keyboard focus, small-window geometry and common control access pass real Electron tests; opening help during an active job has no operation side effects.
- [x] AC6 (R7): Required lint/type/unit/integration/build checks and delegated regression pass, or concrete limitations are reported. README usage matches the implemented features.
- [x] AC7: Automatic publication remains exclusive to `release`; this feature is developed on a `codex/` branch and is not published as part of this task.
- [x] AC8 (R8): Validate time bounds against media duration, handle exact boundary/no-cue cases, and report scoped remaining counts. Repeat repair of the same interval works after cue IDs change. Outside context may inform review without becoming an automatic target.
- [x] AC9 (R9): Missing review service is actionable; every never-reviewed cue appears unchecked; standards opens from list bottom. Anonymous 31/65/1027 selected-cue fixtures use one successful HTTP generation with complete strict JSON and original canonical evidence groups. At most one visible complete corrective generation; error/cancel never publishes a partial report. Oversize/truncation gives actionable failure without serial fallback.
- [x] AC10 (R10): Generation/style/export/name operations are in preview toolbar; generation/style settings are lower-left. Every default/minimum native operation panel has two columns and visible execute/cancel without scrolling; Add follows AI check and Follow precedes Standards. Drag/reset/restart/media-controls/import/manual/style/export still work.
- [x] AC11 (R11): Names are grounded in repeated actual occurrences and recommendations require user apply. Source/translation replacement is atomic and noncascading; cancel/no-op/failure preserve content. Latest-batch restart undo retains later edits and explains skipped same-field/deleted-cue conflicts. Source-only has no translation calls and derived/report/style state remains valid.

## Out of scope

Background/startup repair, automatic model switching, guaranteed AI convergence, undo/history for previously committed rounds, cloud provider changes, paid-service credentials, free module rearrangement, and release/version automation changes.

## Planning status

R1–R8 implementation and independent regression complete: lint/typecheck/build pass,54files497unit/integration pass,full native32pass/3explicit gate skips/0fail,affected native9pass. Evidence: `evidence/regression-review.md`. R9–R11 research, PRD convergence, design, implementation plans and curated context are complete; the user subsequently approved the latest final summary and all three children are now in progress. Confirmed name rollback preserves later edits with conflict reporting; proposed implementation retains only the latest successful batch. No blocking product question remains before final review.

## Final validation2026-10-12

Approved behavior implemented and independently reviewed. Global lint/typecheck/build passed; full unit/integration60files574pass; final native40total37pass/3explicitexternalgateskip/0fail. See parent evidence/final-added-e2e-review.md and final-unit.log. Implementation is not an AI accuracy guarantee. Task remains active pending required commit confirmation and bookkeeping; no release/version change.
