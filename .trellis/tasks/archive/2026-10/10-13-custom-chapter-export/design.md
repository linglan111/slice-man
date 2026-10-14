# Design boundary

## Dependencies
Depends on ai-streaming-diagnostics for all new AI calls and chapter-translation-review for shared normal/custom plan contracts, source fingerprint and planner. Do not create a second planner or parallel copy of chapter schema.

## Ownership
SQLite standards library/one active criterion/snapshots, chapter editing/selection UI, safe title filename allocation and exact media/subtitle range export, per-clip result/run resume, integrated App/modal/preload/IPC controls.

Follow ../10-13-ai-chapters-resumable-tools/design.md for contract, data flow, capacity, failure/publication, compatibility and cleanup rules. Parent coordinates shared App/JobService/IPC/schema files; do not overwrite other workers. A material design change returns to parent planning review.

## Evidence
Load curated specs/research in implement.jsonl/check.jsonl, with child-side loading if native injection is absent. No newly passing test claim is made during planning.
