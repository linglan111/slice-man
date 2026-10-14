# Research: final parent/child planning consistency audit

- Query: Audit converged parent requirements/design/execution and four child dependencies for blocking contradictions, omitted user features or materially incorrect repository assumptions before final user planning review.
- Scope: internal
- Date: 2026-10-13
- Result: **No blocking contradiction or omitted requested feature found.** This is planning review, not implementation/test certification.

## Findings

### Artifacts inspected

- Parent `.trellis/tasks/10-13-ai-chapters-resumable-tools/{prd,design,implement}.md`: converged requirements, shared architecture, sequencing/review gates and native validation.
- Children `.trellis/tasks/10-13-ai-streaming-diagnostics/{prd,design,implement}.md`, `10-13-chapter-translation-review/{prd,design,implement}.md`, `10-13-resumable-managed-tools/{prd,design,implement}.md`, `10-13-custom-chapter-export/{prd,design,implement}.md`: scope mapping, ownership and repeated explicit dependencies. These are short boundary documents delegating full detail to the parent, not independent conflicting designs.
- Read-only repository spot checks: `src/shared/contracts.ts:79` current120s default/300s cap; `services/providers/lib/text-provider.ts:25,49` complete body/retry timing; `services/runtime/artifacts.ts:34` shared artifact entry point and runtime/download installer consumers; `src/main/db/migrations.ts:2` bundled versioned migration array. Export/Job/IPC/SQLite/UI evidence remains recorded in `chapters-export-criteria.md`.
- Did not read implementation/check JSONL manifests, alter task state, run tests, or edit product/spec files.

### User decisions and integrity checks

| Audit concern | Converged plan assessment |
| --- | --- |
| Partial streamed output must not become valid product data | Parent PRD R1 and design Streaming lifecycle require terminal protocol success plus strict operation validation; retained partial files remain diagnostics only. EOF/truncation/refusal/cancel never becomes subtitles/report/plan. |
| Deadline configuration vs consent |30min overall,120s existing profile header/idle and1–60min overall bounds are clearly labelled reviewable defaults. They do not claim individually approved settings. No repeated full generation after a partial/expired response; same-response JSON compatibility avoids hidden duplicate POST. |
| Strict>30minute review gate | PRD R4 explicitly uses video duration>30minutes; exactly30minutes remains a complete selected-set logical request. Design repeats1800000ms; sparse selection does not change the gate. |
| Retain approved completed review chapters | PRD R4 records user `保留`, validates each complete target subset before save, preserves pending/failed coverage and resumes only compatible remaining work. Repair stops on incomplete prerequisite/reassessment; no fabricated none/all-clear. |
| Cross-chapter evidence/ignore semantics | Design passes original full timeline to existing builder, partitions only target IDs once and retains canonical context groups/ordinals. Scoped merges preserve compatible unaffected assessment/ignore state and invalidate altered dependencies. |
| Global inconsistent person names | Names stays full timeline and globally grounded through streaming; it is not reduced to chapter-local identity detection. No omitted user goal. |
| Default chapter translation and concurrency | R3 clearly declares default chapter translation, short<=20minute deterministic coverage without extra analysis, bounded pieces for dense chapters, proposed2 workers/configurable1–3. Source/timing/selection integrity and serialized fresh commits are required. The short/concurrency behaviors are reviewable defaults, not prior explicit approval. |
| Existing scoped/combined/repair atomicity | R3/design preserve all-target draft publication for scoped/combined/repair; only whole translation retains completed chapters. No child states a contrary per-piece scoped save. |
| Source-only | PRD R3 says never translate; shared chapter analysis/review remains a text operation with explicit selected provider. Original cue text drives planning so translated publication does not stale its own plan. |
| Normal vs custom plans | R2 normal partitions full media; custom is separate ordered sparse/empty result, never substitute normal coverage. Title/summary/range editing, selection and seek explicitly included.20minute cap handles non-cue fallback anchors without mutating canonical cues. |
| Editable saved standards | R6/design include seeded core/interesting/highlight defaults, add/edit/copy/delete/select, one active standard, immutable versioned plan snapshots. Deleting selected clears selection; empty library persists empty with seed marker, not auto-restored. |
| Native exact range export | R6/design require actual range render and clip-duration probe/decode, half-open boundary cue clipping/rebasing, preservation of A/V offset and current style/emphasis/options. Not merely subtitle filtering or filename change. |
| Windows filenames and retention | Main chooses directory; bounded safe title allocation handles reserved/duplicate/case/trailingdot/existing paths with suffixes and authoritative no-clobber publication. Completed verified clips survive later failure/cancel; retry validates source/plan/options/file identity. No montage/clean-video expansion. |
| Download scope and resume | R5 covers CPU/GPU archives+3models+yt-dlp+Deno (7 assets), durable pinned cache, graceful/abrupt restart, actual bytes, Range206/200/416/hash/native checks and old activation preservation. Online-video downloading and CI/developer asset downloads explicitly excluded, consistent with tools-only request scope. |
| UI/native validation | R7/implementation require natural bottom panel, all three native sizes, one-close local scrolling and existing combined right results. Actual FFmpeg/SQLite/transferred-byte/native Electron evidence plus independent review, global checks and packaged smoke are named. |

