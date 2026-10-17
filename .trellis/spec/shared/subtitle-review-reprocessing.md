# Optional Translation, Partial Processing and AI Review

Reusable full-chapter batching, service concurrency and streamed diagnostics follow [ai-chapters-and-artifacts.md](./ai-chapters-and-artifacts.md). Chapter review applies at every duration; there is no30-minute bypass or intra-chapter transport subdivision. Scoped content processing keeps its atomic contract. Recognition and whole-timeline person-name checking are exempt from chapter splitting.

## 1. Scope / Trigger
Read when changing import mode, source-only display/export, partial recognition/translation, contextual AI review, bounded automatic repair or finding applicability. Schemas live in `src/shared/reprocessing-contracts.ts`, re-exported by `contracts.ts`; content selection lives in `src/shared/subtitle-content.ts`. Fixed review definitions live in `src/shared/review-rubric.ts`. Main JobService owns publication and cancellation.

Recurring-name schemas, grounded matching and persistent conflict-preserving batch undo are defined in [person-name-review.md](./person-name-review.md). Visible action/settings placement and native all-control fit are defined in [operation-workspace.md](../frontend/operation-workspace.md).

## 2. Signatures
```typescript
api.jobs.importVideo({ translationEnabled, sourceLanguage, targetLanguage });
api.download.importUrl({ url, options: { translationEnabled, sourceLanguage, targetLanguage } });
api.jobs.planReprocess({ jobId, revision, operation: 'recognize', target });
api.jobs.recognizePartial({ jobId, revision, target, translate: false });
api.jobs.translatePartial({ jobId, revision, target });
api.jobs.reviewSubtitles({ jobId, revision, segmentIds /* optional: full scan if absent */ });
api.jobs.acknowledgeFinding({ jobId, reportId, findingId, status: 'ignored' });
api.jobs.repairLoop({ jobId, revision, threshold: 'medium', maxRounds: 3,
  scope: { mode: 'range', startMs: 10000, endMs: 30000 } });
api.jobs.cancel(jobId);
```
`target` is `{ mode: 'selection', segmentIds }` or `{ mode: 'range', startMs, endMs }`. All methods use `Result<T>`. Plans include `intervals`, `segmentIds`, `affectedCount`, operation and snapshot revision. Processing/review returns the persisted Job.

Repair `scope` is `{ mode: 'all' }` or `{ mode: 'range', startMs, endMs }`; threshold is low/medium/high and maxRounds is an integer 1–20. `Job.repairRun` is optional bounded last-run metadata, not a content option. Repair progress uses validated stage `repair` and run identity.

