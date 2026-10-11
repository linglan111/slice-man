# Optional Translation, Partial Processing and AI Review

## 1. Scope / Trigger
Read when changing import mode, source-only display/export, partial recognition/translation, contextual AI review or finding applicability. Schemas live in `src/shared/reprocessing-contracts.ts`, re-exported by `contracts.ts`; content selection lives in `src/shared/subtitle-content.ts`. Fixed review definitions live in `src/shared/review-rubric.ts`. Main JobService owns publication and cancellation.

## 2. Signatures
```typescript
api.jobs.importVideo({ translationEnabled, sourceLanguage, targetLanguage });
api.download.importUrl({ url, options: { translationEnabled, sourceLanguage, targetLanguage } });
api.jobs.planReprocess({ jobId, revision, operation: 'recognize', target });
api.jobs.recognizePartial({ jobId, revision, target, translate: false });
api.jobs.translatePartial({ jobId, revision, target });
api.jobs.reviewSubtitles({ jobId, revision, segmentIds /* optional: full scan if absent */ });
api.jobs.acknowledgeFinding({ jobId, reportId, findingId, status: 'ignored' });
```
`target` is `{ mode: 'selection', segmentIds }` or `{ mode: 'range', startMs, endMs }`. All methods use `Result<T>`. Plans include `intervals`, `segmentIds`, `affectedCount`, operation and snapshot revision. Processing/review returns the persisted Job.

## 3. Contracts
- Import UI always supplies the project-wide translation choice. `translationEnabled` defaults to true only for compatibility with legacy missing options/API callers. Both local and URL import commit initial options with the Job, not through a later loosely coupled settings mutation.
- Original-only mode prohibits all translation provider calls, hides/disables translation controls, and uses source text in inline/native fullscreen captions, subtitle files and burn-in even when stored translations exist. Preserve stored translations when toggling modes. `primarySubtitleText`/`subtitleText` own main/shared selection; renderer helpers must follow the same explicit Job option.
- Recognition plans recursively expand over whole intersecting cues using half-open interval overlap and merge overlapping/touching ranges. Separate positive gaps remain unprocessed. Additional overlapping cues appear in the effective plan before replacement. Translation retains exactly selected IDs, or existing cues intersecting a time range, and never changes source timing.
- Main validates/recomputes the plan; renderer intervals are not trusted. Busy/stale checks precede expensive operations and repeat before atomic content publication.
- Partial ASR crops actual source audio and applies the video offset exactly once. Normalize against clip bounds first. Fresh cue IDs prevent collisions and old emphasis binding. Preserve every unaffected cue/translation/emphasis and historical export path; invalidate derived outputs only after committed content changes.
- Draft all recognition ranges plus optional translations before publication. Failed/cancelled combined work retains the entire previous target. Cleanup of owned temporary files must precede publication or be non-failing; never await cancellation-sensitive cleanup after committing and then report that old text was retained.
- Successful silent recognition can remove target cues; silence is distinct from failed/malformed output. Partial stage messages describe the actual operation, not full-video coverage.
- Review uses an independent `reviewProfileId` text service. It sends cue timing, source text, active translation and bounded chronological dialogue, never source audio. Model output is strict `{ assessments: [{ segmentId, issues: [{ ruleId, reason, evidenceIds }] }] }`. Every target must appear exactly once; an explicit empty issue list means none, whereas omitted targets fail. Unknown rules/IDs, duplicate rules/evidence and references outside supplied dialogue fail before report publication. Review never supplies replacement text/timestamps or acoustic guarantees.
- `contextual-review-v1` is the canonical fixed rubric. Closed rule IDs map to category and risk level; main derives each finding's level and the maximum cue level. The model cannot override grade/category or add numeric scores. Shared rules, examples and counterexamples are used by the prompt and renderer explanation. Changes to rule meaning, mapping, examples or thresholds require a rubric version bump. None means no obvious suspicion detected, not unreviewed or proven acoustic correctness.
- Source contextual inconsistency/omission rules need evidence including the target and at least one nearby cue. High sustained source breakdown requires the target plus at least two neighbouring cues within two positions. Topic changes, quotations, humour, unfamiliar names and ordinary spoken ellipsis alone cannot establish a high issue. High translation rules cover strong negation/key-quantity contradictions, excluding legitimate unit conversion, formatting or contextual reversals.
- High timing rule `timing.severe_readability` has a fixed application heuristic: primary active subtitle text (nonempty translation when enabled, otherwise source) has at least 20 non-whitespace Unicode code points and duration is at most 500ms or reading density at least 45 characters/second. Main validates this prerequisite rather than allowing arbitrary model escalation. This is an application suspicion rule, not a claim of an industry reading-speed standard or audio alignment.
- Review is explicitly requested, cancellable and bounded by both cue count and serialized text size. Oversized individual text fails with an actionable limit; context has its own budget. Track actual cumulative coverage, not an assumed fixed batch size.
- Canonical windows partition the whole sorted timeline into contiguous batches of at most 30 cues/24k serialized characters, plus at most two adjacent neighbours on each side under an 8k-character budget. Full scan and selected recheck use identical chronological context windows; selected IDs only shrink the graded targets. Never join distant selected cues into fictional continuous dialogue. Core and supplied context IDs/fingerprints form a context-group hash, with rubric version and project mode.
- Optional `Job.reviewReport` stores provider fingerprint, inspected cue fingerprints/IDs, findings, timestamps and complete/stale applicability. New optional `assessments`, `contextGroups`, `rubric` snapshot and `translationEnabled` metadata keep legacy jobs readable and ungraded. Assessment has risk level, current/recheck status, contextGroupId and findingIds. Findings retain pending/ignored/recheck state, captured time and optional level/rule/evidence/context metadata.
- Recompute canonical context signatures when content changes. A changed, inserted, removed or replaced contextual cue invalidates every dependent assessment (including none) and finding. Unaffected context groups can remain current. Mode/profile/model/rubric changes invalidate applicable grades. New ASR cue IDs never inherit an old current grade; remapped historical findings clear old grade/rule/evidence/context metadata and remain recheck reminders. A rerun does not automatically verify recognition correctness.
- Review/ignore metadata does not increment the media revision or invalidate exports. Metadata writes still use busy/report/finding guards, and async report publication checks the inspected revision/provider. Failed scans do not replace valid reports with an incomplete all-clear.