### Parent/child dependency audit

- A owns streaming+diagnostics foundation with no dependency; B depends on its typed request/file/log contract and does not integrate defaults until foundation checks pass.
- C is independent and owns cache/runtime/managed downloader changes, coordinating IPC but avoiding chapter/provider modules.
- D depends on A/B and reuses the one chapter planner/shared contracts. Owns standards, range export and integrated UI. Parent coordinates shared App/IPC/JobService/schema touches, including additive migration ordering.
- Each child points to the same authoritative parent PRD/design/implementation and explicitly awaits final parent approval. No child assumes planning consent permits product implementation.
- One main operation lease spans concurrent provider work; abort/settle remaining tasks before release and deterministic coordinator saves avoid shared revision races. Parent verifies original-only/profile/key/source staleness cross-layer.

### Relevant repository facts and implementation guardrails

These are non-blocking execution checks already encompassed by the plan; they do not justify extra product permission questions:

1. Provider `timeoutMs` is currently maximum300000ms. New overall text deadline must be a separate typed additive setting rather than raising/reinterpreting the existing profile field and accidentally changing ASR/non-text deadlines.
2. Existing stage/report contracts and progress schemas are strict. New chapter/run coverage needs shared optional/versioned schemas and typed main/preload/result changes, not renderer-only pending labels.
3. Existing metadata saves and media revision changes have different semantics. Whole-translation coordinator must distinguish its own prior chapter commits from external source/provider mutation, while review metadata must not incorrectly stale media outputs.
4. Two children require SQLite additions. Parent must assign migration edit/merge ownership and order so migration version IDs are unique; additive installed-ASAR legacy fixtures are required. Criteria snapshots must remain independent of live-library deletion.
5. Export no-clobber file publication and SQLite update cannot form one ordinary SQL transaction. Per-clip resume must reconcile published-file/persist-failure boundaries and never remove an unowned/existing file during generic cleanup.
6. Old research suggestions are superseded: criteria persistence is now SQLite (not JSON), deleting selected clears selection (not silent fallback), global provider selection follows the converged explicit/disclosed service rule, and incremental review retention is approved. Implementers must treat current parent artifacts as authoritative.

### Related specs

Existing contracts to preserve or intentionally update: `.trellis/spec/shared/subtitle-contracts.md`, `subtitle-review-reprocessing.md`, `person-name-review.md`, `.trellis/spec/backend/export-preferences.md`, `.trellis/spec/frontend/operation-workspace.md`, `.trellis/spec/guides/db-schema-change-guide.md`. Existing single-request review rules require an explicit scoped long-video extension, not weakening ID/evidence/coverage validation.

## Caveats / Not Found

- No new passing tests, real-provider latency, accuracy or token-savings evidence exists at planning time. Converged artifacts correctly avoid such claims and require measurement.
- Retained partial cloud text does not resume an unsupported remote generation; complete validated chapters may resume locally, incomplete individual requests need explicit retry.
- No further blocking product decision remains in this audit scope. Final summary should visibly present proposed timing/concurrency/short-video behavior for the user's implementation approval.
- Wrote only this research file; product code/specs/tasks/Git state were not changed.