## 3. Contracts
- Import UI always supplies the project-wide translation choice. `translationEnabled` defaults to true only for compatibility with legacy missing options/API callers. Both local and URL import commit initial options with the Job, not through a later loosely coupled settings mutation.
- Original-only mode prohibits all translation provider calls, hides/disables translation controls, and uses source text in inline/native fullscreen captions, subtitle files and burn-in even when stored translations exist. Preserve stored translations when toggling modes. `primarySubtitleText`/`subtitleText` own main/shared selection; renderer helpers must follow the same explicit Job option.
- Recognition plans recursively expand over whole intersecting cues using half-open interval overlap and merge overlapping/touching ranges. Separate positive gaps remain unprocessed. Additional overlapping cues appear in the effective plan before replacement. Translation retains exactly selected IDs, or existing cues intersecting a time range, and never changes source timing.
- Main validates/recomputes the plan; renderer intervals are not trusted. Busy/stale checks precede expensive operations and repeat before atomic content publication.
- Partial ASR crops actual source audio and applies the video offset exactly once. Normalize against clip bounds first. Fresh cue IDs prevent collisions and old emphasis binding. Preserve every unaffected cue/translation/emphasis and historical export path; invalidate derived outputs only after committed content changes.
- Draft all recognition ranges plus optional translations before publication. Failed/cancelled combined work retains the entire previous target. Cleanup of owned temporary files must precede publication or be non-failing; never await cancellation-sensitive cleanup after committing and then report that old text was retained.
- Successful silent recognition can remove target cues; silence is distinct from failed/malformed output. Partial stage messages describe the actual operation, not full-video coverage.
- Review uses an independent `reviewProfileId` text service. Each targeted chapter gets one generation containing its entire timing/source/active-translation context and explicit selected targets; source audio is not sent. Deduplicated cue tables/canonical groups retain original global ordinals and gaps. Strict compact wire output is `{ a: [[targetOrdinal, [[ruleId, reason, [evidenceOrdinals]]]]] }`; normalize to internal assessments after strict checks. Every target appears once; explicit empty issues means none, omissions fail. Validate each against its ORIGINAL local canonical evidence group, not the whole chapter as fictional adjacent dialogue. Unknown/duplicate/out-of-group claims fail. Review alone never supplies replacement text/times or acoustic guarantees; repair adjudication is a separate validated phase.
- `contextual-review-v1` is the canonical fixed rubric. Closed rule IDs map to category and risk level; main derives each finding's level and the maximum cue level. The model cannot override grade/category or add numeric scores. Shared rules, examples and counterexamples are used by the prompt and renderer explanation. Changes to rule meaning, mapping, examples or thresholds require a rubric version bump. None means no obvious suspicion detected, not unreviewed or proven acoustic correctness.
- Source contextual inconsistency/omission rules need evidence including the target and at least one nearby cue. High sustained source breakdown requires the target plus at least two neighbouring cues within two positions. Topic changes, quotations, humour, unfamiliar names and ordinary spoken ellipsis alone cannot establish a high issue. High translation rules cover strong negation/key-quantity contradictions, excluding legitimate unit conversion, formatting or contextual reversals.
- High timing rule `timing.severe_readability` has a fixed application heuristic: primary active subtitle text (nonempty translation when enabled, otherwise source) has at least 20 non-whitespace Unicode code points and duration is at most 500ms or reading density at least 45 characters/second. Main validates this prerequisite rather than allowing arbitrary model escalation. This is an application suspicion rule, not a claim of an industry reading-speed standard or audio alignment.
- Review is explicitly requested and cancellable. Each admitted chapter request enforces `MAX_REVIEW_TARGETS=2000`, `MAX_REVIEW_PROMPT_BYTES=512*1024` complete UTF-8 bytes including `REVIEW_CORRECTION_RESERVE_BYTES=8192`; these do not guarantee model token capacity. Retain individual-text/canonical-context guards. Oversize/truncation requires explicit chapter/selection adjustment or a suitable model, never hidden subdivisions. Show preparing/waiting/validating with indeterminate progress until actual validated coverage; no invented per-cue progress during generation.
- At most one additional COMPLETE-selection logical generation may correct `INVALID_JSON`, `REVIEW_INVALID`, `REVIEW_IDS`, `REVIEW_INCOMPLETE` or `REVIEW_EVIDENCE`. Show correction1/1 and preserve identical original target/context payload. Trusted bounded diagnostics use aliases/rules/admitted neighbours, not raw provider output or subtitle content. Never synthesize evidence, clamp risk, omit targets or downgrade invalid results to none. Cancellation, truncation, provider auth/network/timeout/rate/refusal, input limits and stale revisions do not trigger content correction. Existing transport retries are separate. Unsuccessful correction retains the previous report and returns actionable failure. One continuous owner covers generation/correction/validation and immediate pre-publication abort/freshness checks.
- Canonical windows partition the whole sorted timeline into contiguous groups of at most 30 cues/24k serialized characters, plus at most two adjacent neighbours on each side under an 8k-character budget. These remain dependency/evidence groups, not separate provider requests. Full scan and selected recheck use identical context windows; selected IDs only shrink graded targets. Never join distant selected cues into fictional continuous dialogue or permit evidence merely because a cue appears elsewhere in the request. Core/context IDs/fingerprints form a context-group hash with rubric version and project mode.
- Optional `Job.reviewReport` stores provider fingerprint, inspected cue fingerprints/IDs, findings, timestamps and complete/stale applicability. New optional `assessments`, `contextGroups`, `rubric` snapshot and `translationEnabled` metadata keep legacy jobs readable and ungraded. Assessment has risk level, current/recheck status, contextGroupId and findingIds. Findings retain pending/ignored/recheck state, captured time and optional level/rule/evidence/context metadata.
- Recompute canonical context signatures when content changes. A changed, inserted, removed or replaced contextual cue invalidates every dependent assessment (including none) and finding. Unaffected context groups can remain current. Mode/profile/model/rubric changes invalidate applicable grades. New ASR cue IDs never inherit an old current grade; remapped historical findings clear old grade/rule/evidence/context metadata and remain recheck reminders. A rerun does not automatically verify recognition correctness.
- Review/ignore metadata does not increment the media revision or invalidate exports. Metadata writes still use busy/report/finding guards, and async report publication checks the inspected revision/provider. Failed scans do not replace valid reports with an incomplete all-clear.
- Automatic repair is explicitly user-triggered and has one main-owned operation lease/AbortController covering initial analysis, every round, reassessment and termination. Reuse private trusted primitives rather than chaining public wrappers, releasing the busy lock between rounds or exposing client skipBusy flags.
- Eligibility uses current compatible canonical pending findings whose risk rank meets the inclusive threshold. Ignored high plus pending low is not eligible for medium. EVERY qualifying target receives fresh ASR and enabled translation, including translation-only issues; old category-only routing is superseded. Source-only never resolves/calls translation. Preflight required services and translation readiness before translated ASR.
- Requested range is validated against media duration and stays fixed across rounds. Select current IDs by half-open overlap every round; new recognition IDs cannot escape scope checks. Outside dialogue is review evidence, not an implicit repair target. Empty scope means no eligible targets, not a request to generate missing speech.
- ASR uses complete-cue/recursive-overlap expansion; show requested/effective bounds. Fresh cues replace only effective coverage. Preserve outside content; do not promise crossing/overlapping cues outside typed bounds remain untouched. Reuse/rebind run chapter boundaries for fresh IDs without repeatedly paying to plan chapters.
- After fresh ASR/enabled chapter translation, send one adjudication per affected chapter with full old/new chapter times/text, prior suspicion and explicit original-to-replacement mappings. Require all targets exactly once and all outputs referenced, known IDs, bounded times, correct language mode and per-target acoustic/time linkage. Fresh IDs must link to target and output; moving unrelated fresh evidence onto a target is invalid. Splits/merges/silence require explicit mappings, never inferred omissions. Cross-chapter fresh cues are evidence for every affected target; outputs must agree globally before one publication. Never silently duplicate/drop conflicting cross-chapter results or alter context-only neighbours.
- Draft a whole round across recognition/translation/adjudication and publish once after cleanup and final abort/revision/provider checks. Increment media revision once. Failed/cancelled drafts publish no partial round; earlier commits remain. Explicitly invalidate original targets/new replacements even when reviewed content is unchanged. Reassessment saves grades separately; failure retains committed content and honest pending status.
- Reassess invalidated context dependencies and newly created cues before rebuilding each next-round plan; the final allowed round still gets reassessment. Include fresh cues throughout expanded ASR coverage even when they fall outside requested range bounds, without promoting those outside assessments into next-round eligibility. Never cache IDs/revisions or interpret absent/stale assessments as none. For ranged runs, remaining-count and convergence claims are scoped to the requested interval.
- After final reassessment, run a distinct assessment-only final_consistency phase for all required missing/recheck cues: fixed scope plus run-invalidated dependencies and new/expanded cues, regardless of threshold. Re-read persisted state and require current explicit grades including none before success. If this check discovers qualifying scoped findings and repair budget remains, return to the normal repair loop; max_rounds is valid only when the actual cap is reached. The consistency check itself does not increment rounds, mutate content, re-invalidate grades or silently loop on no progress. Failure/cancel preserves content/pending status and reports incomplete, never fabricated all-clear.
- Preserve ignored intent across reassessment only when previous finding is current and cue/rule/content/context/provider/rubric/mode identity matches. Changed context and new IDs expire suppression. Ignoring excludes a finding, not necessary overlapping cue replacement.
- Bounded last-run metadata records scope/threshold/max, phase, round/committed rounds, effective intervals, counts and terminal reason without a content revision increment. Startup changes running repair to interrupted and never resumes automatically. Unknown/incomplete reassessment counts must not display zero/all-clear. Distinguish no eligible, cap with issues, cancelled, failed and interrupted; metadata/progress updates must preserve snapshot ordering and project/run matching.

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
| One chapter request targets >2000 / complete UTF-8 prompt plus correction reserve >512KiB | `TEXT_LIMIT` before generation, no silent intra-chapter batching |
| Unknown/duplicate/inapplicable model cue/rule/evidence | `REVIEW_IDS` (unknown enum/malformed shape: `REVIEW_INVALID`) |
| Model omits any target / insufficient context or timing evidence | `REVIEW_INCOMPLETE` / `REVIEW_EVIDENCE`, retain previous report |
| Correctable JSON/shape/ID/coverage/evidence failure | One visible full-selection correction maximum; repeated failure retains previous report |
| Truncation, cancel, auth/network/timeout/rate/refusal or stale snapshot | No content correction or partial publication |
| Finding/report changed or no longer applies | `STALE_REVIEW`, no blind acknowledgment |
| Edited/replaced cue after review | Finding pending recheck, not silently correct |
| Edited/inserted/deleted neighbour after a none-level assessment | Dependent assessment recheck, never silently still clear |
| Legacy/unreviewed cue | Ungraded, never inferred as none from absent findings |
| Invalid threshold or noninteger/out-of-1–20 repair count | Input validation failure before provider work |
| Reversed/out-of-media automatic repair range | TIMING_INVALID before provider work |
| Empty repair range / no qualifying unignored issue | No repair rounds, scoped no-eligible result |
| Mixed round ASR succeeds but translation fails | Entire current round unpublished; prior rounds retained |
| Audit omits targets, unknown/mislinked outputs, invalid timing/translation or conflicting cross-chapter result | REPAIR_AUDIT validation failure; entire current round unpublished |
| Unchanged audited target content | Explicit pending invalidation followed by current reassessment; no inherited stale grade |
| Final consistency leaves pending required cues / fails / cancels | Incomplete/error/cancel outcome, no fabricated grades or successful all-clear |
| Cancel after a committed round while reassessing | Saved content retained, report stale/incomplete, no next round |
| Round cap reached with current remaining findings | Cap reason and scoped remaining count, never all-clear |
| Restart while last-run metadata is running | Interrupted, no automatic provider calls/resume |