## 4. Validation & Error Matrix
| Event | Required result |
| --- | --- |
| Disabled translation requested directly through IPC | `TRANSLATION_DISABLED`, no translation call |
| Stale timeline revision / active work | `STALE_REVISION` / `JOB_BUSY`, no content replacement |
| Duplicate/unknown selected IDs | `DUPLICATE_ID` / `NOT_FOUND` |
| Invalid/reversed/out-of-media range | `TIMING_INVALID` |
| Time translation target has no cues | `NO_SEGMENTS`, no provider request |
| ASR success then translation error/cancel | Prior target timeline/style survives |
| Review missing profile / oversized cue | `PROFILE_MISSING` / `TEXT_LIMIT` |
| Unknown/duplicate/inapplicable model cue/rule/evidence | `REVIEW_IDS` (unknown enum/malformed shape: `REVIEW_INVALID`) |
| Model omits any target / insufficient context or timing evidence | `REVIEW_INCOMPLETE` / `REVIEW_EVIDENCE`, retain previous report |
| Finding/report changed or no longer applies | `STALE_REVIEW`, no blind acknowledgment |
| Edited/replaced cue after review | Finding pending recheck, not silently correct |
| Edited/inserted/deleted neighbour after a none-level assessment | Dependent assessment recheck, never silently still clear |
| Legacy/unreviewed cue | Ungraded, never inferred as none from absent findings |

## 5. Good / Base / Bad Cases
- Good: import original-only, run local recognition, review suspicious text with an independent text profile, repair one expanded passage and export source subtitles without a translation request.
- Base: translated project reprocesses selected cues, explicitly requests combined translation and commits only complete successful results.
- Bad: one checkbox controls only the primary generation action while retry/repair/fullscreen/export silently translate or show old target-language text.

## 6. Tests Required
- Legacy defaults, explicit import choice through both paths, disabled direct translation, source-only caption/compiler output with stored translations and mode toggles.
- Disjoint/overlapping/gap/boundary target plans, server scope equality, clip-local normalization and actual cropped/delayed audio. Preserve unaffected cues and styles; fresh IDs and silence behaviour.
- Atomic combined translation failure/cancellation, cleanup/publication ordering, busy/stale guards and persisted/exported corrected timeline.
- Review strict all-target output, fixed rule-to-grade derivation, evidence prerequisites/refs, complete coverage, prompt/context limits, full-vs-selected context equality, batch boundaries/disjoint targets, cancel/failure retention, provider changes, report restart/ignore and stale/recheck after CRUD/replacement of targets or neighbours (including previously none).
- Grade badges/filter counts/select-and-repair, unreviewed/legacy/stale distinctions and shared standards help must retain usable default/minimum-window video/list/form space.
- Actual isolated Electron workflows and default/minimum-window screenshots; do not call deterministic provider fixtures acoustic or linguistic accuracy evidence.

## 7. Wrong vs Correct
Wrong: commit new ASR text, invoke translation, then tell the user cancellation retained their previous target when translation fails.

Correct: build a draft for all requested phases, complete cleanup/validation, check revision/cancellation immediately before one atomic target replacement, then publish success.
