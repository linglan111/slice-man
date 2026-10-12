# Recurring person-name review and reversible bulk replacement

## Goal
Find recurring key person names in existing video subtitles, recommend consistent source/translated naming and let users inspect/edit/apply/revert a batch.

## Requirements
- N1: Analyze current subtitle source and active translation for recurring person names, display occurrences and AI recommended original/translated names; default editable proposed values to recommendations without auto-applying changes.
- N2: User can edit and select mappings and apply source/translated names atomically in a batch. Cancel before apply makes no content changes. Matching must be defined and verified to avoid replacing unrelated substrings or cascading aliases.
- N3: User confirmed rollback policy: undo only this name batch, preserve later manual edits; conflict entries remain unchanged and are explained. Do not restore an entire old timeline over later work.
- N4: Preserve IDs/times/styles/exports history; mark translations/review/derived outputs stale according to active source changes. Original-language projects do not invoke translation.
- N5: Main validates version/report/mapping/occurrence identity, finite payload and busy state; detect stale analysis before overwrite. Persist only the latest successful batch undo across restart; cancel/failure/no-op preserve it. A completed undo attempt consumes it and reports restored/skipped counts; no redo.
- N6: Integrate an accessible compact name-check/batch-edit panel with explicit review/apply/cancel/undo and counts; no silent provider calls or text application.

## Confirmed evidence and decisions
Parent `research/person-names.md` contains exact shared/IPC/service/store/timeline/style/test anchors. No name report or undo exists today. Use existing review text profile; no new provider adapter/dependency. Main verifies aliases by literal occurrences in at least two distinct cues, not model counts. Source and active translations have separate alias namespaces. Latin-like names use Unicode-aware boundaries; ambiguous CJK literals require visible context/user confirmation and initial recommendations exclude single-character CJK aliases.

The user confirmed conflict-preserving rollback. Per-field before/after comparison is conservative: if current text differs from the batch after-text, preserve the whole field and report it; other fields/cues/times/styles stay intact. Only the latest successful batch is retained, with at most 20000 field patches / 2000000 cumulative UTF-16 before/after units, checked before any content write.

## Acceptance criteria
- [x] Recurring names and suggestions are grounded in real cue occurrences, editable by user; hallucinated names/counts do not modify content.
- [x] Source and active translated names are handled separately, simultaneous replacement has no cascade, collisions/overlapping aliases have defined safe behaviour.
- [x] Apply is all-or-nothing; cancelled/error/stale work preserves content. Undo restores unchanged batch edits, retains later manual edits and reports conflicts.
- [x] Source-only makes zero translation calls; report/translation/output staleness and saved-project compatibility covered.
- [x] Native end-to-end analysis/edit/apply/cancel/undo/restart/conflict cases pass alongside existing loop/review/export regression.
- [x] A newer successful batch replaces undo history; no-op/cancel/failure does not. Conflict-only undo preserves content, reports skipped fields, and consumes the attempted batch.

## Out of scope
Acoustic speaker identification, guaranteeing real names/linguistic translations, repairing arbitrary later edits inside the same field, restoring deleted/re-recognized cue IDs, multi-level undo/redo, automatic batch application, and source-only translation calls.

## Dependencies
Depends on reviewed report/one-shot request and latest job atomic edit invariants. Main/shared files overlap loop and review children; sequence contract/service edits. Layout panel uses new operation toolbar; guide text finalized after control labels settle.

## Planning status

Latest combined final-planning-summary.md explicitly approved by user on2026-10-11 (批准). Child activated on codex/subtitle-repair-onboarding; implementation in progress. See task.json approval record.

## Final validation2026-10-12

Approved behavior implemented and independently reviewed. Global lint/typecheck/build passed; full unit/integration60files574pass; final native40total37pass/3explicitexternalgateskip/0fail. See parent evidence/final-added-e2e-review.md and final-unit.log. Implementation is not an AI accuracy guarantee. Task remains active pending required commit confirmation and bookkeeping; no release/version change.