## 5. Good / Base / Bad Cases
- Good: import original-only, run local recognition, review suspicious text with an independent text profile, repair one expanded passage and export source subtitles without a translation request.
- Base: translated project reprocesses selected cues, explicitly requests combined translation and commits only complete successful results.
- Bad: one checkbox controls only the primary generation action while retry/repair/fullscreen/export silently translate or show old target-language text.
- Good repair: medium/3 on one interval rechecks fresh IDs each round, fixes only qualifying issues and reports remaining suspicion after its final reassessment.
- Bad repair: a renderer loop calls public ASR/translate/review independently, changes range to new cue IDs or silently treats cap/cancel as correctness.
- Good aggregate review:1027 selected cues in one admitted chapter produce one complete compact response; multiple chapters issue concurrent whole-chapter requests. Each grade uses its original local evidence group and dependent none grades stale after neighbour edits.
- Bad aggregate review: globally deduplicated cues become a single evidence context, sparse selected cues become adjacent, or omitted targets are filled in as none.

## 6. Tests Required
- Legacy defaults, explicit import choice through both paths, disabled direct translation, source-only caption/compiler output with stored translations and mode toggles.
- Disjoint/overlapping/gap/boundary target plans, server scope equality, clip-local normalization and actual cropped/delayed audio. Preserve unaffected cues and styles; fresh IDs and silence behaviour.
- Atomic combined translation failure/cancellation, cleanup/publication ordering, busy/stale guards and persisted/exported corrected timeline.
- Review strict all-target output, fixed rule-to-grade derivation, evidence prerequisites/refs, complete coverage, prompt/context limits, full-vs-selected context equality, batch boundaries/disjoint targets, cancel/failure retention, provider changes, report restart/ignore and stale/recheck after CRUD/replacement of targets or neighbours (including previously none).
- Aggregate31/65/1027 targets within one admitted chapter use one successful fixture HTTP request; multiple chapters overlap within service caps. Full chapter context remains present for sparse targets; disjoint evidence stays local. Strict tuple/UTF-8/coverage checks reject invalid claims before publication. Correction once per affected chapter for format/evidence, never transport/cancel; retain prior report on terminal failure.
- Grade badges/filter counts/select-and-repair, unreviewed/legacy/stale distinctions and shared standards help must retain usable default/minimum-window video/list/form space.
- Actual isolated Electron workflows and default/minimum-window screenshots; do not call deterministic provider fixtures acoustic or linguistic accuracy evidence.
- Loop threshold/ignore, all-category fresh ASR+translation, fixed scope/boundaries/expanded context, new IDs, full old/new chapter audit, explicit splits/merges/silence and cross-chapter consistency, atomic failure/cancel, lease/stale guards, unchanged-result invalidation, cap/convergence/final reassessment AND final-consistency pending closure. Include pending-after-last-recheck setup, no extra round/content mutation, current risk/none UI+restart agreement, source-only zero translation and interrupted/legacy persistence.

## 7. Wrong vs Correct
Wrong: commit new ASR text, invoke translation, then tell the user cancellation retained their previous target when translation fails.

Correct: build a draft for all requested phases, complete cleanup/validation, check revision/cancellation immediately before one atomic target replacement, then publish success.

Wrong: store a range's initial IDs and reuse them after recognition, or clear active between loop phases to call public methods.

Correct: hold one trusted main owner, resolve the fixed requested interval against each current chronology, draft and commit a whole round, then validate fresh analysis before continuing.

Wrong: reduce repeated AI calls by validating all aliases as one merged dialogue or interpreting incomplete JSON as empty findings.

Correct: aggregate only transport, retain canonical group identity/evidence checks, and publish only a complete validated report under the existing sole owner.
