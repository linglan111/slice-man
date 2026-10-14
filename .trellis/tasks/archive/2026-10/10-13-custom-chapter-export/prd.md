# custom-chapter-export

## Goal and scope
Implement parent R6 and integrated chapter/criteria/export UI in R7 after final parent planning approval.

## Dependencies
Depends on ai-streaming-diagnostics for all new AI calls and chapter-translation-review for shared normal/custom plan contracts, source fingerprint and planner. Do not create a second planner or parallel copy of chapter schema.

## Requirements and acceptance
SQLite standards library/one active criterion/snapshots, chapter editing/selection UI, safe title filename allocation and exact media/subtitle range export, per-clip result/run resume, integrated App/modal/preload/IPC controls.
Required verification: Criteria create/edit/copy/delete/empty-library restart, source/range stale guards, single-close/minimum-window controls, selected native seek/export, actual FFmpeg audio offsets/subtitle clipping/rebase/durations/codecs, duplicate/reserved/existing filenames and completed clip retention.

Authoritative full requirements: ../10-13-ai-chapters-resumable-tools/prd.md. Preserve its user decisions, compatibility, no paid/external action limits and all applicable acceptance checks.

## Status
Planning only; final parent summary requires subsequent implementation approval. No product code has been changed.
